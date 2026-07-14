"use client";

import {
  Activity, Archive, Tags, ArrowDownToLine, ArrowUpDown, BarChart3, Bell, BookOpen, Boxes, CalendarDays, Check, ChevronDown,
  ChevronLeft, ChevronRight, ExternalLink, Globe, Pencil,
  CircleHelp, Cloud, CloudOff, Database, FileClock, FileUp, Gauge, Github, History, KeyRound, LayoutDashboard, LogOut,
  Menu, Moon, MoreHorizontal, PanelLeftClose, Plus, RefreshCw, RotateCcw, Search, Settings, ShieldCheck, ShoppingBag, ShoppingCart, Sparkles,
  Sun, Trash2, TrendingUp, UploadCloud, Users, WandSparkles, X,
} from "lucide-react";
import { ChangeEvent, DragEvent, Fragment, useEffect, useMemo, useRef, useState } from "react";
import { buildMappingActivitySeries, cumulativeMappingSeries, MappingGranularity, summarizeMappingActivity } from "@/lib/analytics";
import { adminBrandUrl, adminUnknownBrandUrl, buildAiReviewPrompt, canonicalRootCatalog, classifyBrand, findCatalogConflicts, findPriorUbqFamilyMerge, findRelatedUbqBrands, getBulkExportReadiness, parseAiReviewJson, parseCsv, parseDecisionCsv, parseReferenceCsv, reconcileRootRecommendations, resolveRootBrandTarget, SEED_BRANDS, toCsv, toRootChangesCsv } from "@/lib/brand-engine";
import { connectGitHubWorkspace, getGitHubWorkspace, getGitHubWorkspaceAtRevision, getGitHubWorkspaceStatus, GITHUB_WORKSPACE_REPOSITORY, GitHubUser, GitHubWorkspaceError, mergeWorkspaceSnapshots, putGitHubWorkspace, verifyGitHubWorkspaceRepository } from "@/lib/github-workspace";
import { clearGitHubBaseline, clearReferenceTables, download, EMPTY_DATA, loadData, loadGitHubBaseline, loadReferenceTables, loadUbqReference, saveData, saveGitHubBaseline, saveReferenceTable, saveUbqReference } from "@/lib/storage";
import { Action, AppData, BrandRecord, CatalogBrand, ImportBatch, LedgerEntry, SharedWorkspaceSnapshot, SourceMetadata, ValidationSettings, View, WorkflowSource } from "@/lib/types";

const NAV: { section?: string; items: { id: View; label: string; icon: typeof Gauge }[] }[] = [
  { items: [
    { id: "dashboard", label: "Overview", icon: LayoutDashboard },
    { id: "imports", label: "1  Import CSV", icon: FileUp },
    { id: "review", label: "2  Process & review", icon: FileClock },
    { id: "output", label: "3  Bulk output CSV", icon: ArrowDownToLine },
  ]},
  { section: "Knowledge", items: [
    { id: "brands", label: "Brand database", icon: Database },
    { id: "aliases", label: "Aliases", icon: Tags },
    { id: "ledger", label: "Review history", icon: History },
  ]},
  { section: "Workspace", items: [
    { id: "analytics", label: "Analytics", icon: BarChart3 },
    { id: "artifacts", label: "Data & artifacts", icon: Archive },
    { id: "settings", label: "Validation modules", icon: Settings },
  ]},
];

const SAMPLE = `UnmappedBrandID,UnmappedBrandName,Listing Count,SKU Count
draft_brand_10001,BMW OE,412,186
draft_brand_10002,Motrio,95,43
draft_brand_10003,Details in Description,32,18
draft_brand_10004,ST Suspension,81,55
draft_brand_10005,CCS,14,8
draft_brand_10006,Toyota Original OE,295,121
draft_brand_10007,Northline Auto Parts Direct,17,9
draft_brand_10008,Daelim (Original OE),62,40`;

const fmtDate = (iso: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(iso));
const fmtTime = (iso: string) => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" }).format(new Date(iso));
const sourceUpdated = (meta?: SourceMetadata) => meta ? `${meta.filename} · Updated ${fmtDate(meta.updatedAt)} at ${fmtTime(meta.updatedAt)}` : "Not updated yet";
const uid = () => globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
type ParsedRow = ReturnType<typeof parseCsv>[number];
type UbqSource = { filename: string; count: number; byId: Map<string, ParsedRow>; byName: Map<string, ParsedRow[]> };
type ProcessingRun = { filename: string; count: number; steps: string[]; current: number; source?: WorkflowSource };
type GitHubSession = { token: string; user: GitHubUser };
type GitHubRemoteUpdate = { revision: string; sync?: SharedWorkspaceSnapshot["sync"] };
const APP_BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

function indexUbqRows(filename: string, rows: ParsedRow[]): UbqSource {
  const byId = new Map<string, ParsedRow>();
  const byName = new Map<string, ParsedRow[]>();
  rows.forEach((row) => {
    byId.set(row.id, row);
    const key = row.name.trim().toLowerCase();
    byName.set(key, [...(byName.get(key) || []), row]);
  });
  return { filename, count: rows.length, byId, byName };
}

function resolveRecordWithUbq(record: BrandRecord, source: UbqSource) {
  const exactId = source.byId.get(record.id);
  const nameMatches = source.byName.get(record.name.trim().toLowerCase()) || [];
  const match = exactId || (nameMatches.length === 1 ? nameMatches[0] : undefined);
  if (!match?.id.startsWith("draft_brand_")) return record;
  return { ...record, id: match.id, listingCount: match.listingCount ?? record.listingCount, skuCount: match.skuCount ?? record.skuCount, ubqVerified: true, reason: record.reason === "This brand was not found in the loaded UBQ export" ? "UBQ ID verified; review the current brand decision" : record.reason, evidence: [...new Set([`UBQ ID verified: ${match.id}`, ...record.evidence.filter((item) => item !== "UBQ lookup failed")])] };
}

function effectiveCatalogBrands(data: AppData) {
  const brands = new Map<string, CatalogBrand>();
  [...data.fpaBrands, ...data.acaBrands, ...SEED_BRANDS, ...data.rootBrands, ...data.customBrands].forEach((brand) => brands.set(brand.id, brand));
  return [...brands.values()];
}

function rootChangedFields(before: CatalogBrand | undefined, after: CatalogBrand) {
  if (!before) return ["name", "aliases", "sameAs", "source", "status"];
  const aliases = (brand: CatalogBrand) => [...brand.aliases].map((alias) => alias.toLowerCase()).sort().join("|");
  return [
    before.name !== after.name && "name",
    aliases(before) !== aliases(after) && "aliases",
    (before.sameAs || "") !== (after.sameAs || "") && "sameAs",
    (before.rootSource || "") !== (after.rootSource || "") && "source",
    (before.rootStatus || "ACTIVE") !== (after.rootStatus || "ACTIVE") && "status",
  ].filter(Boolean) as string[];
}

function stabilizeRootConsolidations(records: BrandRecord[], rootBrands: CatalogBrand[]) {
  const byId = new Map(records.map((record) => [record.id, record]));
  const catalog = new Map(rootBrands.map((brand) => [brand.id, brand]));
  const updates = new Map<string, BrandRecord>();
  records.forEach((record) => {
    if (updates.has(record.id) || record.action !== "MERGE" || !record.targetId) return;
    const reverse = byId.get(record.targetId);
    if (!reverse || reverse.action !== "MERGE" || reverse.targetId !== record.id) return;
    const pair = [record, reverse].sort((left, right) => {
      const quality = (item: BrandRecord) => (catalog.get(item.id)?.aliases.length || 0) * 10 + (/^[\p{L}\p{N}]/u.test(item.name) ? 5 : 0) - item.name.length / 100;
      return quality(right) - quality(left) || left.id.localeCompare(right.id);
    });
    const canonical = pair[0]; const duplicate = pair[1];
    updates.set(canonical.id, { ...canonical, action: "CREATE", targetId: undefined, targetName: canonical.name, confidence: Math.min(canonical.confidence, 85), reason: "Selected as the canonical record to prevent a circular consolidation", decisionSource: "Root duplicate resolver", evidence: ["Prevented reciprocal MERGE cycle", ...canonical.evidence] });
    updates.set(duplicate.id, { ...duplicate, targetId: canonical.id, targetName: canonical.name, reason: `Duplicate variation should consolidate into ${canonical.name}`, decisionSource: "Root duplicate resolver", evidence: [`Canonical Root target: ${canonical.id}`, ...duplicate.evidence] });
  });
  return records.map((record) => updates.get(record.id) || record);
}

function enrichUbqFamilies(records: BrandRecord[], ubqRows: ParsedRow[], data: AppData): BrandRecord[] {
  const byId = new Map(ubqRows.map((row) => [row.id, row]));
  return records.map((record) => {
    const related = findRelatedUbqBrands(record, ubqRows);
    if (!related.length) return record;
    const familyRows = [byId.get(record.id), ...related.map((item) => byId.get(item.id))].filter(Boolean) as ParsedRow[];
    const localTarget = familyRows.map((row) => classifyBrand(row, data)).filter((candidate) => candidate.action === "MERGE" && candidate.targetId?.startsWith("brand_")).sort((left, right) => right.confidence - left.confidence)[0];
    const familyIds = new Set(familyRows.map((row) => row.id));
    const history = [...data.ledger, ...data.batches.flatMap((batch) => batch.records)];
    const priorTarget = findPriorUbqFamilyMerge(record, familyIds, history);
    const directTarget = record.action === "MERGE" && record.targetId?.startsWith("brand_") ? record : undefined;
    const candidateTarget = directTarget || localTarget || priorTarget;
    const targetIsRoot = Boolean(candidateTarget?.targetId && data.rootBrands.some((brand) => brand.id === candidateTarget.targetId));
    const resolvedTarget = candidateTarget?.targetId && targetIsRoot ? resolveRootBrandTarget(candidateTarget.targetId, data.rootBrands) : undefined;
    const rootTarget = resolvedTarget?.brand ? { ...candidateTarget!, targetId: resolvedTarget.brand.id, targetName: resolvedTarget.brand.name, canonicalTargetChain: resolvedTarget.chain } : targetIsRoot && !resolvedTarget?.brand ? undefined : candidateTarget;
    const previouslyMergedStillPresent = history.some((candidate) => candidate.id === record.id && candidate.action === "MERGE" && candidate.targetId?.startsWith("brand_"));
    const canonical = [...familyRows].sort((left, right) => (right.listingCount || 0) - (left.listingCount || 0) || Number(/[\\/]/.test(left.name)) - Number(/[\\/]/.test(right.name)) || left.name.length - right.name.length)[0];
    const familyEvidence = related.map((item) => `Related UBQ: ${item.name} (${item.score}% · ${item.id})`);
    if (rootTarget) return { ...record, action: "MERGE", targetId: rootTarget.targetId, targetName: rootTarget.targetName, confidence: Math.min(96, Math.max(88, rootTarget.confidence - (directTarget ? 0 : 3))), reason: previouslyMergedStillPresent ? `This exact UBQ row was previously MERGED to ${rootTarget.targetName} but is still present. Reapply the MERGE or manually DELETE the stale queue record in Admin` : priorTarget ? `A previous MERGE in this UBQ family maps the remaining variation to ${rootTarget.targetName}` : `A related UBQ variation resolves to the existing brand ${rootTarget.targetName}`, decisionSource: previouslyMergedStillPresent ? "Previously merged UBQ still present" : priorTarget ? "Previous UBQ family MERGE" : "UBQ family + existing brand", status: "needs-review" as const, relatedUbq: related, ubqFamilyCanonicalId: canonical.id, ubqFamilyCanonicalName: canonical.name, priorFamilyTargetId: rootTarget.targetId, priorFamilyTargetName: rootTarget.targetName, previouslyMergedStillPresent, canonicalTargetChain: rootTarget.canonicalTargetChain, blockedByTargetCreation: false, suggestedAliases: [...new Set([record.name, ...related.map((item) => item.name)].filter((name) => name.toLowerCase() !== rootTarget.targetName?.toLowerCase()))], evidence: [`Family target: ${rootTarget.targetName} · ${rootTarget.targetId}`, ...(rootTarget.canonicalTargetChain && rootTarget.canonicalTargetChain.length > 1 ? [`Target chain resolved: ${rootTarget.canonicalTargetChain.join(" → ")}`] : []), ...(priorTarget ? [`Prior MERGE: ${priorTarget.name} → ${priorTarget.targetName}`] : []), ...familyEvidence, ...record.evidence] };
    if (record.id === canonical.id) return { ...record, action: "CREATE", targetId: undefined, targetName: classifyBrand(canonical, data).normalized, confidence: Math.min(82, Math.max(record.confidence, 72)), reason: `Best canonical candidate among ${familyRows.length} related UBQ values; create once, then consolidate the remaining variations after a BrandID exists`, decisionSource: "UBQ family canonical", status: "needs-review" as const, relatedUbq: related, ubqFamilyCanonicalId: canonical.id, ubqFamilyCanonicalName: canonical.name, blockedByTargetCreation: false, suggestedAliases: related.map((item) => item.name), evidence: ["No existing Root BrandID is available yet", ...familyEvidence, ...record.evidence] };
    return { ...record, action: "SKIP", targetId: undefined, targetName: undefined, confidence: Math.min(78, Math.max(record.confidence, 68)), reason: `Likely variation of ${canonical.name}. Hold this row until the canonical brand has a real BrandID; then consolidate instead of creating a duplicate`, decisionSource: "UBQ family hold", status: "needs-review" as const, relatedUbq: related, ubqFamilyCanonicalId: canonical.id, ubqFamilyCanonicalName: canonical.name, blockedByTargetCreation: true, suggestedAliases: [record.name, ...related.map((item) => item.name)], evidence: [`Suggested UBQ canonical: ${canonical.name} · ${canonical.id}`, ...familyEvidence, ...record.evidence] };
  });
}

function ActionPill({ action }: { action: Action }) {
  return <span className={`action-pill ${action.toLowerCase()}`}><span />{action}</span>;
}

function RootActionPill({ action }: { action: Action }) {
  const label = action === "MERGE" ? "CONSOLIDATE" : action === "CREATE" ? "EDIT / KEEP" : action;
  return <span className={`action-pill ${action.toLowerCase()}`}><span />{label}</span>;
}

function Confidence({ value }: { value: number }) {
  return <div className="confidence"><div className="confidence-bar"><span style={{ width: `${value}%` }} /></div><b>{value}%</b></div>;
}

function MetricCard({ title, value, delta, icon: Icon, tone = "green" }: { title: string; value: number | string; delta: string; icon: typeof Gauge; tone?: string }) {
  return <div className="metric-card">
    <div className={`metric-icon ${tone}`}><Icon size={18} /></div>
    <p>{title}</p><strong>{value}</strong><small>{delta}</small>
  </div>;
}

function EmptyState({ icon: Icon, title, body, action }: { icon: typeof Gauge; title: string; body: string; action?: React.ReactNode }) {
  return <div className="empty-state"><div className="empty-icon"><Icon size={24} /></div><h3>{title}</h3><p>{body}</p>{action}</div>;
}

export default function BrandmasterApp() {
  const [view, setView] = useState<View>("imports");
  const [data, setData] = useState<AppData>(EMPTY_DATA);
  const [loaded, setLoaded] = useState(false);
  const [dark, setDark] = useState(false);
  const [sidebar, setSidebar] = useState(false);
  const [online, setOnline] = useState(true);
  const [toast, setToast] = useState("");
  const [selected, setSelected] = useState<BrandRecord | null>(null);
  const [query, setQuery] = useState("");
  const [ubqSource, setUbqSource] = useState<UbqSource | null>(null);
  const [processing, setProcessing] = useState<ProcessingRun | null>(null);
  const [restartOpen, setRestartOpen] = useState(false);
  const [resettingTriage, setResettingTriage] = useState(false);
  const [githubSession, setGitHubSession] = useState<GitHubSession | null>(null);
  const [githubRemoteUpdate, setGitHubRemoteUpdate] = useState<GitHubRemoteUpdate | null>(null);
  const [githubTeamSync, setGitHubTeamSync] = useState<SharedWorkspaceSnapshot["sync"]>();

  useEffect(() => {
    const savedData = loadData();
    if (Object.keys(savedData.learned).length && !savedData.sourceMeta.DECISIONS) savedData.sourceMeta.DECISIONS = { filename: "Previously loaded decisions", updatedAt: new Date().toISOString() };
    setData(savedData); setLoaded(true);
    loadReferenceTables().then((tables) => setData((prev) => {
      const sourceMeta = { ...prev.sourceMeta };
      const restoredAt = new Date().toISOString();
      if (tables.rootBrands.length && !sourceMeta.ROOT) sourceMeta.ROOT = { filename: "Previously loaded root table", updatedAt: restoredAt };
      if (tables.acaBrands.length && !sourceMeta.ACA) sourceMeta.ACA = { filename: "Previously loaded ACA table", updatedAt: restoredAt };
      if (tables.fpaBrands.length && !sourceMeta.FPA) sourceMeta.FPA = { filename: "Previously loaded FPA table", updatedAt: restoredAt };
      return { ...prev, ...tables, sourceMeta };
    })).catch(() => setToast("Local reference tables could not be restored"));
    loadUbqReference().then((saved) => {
      if (!saved?.rows.length) return;
      const source = indexUbqRows(saved.filename, saved.rows);
      setUbqSource(source);
      setData((prev) => ({ ...prev, batches: prev.batches.map((batch) => ({ ...batch, records: batch.records.map((record) => resolveRecordWithUbq(record, source)) })), sourceMeta: { ...prev.sourceMeta, UBQ: prev.sourceMeta.UBQ || { filename: saved.filename, updatedAt: new Date().toISOString() } } }));
    }).catch(() => undefined);
    setDark(localStorage.getItem("brandmaster-theme") === "dark" || (!localStorage.getItem("brandmaster-theme") && matchMedia("(prefers-color-scheme: dark)").matches));
    const update = () => setOnline(navigator.onLine); update();
    addEventListener("online", update); addEventListener("offline", update);
    if ("serviceWorker" in navigator) {
      let refreshing = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        if (refreshing || !navigator.serviceWorker.controller) return;
        refreshing = true; location.reload();
      });
      navigator.serviceWorker.register(`${APP_BASE_PATH}/sw.js`, { scope: `${APP_BASE_PATH}/` }).then((registration) => registration.update()).catch(() => undefined);
    }
    return () => { removeEventListener("online", update); removeEventListener("offline", update); };
  }, []);
  useEffect(() => { if (loaded) saveData(data); }, [data, loaded]);
  useEffect(() => { document.documentElement.dataset.theme = dark ? "dark" : "light"; localStorage.setItem("brandmaster-theme", dark ? "dark" : "light"); }, [dark]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(""), 2800); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => {
    if (!githubSession) return;
    let active = true;
    async function check() {
      try {
        const remote = await getGitHubWorkspaceStatus(githubSession!.token); if (!active) return;
        setGitHubTeamSync(remote.sync);
        const lastRevision = localStorage.getItem("brandmaster-github-revision");
        setGitHubRemoteUpdate(remote.revision && remote.revision !== lastRevision ? { revision: remote.revision, sync: remote.sync } : null);
      } catch { /* Manual sync displays actionable authentication or network errors. */ }
    }
    void check(); const timer = setInterval(() => void check(), 45_000);
    return () => { active = false; clearInterval(timer); };
  }, [githubSession]);

  const allRecords = useMemo(() => data.batches.flatMap((batch) => batch.records), [data.batches]);
  const knownBrandIds = useMemo(() => new Set([
    ...SEED_BRANDS, ...canonicalRootCatalog(data.rootBrands), ...data.fpaBrands, ...data.customBrands,
  ].map((brand) => brand.id).filter((id) => id.startsWith("brand_")).concat(allRecords.map((record) => record.targetId || "").filter((id) => id.startsWith("brand_")))), [data.rootBrands, data.fpaBrands, data.customBrands, allRecords]);
  const current = data.batches[0];
  const pending = allRecords.filter((r) => r.status === "needs-review");
  const avg = allRecords.length ? Math.round(allRecords.reduce((sum, item) => sum + item.confidence, 0) / allRecords.length) : 0;

  function navigate(next: View) { setView(next); setSidebar(false); setSelected(null); }
  function loadUbqSource(filename: string, rows: ParsedRow[]) {
    const source = indexUbqRows(filename, rows);
    const resolveRecord = (record: BrandRecord) => resolveRecordWithUbq(record, source);
    const unresolved = data.batches.flatMap((batch) => batch.records).filter((record) => !record.ubqVerified);
    const resolved = unresolved.filter((record) => resolveRecord(record) !== record).length;
    setUbqSource(source);
    void saveUbqReference(filename, rows);
    setData((prev) => ({ ...prev, batches: resolved ? prev.batches.map((batch) => ({ ...batch, records: batch.records.map(resolveRecord) })) : prev.batches, sourceMeta: { ...prev.sourceMeta, UBQ: { filename, updatedAt: new Date().toISOString() } } }));
    setToast(`${rows.length.toLocaleString()} UBQ records indexed${resolved ? ` · ${resolved} missing ID${resolved === 1 ? "" : "s"} fixed` : ""}`);
  }
  function importRows(filename: string, rows: ReturnType<typeof parseCsv>) {
    if (!rows.length) { setToast("No valid brand rows found"); return; }
    const base: AppData = data;
    const s = base.validationSettings;
    const steps = ["Normalize brand names", s.previousDecisions && "Previous decisions", s.aliasTable && "Alias table", s.rootBrandTable && "Existing brand table", s.acaTable && "ACA brand table", s.fpaTable && "FPA brand table", s.offlineRules && "Offline brand rules"].filter(Boolean) as string[];
    setView("review"); setProcessing({ filename, count: rows.length, steps, current: 0, source: "IMPORT" });
    const advance = (index: number) => {
      if (index < steps.length) { setProcessing({ filename, count: rows.length, steps, current: index, source: "IMPORT" }); setTimeout(() => advance(index + 1), 340); return; }
      const records = rows.map((row) => {
        const byId = ubqSource?.byId.get(row.id);
        const nameMatches = ubqSource?.byName.get(row.name.trim().toLowerCase()) || [];
        const source = byId || (nameMatches.length === 1 ? nameMatches[0] : undefined);
        const authoritative = source ? { ...row, ...source } : row;
        const record = classifyBrand(authoritative, base);
        if (!ubqSource) return { ...record, ubqVerified: row.id.startsWith("draft_brand_") };
        if (source) return { ...record, ubqVerified: true };
        return { ...record, ubqVerified: false, status: "needs-review" as const, confidence: Math.min(record.confidence, 40), reason: "This brand was not found in the loaded UBQ export", evidence: ["UBQ lookup failed", ...record.evidence] };
      });
      const enriched = ubqSource ? enrichUbqFamilies(records, [...ubqSource.byId.values()], base) : records;
      const batch: ImportBatch = { id: uid(), filename, createdAt: new Date().toISOString(), rows: rows.length, records: enriched.map((record) => ({ ...record, workflowSource: "IMPORT" })), workflowSource: "IMPORT" };
      setData((prev) => ({ ...prev, batches: [batch, ...prev.batches] })); setProcessing(null); setToast(`${rows.length} brands processed locally`);
    };
    advance(0);
  }
  function startSourceWorklist(source: Exclude<WorkflowSource, "IMPORT">, ids: string[]) {
    if (!ids.length) { setToast("Select at least one brand to validate"); return; }
    const settings = data.validationSettings;
    const steps = ["Normalize brand names", settings.previousDecisions && "Previous decisions", settings.aliasTable && "Alias table", settings.rootBrandTable && "Existing brand table", settings.acaTable && "ACA brand table", settings.fpaTable && "FPA brand table", settings.offlineRules && "Offline brand rules"].filter(Boolean) as string[];
    const rows = source === "UBQ"
      ? ids.map((id) => ubqSource?.byId.get(id)).filter(Boolean) as ParsedRow[]
      : ids.map((id) => data.rootBrands.find((brand) => brand.id === id)).filter(Boolean).map((brand) => ({ id: brand!.id, name: brand!.name }));
    if (!rows.length) { setToast(source === "UBQ" ? "Load a UBQ table in Validation modules first" : "The selected Root records are no longer available"); return; }
    const filename = `${source === "ROOT" ? "Root table cleanup" : "UBQ worklist"} · ${rows.length} brands`;
    setView("review"); setProcessing({ filename, count: rows.length, steps, current: 0, source });
    const advance = (index: number) => {
      if (index < steps.length) { setProcessing({ filename, count: rows.length, steps, current: index, source }); setTimeout(() => advance(index + 1), 300); return; }
      let records: BrandRecord[] = rows.map((row) => {
        const base = source === "ROOT" ? { ...data, rootBrands: data.rootBrands.filter((brand) => brand.id !== row.id), customBrands: data.customBrands.filter((brand) => brand.id !== row.id) } : data;
        const classified = classifyBrand(row, base);
        return { ...classified, id: row.id, workflowSource: source, sourceBrandId: source === "ROOT" ? row.id : undefined, ubqVerified: source === "UBQ", status: "needs-review" as const, evidence: [`${source === "ROOT" ? "Root source BrandID" : "UBQ ID verified"}: ${row.id}`, ...classified.evidence] };
      });
      if (source === "ROOT") records = stabilizeRootConsolidations(records, data.rootBrands);
      if (source === "UBQ" && ubqSource) records = enrichUbqFamilies(records, [...ubqSource.byId.values()], data);
      const batch: ImportBatch = { id: uid(), filename, createdAt: new Date().toISOString(), rows: records.length, records, workflowSource: source };
      setData((prev) => ({ ...prev, batches: [batch, ...prev.batches] })); setProcessing(null); setToast(`${records.length} ${source} brands sent to Process & Review`);
    };
    advance(0);
  }
  function updateRecord(recordId: string, changes: Partial<BrandRecord>, learn = false) {
    setData((prev) => {
      let changed: BrandRecord | undefined;
      const batches = prev.batches.map((batch) => ({ ...batch, records: batch.records.map((record) => {
        if (record.id !== recordId) return record;
        changed = { ...record, ...changes, decisionSource: changes.decisionSource || "Manual override", reviewer: "You", reviewedAt: new Date().toISOString(), status: "reviewed" };
        return changed;
      }) }));
      if (!changed) return prev;
      const reviewed = changed as BrandRecord;
      const entry: LedgerEntry = { ...reviewed, ledgerId: uid(), date: new Date().toISOString() };
      const learned = learn && reviewed.workflowSource !== "ROOT" ? { ...prev.learned, [reviewed.normalized.toLowerCase()]: { action: reviewed.action, targetId: reviewed.targetId, targetName: reviewed.targetName, reason: reviewed.reason, reviewedAt: entry.date, origin: "manual" as const } } : prev.learned;
      if (reviewed.workflowSource !== "ROOT") {
        if (reviewed.action !== "MERGE" || !reviewed.targetId) return { ...prev, batches, ledger: [entry, ...prev.ledger], learned };
        const resolution = resolveRootBrandTarget(reviewed.targetId, prev.rootBrands);
        const target = resolution.brand;
        if (!target) return { ...prev, batches, ledger: [entry, ...prev.ledger], learned };
        const currentTarget = prev.rootBrands.find((brand) => brand.id === target.id)!;
        const targetBefore = prev.rootChanges[target.id]?.before || currentTarget;
        const suggested = [...new Set([reviewed.name, ...(reviewed.suggestedAliases || []), ...(reviewed.relatedUbq || []).map((item) => item.name)].map((alias) => alias.trim()).filter((alias) => alias && alias.toLowerCase() !== currentTarget.name.toLowerCase() && !currentTarget.aliases.some((existing) => existing.toLowerCase() === alias.toLowerCase())))];
        if (!suggested.length) return { ...prev, batches, ledger: [entry, ...prev.ledger], learned };
        const targetAfter = { ...currentTarget, aliases: [...new Set([...currentTarget.aliases, ...suggested])], rootSource: currentTarget.rootSource || "BRANDMASTER" };
        const rootChanges: AppData["rootChanges"] = { ...prev.rootChanges, [target.id]: { id: target.id, type: "UPDATE" as const, before: targetBefore, after: targetAfter, changedFields: rootChangedFields(targetBefore, targetAfter), updatedAt: entry.date, status: "PENDING" as const, adminStatus: prev.rootChanges[target.id]?.adminStatus || "RECOMMENDED", adminUpdatedAt: entry.date, adminUpdatedBy: "You", verificationNote: `Add aliases learned from UBQ family: ${suggested.join(", ")}` } };
        const rootBrands = prev.rootBrands.map((brand) => brand.id === target.id ? targetAfter : brand);
        void saveReferenceTable("ROOT", rootBrands);
        return { ...prev, batches, ledger: [entry, ...prev.ledger], learned, rootBrands, rootChanges };
      }
      const sourceId = reviewed.sourceBrandId || reviewed.id;
      const currentRoot = prev.rootBrands.find((brand) => brand.id === sourceId);
      if (!currentRoot) return { ...prev, batches, ledger: [entry, ...prev.ledger], learned };
      const pendingRoot = prev.rootChanges[sourceId];
      const originalRoot = pendingRoot?.before || currentRoot;
      if (reviewed.action === "SKIP") {
        if (!pendingRoot) return { ...prev, batches, ledger: [entry, ...prev.ledger], learned };
        const rootChanges = { ...prev.rootChanges }; delete rootChanges[sourceId];
        const rootBrands = prev.rootBrands.map((brand) => brand.id === sourceId ? originalRoot : brand);
        void saveReferenceTable("ROOT", rootBrands);
        return { ...prev, batches, ledger: [entry, ...prev.ledger], learned, rootBrands, rootChanges };
      }
      const requestedTarget = reviewed.action === "MERGE" && reviewed.targetId ? prev.rootBrands.find((brand) => brand.id === reviewed.targetId) : undefined;
      const targetResolution = requestedTarget ? resolveRootBrandTarget(requestedTarget.id, prev.rootBrands) : undefined;
      const mergeTargetId = targetResolution?.brand?.id || reviewed.targetId;
      const after: CatalogBrand = reviewed.action === "MERGE"
        ? { ...originalRoot, sameAs: mergeTargetId, rootStatus: "INACTIVE", rootSource: "BRANDMASTER" }
        : reviewed.action === "DELETE"
          ? { ...originalRoot, sameAs: undefined, rootStatus: "BLOCKED", rootSource: "BRANDMASTER" }
          : { ...originalRoot, name: reviewed.targetName?.trim() || originalRoot.name, sameAs: undefined, rootStatus: "ACTIVE", rootSource: "BRANDMASTER" };
      const changedFields = rootChangedFields(originalRoot, after);
      const rootChanges: AppData["rootChanges"] = { ...prev.rootChanges, [sourceId]: { id: sourceId, type: "UPDATE" as const, before: originalRoot, after, changedFields, updatedAt: entry.date, status: "PENDING" as const, adminStatus: "RECOMMENDED" as const, adminUpdatedAt: entry.date, adminUpdatedBy: "You" } };
      let rootBrands = prev.rootBrands.map((brand) => brand.id === sourceId ? after : brand);
      if (reviewed.action === "MERGE" && targetResolution?.brand && targetResolution.brand.id !== sourceId) {
        const targetCurrent = rootBrands.find((brand) => brand.id === targetResolution.brand!.id)!;
        const targetBefore = prev.rootChanges[targetCurrent.id]?.before || targetCurrent;
        const aliases = [...new Set([...(targetCurrent.aliases || []), originalRoot.name, ...originalRoot.aliases, ...(reviewed.suggestedAliases || [])].map((alias) => alias.trim()).filter((alias) => alias && alias.toLowerCase() !== targetCurrent.name.toLowerCase()))];
        const targetAfter = { ...targetCurrent, aliases, rootSource: targetCurrent.rootSource || "BRANDMASTER" };
        const targetFields = rootChangedFields(targetBefore, targetAfter);
        if (targetFields.length) {
          rootChanges[targetCurrent.id] = { id: targetCurrent.id, type: "UPDATE", before: targetBefore, after: targetAfter, changedFields: targetFields, updatedAt: entry.date, status: "PENDING", adminStatus: prev.rootChanges[targetCurrent.id]?.adminStatus || "RECOMMENDED", adminUpdatedAt: entry.date, adminUpdatedBy: "You", verificationNote: `Add aliases from consolidated Root brand ${originalRoot.name}` };
          rootBrands = rootBrands.map((brand) => brand.id === targetCurrent.id ? targetAfter : brand);
        }
      }
      void saveReferenceTable("ROOT", rootBrands);
      return { ...prev, batches, ledger: [entry, ...prev.ledger], learned, rootBrands, rootChanges, sourceMeta: { ...prev.sourceMeta, ROOT: { filename: prev.sourceMeta.ROOT?.filename || "Root table", updatedAt: entry.date } } };
    });
    setSelected(null); setToast("Decision saved to the knowledge base");
  }
  function clearWorkspace() { setData(EMPTY_DATA); setUbqSource(null); void Promise.all([clearReferenceTables(), clearGitHubBaseline()]); localStorage.removeItem("brandmaster-github-revision"); localStorage.removeItem("brandmaster-github-synced-at"); setSelected(null); setToast("Local workspace cleared"); }
  function requestFreshTriage() {
    if (!data.batches.length) { navigate("imports"); return; }
    setRestartOpen(true);
  }
  function startFreshTriage() {
    setRestartOpen(false); setSelected(null); setProcessing(null); setResettingTriage(true);
    setTimeout(() => {
      setData((prev) => ({ ...prev, batches: [] }));
      setQuery(""); setView("imports"); setResettingTriage(false); setToast("Fresh triage ready — reference data and prior knowledge were preserved");
    }, 900);
  }
  function updateValidationSettings(changes: Partial<ValidationSettings>) { setData((prev) => ({ ...prev, validationSettings: { ...prev.validationSettings, ...changes } })); }
  function setReferenceTable(source: "ACA" | "FPA" | "ROOT", brands: CatalogBrand[], filename: string) {
    const key = source === "ACA" ? "acaBrands" : source === "FPA" ? "fpaBrands" : "rootBrands";
    let unlockedFamilies = 0;
    setData((prev) => {
      if (source !== "ROOT") return { ...prev, [key]: brands, sourceMeta: { ...prev.sourceMeta, [source]: { filename, updatedAt: new Date().toISOString() } } };
      const { rootBrands, rootChanges } = reconcileRootRecommendations(brands, prev.rootChanges);
      const nextBase = { ...prev, rootBrands, rootChanges };
      const allUbqRows = ubqSource ? [...ubqSource.byId.values()] : [];
      const batches = allUbqRows.length ? prev.batches.map((batch) => ({ ...batch, records: batch.records.map((record) => {
        if (!record.relatedUbq?.length || (!record.blockedByTargetCreation && record.decisionSource !== "UBQ family canonical") || record.status === "reviewed") return record;
        const refreshed = enrichUbqFamilies([record], allUbqRows, nextBase)[0];
        if (refreshed.action !== "MERGE" || !refreshed.targetId) return record;
        unlockedFamilies += 1;
        return { ...refreshed, status: "needs-review" as const, confidence: Math.min(refreshed.confidence, 94), reason: `New Root import unlocked this held UBQ family: ${refreshed.reason}`, decisionSource: "Root refresh second pass", blockedByTargetCreation: false, evidence: ["Automatically rechecked after Root table refresh", ...refreshed.evidence] };
      }) })) : prev.batches;
      void saveReferenceTable("ROOT", rootBrands);
      return { ...prev, batches, rootBrands, rootChanges, sourceMeta: { ...prev.sourceMeta, ROOT: { filename, updatedAt: new Date().toISOString() } } };
    });
    if (source !== "ROOT") void saveReferenceTable(source, brands);
    setTimeout(() => setToast(`${brands.length.toLocaleString()} ${source === "ROOT" ? "existing" : source} brands saved offline${unlockedFamilies ? ` · ${unlockedFamilies} held UBQ row${unlockedFamilies === 1 ? "" : "s"} unlocked for MERGE` : ""}`), 0);
  }
  function saveCatalogBrand(brand: CatalogBrand) {
    setData((prev) => {
      const replace = (brands: CatalogBrand[]) => brands.some((item) => item.id === brand.id) ? brands.map((item) => item.id === brand.id ? brand : item) : [brand, ...brands];
      if (brand.source === "Root") {
        const existingChange = prev.rootChanges[brand.id];
        const current = prev.rootBrands.find((item) => item.id === brand.id);
        const before = existingChange?.before || current;
        const changedFields = rootChangedFields(before, brand);
        const rootChanges = { ...prev.rootChanges };
        if (changedFields.length) rootChanges[brand.id] = { id: brand.id, type: before ? "UPDATE" : "CREATE", before, after: brand, changedFields, updatedAt: new Date().toISOString(), status: "PENDING", adminStatus: existingChange?.adminStatus || "RECOMMENDED", adminUpdatedAt: new Date().toISOString(), adminUpdatedBy: "You" };
        else delete rootChanges[brand.id];
        const rootBrands = replace(prev.rootBrands); void saveReferenceTable("ROOT", rootBrands);
        return { ...prev, rootBrands, rootChanges, sourceMeta: { ...prev.sourceMeta, ROOT: { filename: prev.sourceMeta.ROOT?.filename || "Root table", updatedAt: new Date().toISOString() } } };
      }
      if (brand.source === "ACA") { const acaBrands = replace(prev.acaBrands); void saveReferenceTable("ACA", acaBrands); return { ...prev, acaBrands, sourceMeta: { ...prev.sourceMeta, ACA: { filename: prev.sourceMeta.ACA?.filename || "ACA table", updatedAt: new Date().toISOString() } } }; }
      if (brand.source === "FPA") { const fpaBrands = replace(prev.fpaBrands); void saveReferenceTable("FPA", fpaBrands); return { ...prev, fpaBrands, sourceMeta: { ...prev.sourceMeta, FPA: { filename: prev.sourceMeta.FPA?.filename || "FPA table", updatedAt: new Date().toISOString() } } }; }
      return { ...prev, customBrands: replace(prev.customBrands).map((item) => item.id === brand.id ? { ...item, source: "Manual" as const } : item) };
    });
    setToast(`${brand.name} saved to the local brand database`);
  }
  function undoRootChange(id: string) {
    const wasApplied = data.rootChanges[id]?.status === "APPLIED";
    setData((prev) => {
      const change = prev.rootChanges[id];
      if (!change) return prev;
      if (change.status === "APPLIED") {
        const rootChanges = { ...prev.rootChanges }; delete rootChanges[id];
        return { ...prev, rootChanges };
      }
      const rootBrands = change.before
        ? prev.rootBrands.map((brand) => brand.id === id ? change.before! : brand)
        : prev.rootBrands.filter((brand) => brand.id !== id);
      const rootChanges = { ...prev.rootChanges }; delete rootChanges[id];
      void saveReferenceTable("ROOT", rootBrands);
      return { ...prev, rootBrands, rootChanges };
    });
    setToast(wasApplied ? "Verified Root task dismissed" : "Pending Root recommendation undone");
  }
  function updateRootTaskAdminStatus(id: string, adminStatus: NonNullable<AppData["rootChanges"][string]["adminStatus"]>) {
    setData((prev) => {
      const task = prev.rootChanges[id];
      if (!task) return prev;
      const updatedTask = { ...task, adminStatus, adminUpdatedAt: new Date().toISOString(), adminUpdatedBy: "You", verificationNote: adminStatus === "REJECTED" ? "Reviewer rejected this recommendation; it will not be exported or reapplied" : task.verificationNote };
      if (adminStatus !== "REJECTED") return { ...prev, rootChanges: { ...prev.rootChanges, [id]: updatedTask } };
      const rootBrands = task.before
        ? prev.rootBrands.map((brand) => brand.id === id ? task.before! : brand)
        : prev.rootBrands.filter((brand) => brand.id !== id);
      void saveReferenceTable("ROOT", rootBrands);
      return { ...prev, rootBrands, rootChanges: { ...prev.rootChanges, [id]: updatedTask } };
    });
    setToast(adminStatus === "COMPLETED" ? "Marked completed in Admin — awaiting Root verification" : adminStatus === "REJECTED" ? "Root recommendation rejected" : "Admin task status updated");
  }
  function createWorkspaceSnapshot(): SharedWorkspaceSnapshot {
    const ubqRows = ubqSource ? [...ubqSource.byId.values()] : [];
    return { schemaVersion: "brandmaster.workspace.v1", exportedAt: new Date().toISOString(), data, ubq: ubqSource ? { filename: ubqSource.filename, rows: ubqRows } : null };
  }
  async function applyWorkspaceSnapshot(payload: SharedWorkspaceSnapshot) {
    if (payload.schemaVersion !== "brandmaster.workspace.v1" || !payload.data || !Array.isArray(payload.data.batches)) throw new Error("invalid");
    const restored: AppData = { ...EMPTY_DATA, ...payload.data, rootChanges: payload.data.rootChanges || {}, sourceMeta: payload.data.sourceMeta || {}, validationSettings: { ...EMPTY_DATA.validationSettings, ...(payload.data.validationSettings || {}) } };
    setData(restored);
    await Promise.all([saveReferenceTable("ROOT", restored.rootBrands || []), saveReferenceTable("ACA", restored.acaBrands || []), saveReferenceTable("FPA", restored.fpaBrands || [])]);
    if (payload.ubq?.filename && Array.isArray(payload.ubq.rows)) {
      await saveUbqReference(payload.ubq.filename, payload.ubq.rows); setUbqSource(indexUbqRows(payload.ubq.filename, payload.ubq.rows));
    } else setUbqSource(null);
  }
  function downloadWorkspaceBackup() {
    download(`brandmaster-workspace-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(createWorkspaceSnapshot(), null, 2), "application/json;charset=utf-8");
    setToast("Workspace backup downloaded");
  }
  async function restoreWorkspaceBackup(file: File) {
    try {
      const payload = JSON.parse(await file.text()) as SharedWorkspaceSnapshot;
      await applyWorkspaceSnapshot(payload);
      setToast("Workspace backup restored");
    } catch { setToast("That file is not a valid Brandmaster workspace backup"); }
  }
  function addDecisionHistory(decisions: AppData["learned"], filename: string) {
    setData((prev) => {
      const manual = Object.fromEntries(Object.entries(prev.learned).filter(([, decision]) => decision.origin !== "imported"));
      return { ...prev, learned: { ...manual, ...decisions }, sourceMeta: { ...prev.sourceMeta, DECISIONS: { filename, updatedAt: new Date().toISOString() } } };
    });
    setToast(`${Object.keys(decisions).length.toLocaleString()} decisions updated; matching older decisions replaced`);
  }

  return <div className="app-shell">
    <aside className={`sidebar ${sidebar ? "open" : ""}`}>
      <div className="brand"><div className="brand-mark"><WandSparkles size={19} /></div><div><b>brandmaster</b><span>Validation portal</span></div><button className="icon-button close-sidebar" onClick={() => setSidebar(false)}><PanelLeftClose size={18} /></button></div>
      <nav>
        {NAV.map((group, i) => <div className="nav-group" key={i}>{group.section && <label>{group.section}</label>}{group.items.map((item) => <button className={view === item.id ? "active" : ""} onClick={() => navigate(item.id)} key={item.id}><item.icon size={17} /><span>{item.label}</span>{item.id === "review" && pending.length > 0 && <em>{pending.length}</em>}</button>)}</div>)}
      </nav>
      <div className="sidebar-bottom">
        <div className="storage-card"><div><ShieldCheck size={16} /><b>Local-first workspace</b></div><p>Your brand data stays on this device.</p><span><i style={{ width: `${Math.min(100, allRecords.length / 5)}%` }} /></span><small>{allRecords.length} records saved</small></div>
        <button className="user-card"><span>BM</span><div><b>Brand Manager</b><small>Catalog Operations</small></div><MoreHorizontal size={17} /></button>
      </div>
    </aside>
    {sidebar && <div className="scrim" onClick={() => setSidebar(false)} />}
    <main>
      <header className="topbar">
        <button className="icon-button menu-button" onClick={() => setSidebar(true)}><Menu size={20} /></button>
        <div className="global-search"><Search size={16} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search brands, IDs, or decisions…" /><kbd>⌘ K</kbd></div>
        <div className={`network ${online ? "" : "offline"}`}>{online ? <Cloud size={15} /> : <CloudOff size={15} />}{online ? "Online" : "Offline mode"}</div>
        <button className="icon-button" onClick={() => setDark(!dark)} aria-label="Toggle theme">{dark ? <Sun size={18} /> : <Moon size={18} />}</button>
        <button className="icon-button" onClick={() => githubRemoteUpdate && navigate("settings")} title={githubRemoteUpdate ? "A team workspace update is available" : "No new team updates"}><Bell size={18} />{githubRemoteUpdate && <i className="notification-dot" />}</button>
        <div className="avatar">BM</div>
      </header>
      <div className="page">
        {githubRemoteUpdate && view !== "settings" && <button className="global-sync-notice" onClick={() => navigate("settings")}><Bell size={16} /><span><b>New Brandmaster team update</b><small>{githubRemoteUpdate.sync?.lastSyncedBy ? `@${githubRemoteUpdate.sync.lastSyncedBy} saved a newer workspace.` : "A collaborator saved a newer workspace."} Pull and merge it safely.</small></span><ChevronRight size={17} /></button>}
        {view === "dashboard" && <Dashboard data={data} records={allRecords} avg={avg} pending={pending.length} onNavigate={navigate} onImport={importRows} />}
        {view === "imports" && <Imports batches={data.batches} onImport={importRows} onNavigate={navigate} onRestart={requestFreshTriage} ubqSource={ubqSource} />}
        {view === "review" && (processing ? <ProcessingView run={processing} /> : <ReviewQueue records={current?.records || []} batch={current} knownBrandIds={knownBrandIds} onUpdate={updateRecord} onSelect={setSelected} query={query} onNavigate={navigate} onRestart={requestFreshTriage} />)}
        {view === "output" && <BulkOutput records={current?.records || []} batch={current} data={data} onNavigate={navigate} onRestart={requestFreshTriage} />}
        {view === "brands" && <BrandDatabase data={data} ubqSource={ubqSource} query={query} onSave={saveCatalogBrand} onUndoRootChange={undoRootChange} onUpdateRootTask={updateRootTaskAdminStatus} onValidate={startSourceWorklist} />}
        {view === "aliases" && <Aliases data={data} onSave={saveCatalogBrand} />}
        {view === "ledger" && <Ledger entries={data.ledger} records={allRecords} />}
        {view === "analytics" && <Analytics records={allRecords} ledger={data.ledger} />}
        {view === "artifacts" && <ArtifactsView data={data} onNavigate={navigate} />}
        {view === "settings" && <SettingsView data={data} ubqSource={ubqSource} onLoadUbq={loadUbqSource} onClear={clearWorkspace} onUpdateSettings={updateValidationSettings} onSetReference={setReferenceTable} onAddDecisions={addDecisionHistory} onBackup={downloadWorkspaceBackup} onRestore={restoreWorkspaceBackup} createSnapshot={createWorkspaceSnapshot} applySnapshot={applyWorkspaceSnapshot} githubSession={githubSession} onGitHubSession={setGitHubSession} githubRemoteUpdate={githubRemoteUpdate} onGitHubRemoteUpdate={setGitHubRemoteUpdate} githubTeamSync={githubTeamSync} onGitHubTeamSync={setGitHubTeamSync} />}
      </div>
    </main>
    {selected && <DecisionDrawer record={selected} brands={effectiveCatalogBrands(data)} onClose={() => setSelected(null)} onSave={updateRecord} />}
    {restartOpen && <FreshTriageDialog count={allRecords.length} imports={data.batches.length} onCancel={() => setRestartOpen(false)} onConfirm={startFreshTriage} />}
    {resettingTriage && <FreshTriageTransition />}
    {toast && <div className="toast"><Check size={16} />{toast}</div>}
  </div>;
}

function PageHead({ eyebrow, title, body, actions }: { eyebrow?: string; title: string; body: string; actions?: React.ReactNode }) {
  return <div className="page-head"><div>{eyebrow && <span>{eyebrow}</span>}<h1>{title}</h1><p>{body}</p></div>{actions && <div className="page-actions">{actions}</div>}</div>;
}

function FreshTriageDialog({ count, imports, onCancel, onConfirm }: { count: number; imports: number; onCancel: () => void; onConfirm: () => void }) {
  return <><div className="fresh-dialog-scrim" onClick={onCancel} /><section className="fresh-dialog" role="dialog" aria-modal="true" aria-labelledby="fresh-triage-title"><div className="fresh-dialog-icon"><RotateCcw size={25} /></div><span>START A CLEAN TRIAGE</span><h2 id="fresh-triage-title">Restart at Step 1?</h2><p>This removes the current {imports} import{imports === 1 ? "" : "s"} and {count.toLocaleString()} Process & Review row{count === 1 ? "" : "s"} so old work cannot linger in the next triage.</p><div className="fresh-preserved"><ShieldCheck size={17} /><div><b>Your validation knowledge stays safe</b><small>UBQ, Root table, ACA, FPA, aliases, previous decisions, settings, review history, and Root changes are preserved.</small></div></div><div className="fresh-dialog-actions"><button className="secondary" onClick={onCancel}>Keep current triage</button><button className="primary" onClick={onConfirm}><RotateCcw size={15} />Start fresh at Step 1</button></div></section></>;
}

function FreshTriageTransition() {
  return <div className="fresh-transition"><div className="fresh-funnel"><span><FileUp size={20} /></span><i /><span><WandSparkles size={20} /></span><i /><span><ArrowDownToLine size={20} /></span></div><b>Preparing a fresh triage</b><p>Clearing the active worklist and returning to Step 1…</p></div>;
}

function WorkflowStepper({ stage, onNavigate, onRestart, hasImport = false, outputReady = false, rootMode = false }: { stage: 1 | 2 | 3; onNavigate: (view: View) => void; onRestart?: () => void; hasImport?: boolean; outputReady?: boolean; rootMode?: boolean }) {
  const steps: { number: 1 | 2 | 3; label: string; detail: string; view: View; available: boolean }[] = rootMode ? [
    { number: 1, label: "Select Root records", detail: "Build a cleanup worklist", view: "brands", available: true },
    { number: 2, label: "Review & save", detail: "Persistent Admin recommendations", view: "review", available: hasImport },
  ] : [
    { number: 1, label: "Import CSV", detail: "Unmapped IDs + names", view: "imports", available: true },
    { number: 2, label: "Process & review", detail: "Validate every action", view: "review", available: hasImport },
    { number: 3, label: "Bulk output CSV", detail: "Ready for real tool", view: "output", available: hasImport },
  ];
  return <section className={`workflow-funnel ${rootMode ? "root-workflow" : "ubq-workflow"}`}><div className="workflow-funnel-head"><div><span>{rootMode ? "ROOT CLEANUP WORKFLOW" : "UBQ TRIAGE WORKFLOW"}</span><b>{rootMode ? "Review recommendations, then complete the work in Admin" : "Follow the 1–2–3 path"}</b></div>{hasImport && onRestart && <button className="restart-triage" onClick={onRestart}><RotateCcw size={14} />Start fresh triage</button>}</div><div className="workflow-stepper">{steps.map((step, index) => <div className={`workflow-step ${stage === step.number ? "active" : ""} ${stage > step.number || (step.number === 3 && outputReady) ? "done" : ""}`} key={step.number}><button disabled={!step.available} onClick={() => onNavigate(step.view)}><span>{stage > step.number || (step.number === 3 && outputReady) ? <Check size={15} /> : step.number}</span><div><b>{step.label}</b><small>{step.detail}</small></div></button>{index < steps.length - 1 && <i><span /></i>}</div>)}</div></section>;
}

function ProcessingView({ run }: { run: ProcessingRun }) {
  const progress = Math.round(((run.current + 1) / run.steps.length) * 100);
  const mode = run.source === "ROOT" ? "root" : "ubq";
  return <div className={`processing-page ${mode}`}><span className="processing-mode">{run.source === "ROOT" ? "ROOT TABLE CLEANUP" : "UBQ BRAND CLEANUP"}</span><div className="processing-orbit"><span className="orbit-ring ring-one" /><span className="orbit-ring ring-two" /><div><WandSparkles size={30} /><b>{progress}%</b></div></div><span className="processing-eyebrow">VALIDATION ENGINE RUNNING</span><h1>Checking {run.count.toLocaleString()} brand{run.count === 1 ? "" : "s"}</h1><p>{run.filename}</p><div className="process-progress"><i style={{ width: `${progress}%` }} /></div><div className="process-modules">{run.steps.map((step, index) => <div className={index < run.current ? "done" : index === run.current ? "active" : ""} key={step}><span>{index < run.current ? <Check size={14} /> : index === run.current ? <Activity size={14} /> : index + 1}</span><div><b>{step}</b><small>{index < run.current ? "Checked" : index === run.current ? "Searching now…" : "Waiting"}</small></div>{index === run.current && <em><i /><i /><i /></em>}</div>)}</div><small className="processing-note"><ShieldCheck size={13} />All local checks run on this Mac. Your data is not uploaded.</small></div>;
}

function Dashboard({ data, records, avg, pending, onNavigate, onImport }: { data: AppData; records: BrandRecord[]; avg: number; pending: number; onNavigate: (v: View) => void; onImport: (name: string, rows: ReturnType<typeof parseCsv>) => void }) {
  const today = new Date().toDateString();
  const todayCount = data.batches.filter((b) => new Date(b.createdAt).toDateString() === today).length;
  const counts = (action: Action) => records.filter((r) => r.action === action).length;
  const recent = data.ledger.slice(0, 5);
  return <>
    <PageHead eyebrow="MONDAY, JULY 13" title="Good afternoon, Brand Manager" body="Here’s what’s happening across your brand validation workspace." actions={<button className="primary" onClick={() => onNavigate("imports")}><Plus size={16} />New import</button>} />
    <section className="metrics-grid">
      <MetricCard title="Today's imports" value={todayCount} delta={`${records.length} total records`} icon={FileUp} />
      <MetricCard title="Pending review" value={pending} delta={pending ? "Needs your attention" : "Queue is clear"} icon={FileClock} tone="amber" />
      <MetricCard title="Brands created" value={counts("CREATE")} delta="New canonical brands" icon={Sparkles} tone="purple" />
      <MetricCard title="Brands merged" value={counts("MERGE")} delta="Matched automatically" icon={Boxes} tone="blue" />
      <MetricCard title="Avg. confidence" value={`${avg}%`} delta={avg >= 90 ? "High quality decisions" : "Review will improve this"} icon={Gauge} tone="coral" />
    </section>
    {!records.length ? <WelcomePanel onImport={onImport} onNavigate={onNavigate} /> : <>
      <section className="dashboard-grid">
        <div className="panel chart-panel"><div className="panel-head"><div><h2>Validation activity</h2><p>Brand decisions in this workspace</p></div><button className="subtle">Last 30 days <ChevronDown size={14} /></button></div><ActionChart records={records} /></div>
        <div className="panel"><div className="panel-head"><div><h2>Action breakdown</h2><p>{records.length} brands processed</p></div></div><DonutChart records={records} /></div>
      </section>
      <section className="panel recent-panel"><div className="panel-head"><div><h2>Recent decisions</h2><p>Latest activity across imports and reviews</p></div><button className="text-button" onClick={() => onNavigate("ledger")}>View review history →</button></div>
        {recent.length ? <div className="activity-list">{recent.map((r) => <div key={r.ledgerId}><div className={`activity-icon ${r.action.toLowerCase()}`}><Activity size={15} /></div><div><b>{r.name}</b><p>{r.reason}</p></div><ActionPill action={r.action} /><time>{fmtTime(r.date)}</time></div>)}</div> : <EmptyState icon={History} title="No reviewed decisions yet" body="Manual decisions appear here after you review a brand." />}
      </section>
    </>}
  </>;
}

function WelcomePanel({ onImport, onNavigate }: { onImport: (name: string, rows: ReturnType<typeof parseCsv>) => void; onNavigate: (v: View) => void }) {
  return <div className="welcome-panel"><div className="welcome-art"><div className="orbit o1" /><div className="orbit o2" /><WandSparkles size={34} /><span className="mini-card c1">BMW OE <b>MERGE</b></span><span className="mini-card c2">Motrio <b>CREATE</b></span></div><div><span className="eyebrow">YOUR VALIDATION WORKSPACE</span><h2>Turn unmapped brands into clean catalog decisions</h2><p>Upload a CSV and Brandmaster will normalize names, check your knowledge base, recommend actions, and route uncertain matches to review—all locally on your Mac.</p><div className="button-row"><button className="primary" onClick={() => onNavigate("imports")}><UploadCloud size={17} />Upload CSV</button><button className="secondary" onClick={() => onImport("brandmaster-sample.csv", parseCsv(SAMPLE))}><Sparkles size={17} />Try sample data</button></div><div className="feature-row"><span><Check size={14} />Works offline</span><span><Check size={14} />No API key required</span><span><Check size={14} />Export ready</span></div></div></div>;
}

function ActionChart({ records }: { records: BrandRecord[] }) {
  const values = (["MERGE", "CREATE", "SKIP", "DELETE"] as Action[]).map((action) => ({ action, count: records.filter((r) => r.action === action).length }));
  const max = Math.max(1, ...values.map((v) => v.count));
  return <div className="bar-chart"><div className="axis"><span>{max}</span><span>{Math.ceil(max / 2)}</span><span>0</span></div><div className="bars">{values.map((v) => <div key={v.action}><div className={`bar ${v.action.toLowerCase()}`} style={{ height: `${Math.max(5, v.count / max * 100)}%` }}><em>{v.count}</em></div><span>{v.action}</span></div>)}</div></div>;
}

function DonutChart({ records }: { records: BrandRecord[] }) {
  const total = records.length || 1; let offset = 0;
  const colors: Record<Action, string> = { MERGE: "#287a5b", CREATE: "#7766c6", SKIP: "#dd9b38", DELETE: "#d65c5c" };
  return <div className="donut-wrap"><svg viewBox="0 0 42 42" className="donut"><circle cx="21" cy="21" r="15.9" fill="none" stroke="var(--surface-3)" strokeWidth="5" />{(["MERGE", "CREATE", "SKIP", "DELETE"] as Action[]).map((a) => { const value = records.filter((r) => r.action === a).length; const size = value / total * 100; const node = <circle key={a} cx="21" cy="21" r="15.9" fill="none" stroke={colors[a]} strokeWidth="5" strokeDasharray={`${size} ${100-size}`} strokeDashoffset={-offset} />; offset += size; return node; })}</svg><div className="donut-label"><b>{records.length}</b><span>Total</span></div><div className="legend">{(["MERGE", "CREATE", "SKIP", "DELETE"] as Action[]).map((a) => <div key={a}><i style={{ background: colors[a] }} />{a}<b>{records.filter((r) => r.action === a).length}</b></div>)}</div></div>;
}

function Imports({ batches, onImport, onNavigate, onRestart, ubqSource }: { batches: ImportBatch[]; onImport: (name: string, rows: ReturnType<typeof parseCsv>) => void; onNavigate: (v: View) => void; onRestart: () => void; ubqSource: UbqSource | null }) {
  const input = useRef<HTMLInputElement>(null); const [drag, setDrag] = useState(false); const [error, setError] = useState(""); const [brandNames, setBrandNames] = useState(""); const [inputMode, setInputMode] = useState<"csv" | "paste">("csv");
  function accept(file?: File) { if (!file) return; if (!file.name.toLowerCase().endsWith(".csv")) { setError("Please choose a CSV file."); return; } const reader = new FileReader(); reader.onload = () => { const rows = parseCsv(String(reader.result)); if (!rows.length) setError("No brand rows found. Include UnmappedBrandID and UnmappedBrandName columns."); else { setError(""); onImport(file.name, rows); } }; reader.readAsText(file); }
  function drop(e: DragEvent) { e.preventDefault(); setDrag(false); accept(e.dataTransfer.files[0]); }
  const pastedNames = [...new Map(brandNames.split(/\r?\n/).map((name) => name.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim()).filter(Boolean).map((name) => [name.toLowerCase(), name])).values()];
  function validatePasted() { onImport("pasted-brand-list.csv", pastedNames.map((name, index) => ({ id: `missing_id_${String(index + 1).padStart(5, "0")}`, name }))); }
  return <><WorkflowStepper stage={1} onNavigate={onNavigate} onRestart={onRestart} hasImport={batches.length > 0} />
    <PageHead eyebrow="STEP 1 OF 3" title="Add brands to validate" body="Upload a CSV or paste brand names, then run validation." />
    <section className="compact-import"><div className="input-mode-tabs"><div><button className={inputMode === "csv" ? "active" : ""} onClick={() => setInputMode("csv")}><FileUp size={15} />Upload CSV</button><button className={inputMode === "paste" ? "active" : ""} onClick={() => setInputMode("paste")}><WandSparkles size={15} />Paste brands</button></div><button className="text-button" onClick={() => download("brandmaster-template.csv", "UnmappedBrandID,UnmappedBrandName,Seller Count\n")}><ArrowDownToLine size={13} />Template</button></div>
      {inputMode === "csv" ? <div className={`dropzone compact ${drag ? "drag" : ""}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={drop} onClick={() => input.current?.click()}><input ref={input} type="file" accept=".csv,text/csv" hidden onChange={(e: ChangeEvent<HTMLInputElement>) => accept(e.target.files?.[0])} /><div className="drop-icon"><UploadCloud size={23} /></div><div><h2>Drop CSV or click to browse</h2><p>Brand ID + Brand Name · up to 10 MB</p></div><button className="primary">Choose CSV</button></div> : <div className="compact-paste"><textarea value={brandNames} onChange={(e) => setBrandNames(e.target.value)} placeholder={"One brand per line…\npegaso\nb & p rods\nvolkswagen oe"} /><div className="compact-paste-footer"><div className={`id-mini ${ubqSource ? "ready" : ""}`}>{ubqSource ? <Check size={12} /> : <CircleHelp size={12} />}{ubqSource ? "UBQ IDs ready" : "UBQ IDs not configured"}</div>{!ubqSource && <button className="text-button" onClick={() => onNavigate("settings")}>Configure in Validation modules →</button>}<span>{pastedNames.length} unique</span><button className="primary" disabled={!pastedNames.length} onClick={validatePasted}><WandSparkles size={15} />Validate {pastedNames.length || ""}</button></div></div>}
    </section>{error && <div className="error-banner"><CircleHelp size={17} />{error}</div>}
    {batches.length > 0 && <div className="imports-page-history-link"><button className="text-button" onClick={() => onNavigate("artifacts")}><Archive size={14} />View import history in Data & artifacts →</button></div>}
  </>;
}

function AiReviewAssist({ records, knownBrandIds, onUpdate }: { records: BrandRecord[]; knownBrandIds: Set<string>; onUpdate: (id: string, changes: Partial<BrandRecord>, learn?: boolean) => void }) {
  const [open, setOpen] = useState(false); const [copied, setCopied] = useState(false); const [response, setResponse] = useState(""); const [result, setResult] = useState<ReturnType<typeof parseAiReviewJson> | null>(null); const jsonInput = useRef<HTMLInputElement>(null);
  const prompt = useMemo(() => buildAiReviewPrompt(records), [records]);
  async function copyPrompt() { await navigator.clipboard.writeText(prompt); setCopied(true); setTimeout(() => setCopied(false), 1800); }
  function setJson(value: string) { setResponse(value); setResult(null); }
  async function importJson(file?: File) { if (!file) return; if (file.size > 5_000_000) { setResult({ changes: [], errors: ["JSON files must be 5 MB or smaller."] }); return; } setJson(await file.text()); }
  function validate() { setResult(parseAiReviewJson(response, records, knownBrandIds)); }
  function apply() {
    if (!result || result.errors.length) return;
    result.changes.forEach((change) => onUpdate(change.recordId, {
      action: change.action, targetId: change.targetId, targetName: change.targetName, confidence: change.confidence,
      reason: change.reason, evidence: ["Imported external AI review", ...change.evidence], decisionSource: "AI review JSON", blockedByTargetCreation: false,
    }, true));
    setResponse(""); setResult(null); setOpen(false);
  }
  return <section className={`ai-review ${open ? "open" : ""}`}>
    <div className="ai-review-head"><div className="gpt-icon"><Sparkles size={18} /></div><div><span>OPTIONAL EXTERNAL AI REVIEW</span><b>Check all {records.length} decisions with your validation GPT</b><p>Brandmaster generates the prompt and safely imports the returned JSON. No API key is stored here.</p></div><button className={open ? "secondary" : "primary"} onClick={() => setOpen(!open)}>{open ? <X size={15} /> : <Sparkles size={15} />}{open ? "Close" : "Check with AI validator"}</button></div>
    {open && <div className="ai-review-body">
      <div className="ai-review-step"><div className="step-number">1</div><div className="ai-review-content"><div className="ai-review-title"><div><h3>Generate the validator prompt</h3><p>It includes every current action and requires strict JSON with unchanged unmapped IDs.</p></div><div><button className="secondary" onClick={() => download("brandmaster-ai-review-prompt.txt", prompt)}><ArrowDownToLine size={14} />Download</button><button className="primary" onClick={copyPrompt}>{copied ? <Check size={14} /> : <BookOpen size={14} />}{copied ? "Copied" : "Copy prompt"}</button></div></div><textarea className="prompt-preview" value={prompt} readOnly /></div></div>
      <div className="ai-review-step"><div className="step-number">2</div><div className="ai-review-content"><div className="ai-review-title"><div><h3>Paste or import the returned JSON</h3><p>Paste the raw response or select the JSON file created by your validator.</p></div><div><input ref={jsonInput} type="file" accept=".json,application/json" hidden onChange={(event) => { void importJson(event.target.files?.[0]); event.target.value = ""; }} /><button className="secondary" onClick={() => jsonInput.current?.click()}><FileUp size={14} />Import JSON</button></div></div><textarea className="json-response" value={response} onChange={(event) => setJson(event.target.value)} placeholder={'{"schemaVersion":"brandmaster.ai-review.v1","decisions":[...]}'}/><div className="json-actions"><span>{response ? `${response.length.toLocaleString()} characters ready` : "Waiting for validator JSON"}</span><button className="primary" disabled={!response.trim()} onClick={validate}><ShieldCheck size={14} />Validate AI response</button></div></div></div>
      {result && <div className={`ai-review-result ${result.errors.length ? "invalid" : "valid"}`}><div className="step-number">3</div><div className="ai-review-content"><div className="result-summary">{result.errors.length ? <X size={18} /> : <Check size={18} />}<div><h3>{result.errors.length ? "JSON needs correction" : `${result.changes.length} revisions are ready`}</h3><p>{result.errors.length ? "Nothing will be applied until every row passes validation." : "Review the preview, then update the Process & Review table with one click."}</p></div></div>{result.errors.length > 0 ? <ul className="json-errors">{result.errors.slice(0, 10).map((error) => <li key={error}>{error}</li>)}{result.errors.length > 10 && <li>And {result.errors.length - 10} more errors…</li>}</ul> : <><div className="ai-result-table"><div><b>Brand</b><b>Revised action</b><b>Confidence</b><b>Target / reason</b></div>{result.changes.slice(0, 20).map((change) => { const record = records.find((item) => item.id === change.recordId)!; return <div key={change.recordId}><span>{record.name}</span><ActionPill action={change.action} /><b>{change.confidence}%</b><span>{change.targetName ? `${change.targetName}${change.targetId ? ` · ${change.targetId}` : ""}` : change.reason}</span></div>; })}</div>{result.changes.length > 20 && <p className="preview-more">Plus {result.changes.length - 20} additional validated revisions</p>}<button className="primary apply-ai" onClick={apply}><Check size={15} />Apply all {result.changes.length} AI revisions</button></>}</div></div>}
    </div>}
  </section>;
}

function InlineReviewEditor({ record, rootMode = false, onCancel, onFullReview, onSave }: { record: BrandRecord; rootMode?: boolean; onCancel: () => void; onFullReview: () => void; onSave: (id: string, changes: Partial<BrandRecord>, learn?: boolean) => void }) {
  const [unmappedId, setUnmappedId] = useState(record.id.startsWith("missing_id_") ? "" : record.id);
  const [action, setAction] = useState<Action>(record.action);
  const [targetId, setTargetId] = useState(record.targetId || "");
  const [targetName, setTargetName] = useState(record.targetName || record.normalized);
  const validId = rootMode ? unmappedId.startsWith("brand_") : unmappedId.startsWith("draft_brand_");
  const valid = validId && (action !== "MERGE" || (targetId.startsWith("brand_") && targetId !== unmappedId && Boolean(targetName.trim()))) && (action !== "CREATE" || Boolean(targetName.trim()));
  function changeAction(next: Action) {
    setAction(next);
    if (next === "CREATE") { setTargetId(""); setTargetName(targetName.trim() || record.normalized); }
    if (next === "SKIP" || next === "DELETE") { setTargetId(""); setTargetName(""); }
  }
  function save() {
    if (!valid) return;
    onSave(record.id, {
      id: unmappedId, ubqVerified: rootMode ? record.ubqVerified : true, action,
      targetId: action === "MERGE" ? targetId.trim() : undefined,
      targetName: action === "MERGE" || action === "CREATE" ? targetName.trim() : undefined,
      confidence: 100, reason: `Inline manual review: ${action}`, decisionSource: "Inline manual review", blockedByTargetCreation: false,
    }, true);
    onCancel();
  }
  return <div className="inline-review-editor" onClick={(event) => event.stopPropagation()}><div className="inline-editor-head"><div><Pencil size={15} /><span><b>Edit {record.name}</b><small>Fast manual review · the full side window is still available</small></span></div><button className="text-button" onClick={onFullReview}>Open full review →</button></div><div className="inline-editor-fields">
    <label><span>{rootMode ? "Root BrandID" : "UnmappedBrandID"}</span><input value={unmappedId} readOnly={rootMode} onChange={(event) => setUnmappedId(event.target.value.trim())} placeholder={rootMode ? "brand_..." : "draft_brand_..."} /><small className={validId ? "valid" : "invalid"}>{validId ? (rootMode ? "Existing Root record" : "Valid ID") : `Required: ${rootMode ? "brand_" : "draft_brand_"}…`}</small></label>
    <label><span>{rootMode ? "Root recommendation" : "Action"}</span><select value={action} onChange={(event) => changeAction(event.target.value as Action)}>{(["MERGE", "CREATE", "SKIP", "DELETE"] as Action[]).map((item) => <option key={item} value={item}>{rootMode ? (item === "MERGE" ? "CONSOLIDATE" : item === "CREATE" ? "EDIT / KEEP" : item) : item}</option>)}</select></label>
    {action === "MERGE" && <label><span>TargetBrandID</span><input value={targetId} onChange={(event) => setTargetId(event.target.value.trim())} placeholder="brand_..." /></label>}
    {(action === "MERGE" || action === "CREATE") && <label><span>TargetBrandName</span><input value={targetName} onChange={(event) => setTargetName(event.target.value)} placeholder="Canonical brand name" /></label>}
  </div><div className="inline-editor-actions"><span>{rootMode ? (action === "MERGE" ? "Choose the different canonical BrandID that should own this alias." : action === "CREATE" ? "Correct the canonical name, then perform the edit in Admin." : action === "DELETE" ? "This saves a persistent delete/block recommendation." : "No Root change will be recommended.") : action === "SKIP" || action === "DELETE" ? "Target fields will remain blank." : action === "CREATE" ? "TargetBrandID will remain blank." : "MERGE requires both target fields."}</span><button className="secondary" onClick={onCancel}>Cancel</button><button className="primary" disabled={!valid} onClick={save}><Check size={14} />{rootMode ? "Save task" : "Save row"}</button></div></div>;
}

function ReviewQueue({ records, batch, knownBrandIds, onUpdate, onSelect, query, onNavigate, onRestart }: { records: BrandRecord[]; batch?: ImportBatch; knownBrandIds: Set<string>; onUpdate: (id: string, changes: Partial<BrandRecord>, learn?: boolean) => void; onSelect: (r: BrandRecord) => void; query: string; onNavigate: (view: View) => void; onRestart: () => void }) {
  const [filter, setFilter] = useState<"all" | "needs-review" | "reviewed">("all");
  const [actionFilter, setActionFilter] = useState<"ALL" | Action>("ALL");
  const [checked, setChecked] = useState<string[]>([]);
  const [inlineEditId, setInlineEditId] = useState<string | null>(null);
  const visible = records.filter((r) => (filter === "all" || r.status === filter) && (actionFilter === "ALL" || r.action === actionFilter) && `${r.name} ${r.normalized} ${r.action}`.toLowerCase().includes(query.toLowerCase()));
  const rootMode = batch?.workflowSource === "ROOT";
  const readiness = getBulkExportReadiness(records);
  const needs = readiness.needsReview.length;
  const unverified = rootMode ? 0 : readiness.invalidIds.length;
  const verified = records.length - unverified;
  const invalidMerges = readiness.incompleteMerges.length;
  const rootIncomplete = rootMode ? records.filter((record) => record.action === "MERGE" && (!record.targetId?.startsWith("brand_") || record.targetId === record.id || !record.targetName?.trim())).length : 0;
  const blockedFamilies = rootMode ? 0 : records.filter((record) => record.blockedByTargetCreation).length;
  const exportReady = rootMode ? needs === 0 && rootIncomplete === 0 : readiness.ready && blockedFamilies === 0;
  const ubqFamilyRecords = rootMode ? [] : records.filter((record) => record.relatedUbq?.length);
  const ubqFamilyGroups = new Set(ubqFamilyRecords.map((record) => record.ubqFamilyCanonicalId || record.id)).size;
  const staleMergedRows = ubqFamilyRecords.filter((record) => record.previouslyMergedStillPresent).length;
  function bulk(action?: Action) { checked.forEach((id) => { const r = records.find((item) => item.id === id); if (r) onUpdate(id, { action: action || r.action, reason: action ? `Manually set to ${action}` : r.reason, blockedByTargetCreation: false }, true); }); setChecked([]); }
  if (!records.length) return <><WorkflowStepper stage={2} onNavigate={onNavigate} /><PageHead eyebrow="STEP 2 OF 3" title="Process and review" body="Confirm recommendations before generating a file for the real bulk-upload tool." /><div className="panel"><EmptyState icon={FileClock} title="Import a CSV first" body="Start at step 1 with a CSV containing Brand ID and Brand Name." action={<button className="primary" onClick={() => onNavigate("imports")}>Go to Import CSV</button>} /></div></>;
  return <><WorkflowStepper stage={2} onNavigate={onNavigate} onRestart={onRestart} hasImport outputReady={exportReady} rootMode={rootMode} /><PageHead eyebrow={rootMode ? "ROOT CLEANUP · REVIEW" : "UBQ CLEANUP · STEP 2 OF 3"} title={rootMode ? "Review Root consolidation tasks" : "Process and review"} body={`${needs} brand${needs === 1 ? "" : "s"} still require a decision. ${rootMode ? "Each saved row becomes a persistent Admin recommendation—there is no Root bulk-upload Step 3." : "High-confidence rows are already prepared."}`} actions={<>{unverified > 0 && <button className="secondary" onClick={() => onNavigate("settings")}><Database size={15} />Load UBQ to fix {unverified} IDs</button>}{rootMode ? <button className="primary" disabled={!exportReady} onClick={() => onNavigate("brands")}><Check size={15} />Finish and view pending tasks</button> : <button className="primary" disabled={!exportReady} title={!exportReady ? "Resolve the remaining checks first" : "Continue to the output file"} onClick={() => onNavigate("output")}>Continue to bulk output →</button>}</>} />
    <section className={`workflow-mode-banner ${rootMode ? "root" : "ubq"}`}><span>{rootMode ? <Database size={21} /> : <FileClock size={21} />}</span><div><b>{rootMode ? "ROOT TABLE CLEANUP IS ACTIVE" : "UBQ MAPPING CLEANUP IS ACTIVE"}</b><p>{rootMode ? "CONSOLIDATE links a duplicate to a different target BrandID. EDIT / KEEP corrects the canonical name. DELETE recommends blocking the source record. Use Admin on each row to perform the real change." : "These are unknown-brand queue records. Review every action, use Search on Admin when needed, then generate the exact five-column bulk upload in Step 3."}</p></div></section>
    {ubqFamilyRecords.length > 0 && <section className="ubq-family-banner"><span><Boxes size={22} /></span><div><b>{ubqFamilyGroups} possible UBQ brand {ubqFamilyGroups === 1 ? "family" : "families"} detected</b><p>{ubqFamilyRecords.length} rows resemble other names in the loaded UBQ table. Brandmaster propagates an existing or previously used Root target to every remaining family variation. Without one, it recommends one canonical CREATE and holds related rows to prevent duplicate brands.{staleMergedRows ? ` ${staleMergedRows} previously merged row${staleMergedRows === 1 ? " is" : "s are"} still present and flagged for re-MERGE or verified DELETE.` : ""}</p></div><strong>{ubqFamilyRecords.length}<small>related rows</small></strong></section>}
    <div className={`readiness ${exportReady ? "complete" : ""}`}><div>{exportReady ? <Check size={17} /> : <ShieldCheck size={17} />}<span><b>{exportReady ? "Processing complete" : "Resolve these checks to continue"}</b><small>{rootMode ? "Root BrandIDs stay unchanged; MERGE cannot target the same record" : blockedFamilies ? `${blockedFamilies} UBQ variation${blockedFamilies === 1 ? " is" : "s are"} waiting for a canonical BrandID or an explicit reviewer decision` : unverified ? "Load a full UBQ export in Validation modules to replace missing IDs automatically" : `${verified} of ${records.length} rows have valid unmapped IDs`}</small></span></div><div><span>{unverified}<small>{rootMode ? "ID issues" : "Invalid IDs"}</small></span><span>{needs}<small>Needs review</small></span><span>{rootMode ? rootIncomplete : invalidMerges}<small>Incomplete merges</small></span>{!rootMode && <span>{blockedFamilies}<small>Waiting for target</small></span>}</div></div>
    <AiReviewAssist records={records} knownBrandIds={knownBrandIds} onUpdate={onUpdate} />
    <div className="review-toolbar"><div className="tabs"><button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>All <span>{records.length}</span></button><button className={filter === "needs-review" ? "active" : ""} onClick={() => setFilter("needs-review")}>Needs review <span>{needs}</span></button><button className={filter === "reviewed" ? "active" : ""} onClick={() => setFilter("reviewed")}>Reviewed <span>{records.filter((r) => r.status === "reviewed").length}</span></button></div><label className="action-filter">Action<select value={actionFilter} onChange={(event) => setActionFilter(event.target.value as "ALL" | Action)}><option value="ALL">All actions</option>{(["MERGE", "CREATE", "SKIP", "DELETE"] as Action[]).map((action) => <option key={action}>{action}</option>)}</select><ChevronDown size={14} /></label></div>
    {checked.length > 0 && <div className="bulk-bar"><b>{checked.length} selected</b><button onClick={() => bulk()}>Approve</button><button onClick={() => bulk("MERGE")}>Merge</button><button onClick={() => bulk("SKIP")}>Skip</button><button onClick={() => bulk("DELETE")}>Delete</button><button className="icon-button" onClick={() => setChecked([])}><X size={16} /></button></div>}
    <div className="table-panel"><div className="data-table review-table research-enabled"><div className="table-row table-head-row"><div><input type="checkbox" checked={visible.length > 0 && visible.every((r) => checked.includes(r.id))} onChange={(e) => setChecked(e.target.checked ? visible.map((r) => r.id) : [])} /></div><div>{rootMode ? "Root brand" : "Unmapped brand"}</div><div>Normalized</div><div>Action</div><div>Source</div><div>Confidence</div><div>Status</div><div>Manual research</div><div>Edit</div></div>
      {visible.map((r) => <Fragment key={r.id}>
        <div className={`table-row ${inlineEditId === r.id ? "editing" : ""}`} onClick={() => onSelect(r)}>
          <div onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={checked.includes(r.id)} onChange={(e) => setChecked(e.target.checked ? [...checked, r.id] : checked.filter((id) => id !== r.id))} /></div>
          <div className="brand-cell"><b>{r.name}</b>{rootMode ? <><span>{r.id}</span><span className="ubq-badge"><Check size={10} />Root source</span></> : r.ubqVerified ? <><span>{r.id}</span><span className="ubq-badge"><Check size={10} />ID verified</span></> : <span className="missing-brand-id">Missing ID — load UBQ</span>}{!rootMode && r.relatedUbq?.length ? <span className="ubq-family-badge"><Boxes size={10} />{r.relatedUbq.length} related UBQ name{r.relatedUbq.length === 1 ? "" : "s"}</span> : null}{r.previouslyMergedStillPresent ? <span className="stale-merged-badge"><History size={10} />Previously merged · still in UBQ</span> : null}</div>
          <div><b>{r.normalized}</b>{r.name !== r.normalized && <span className="normalized-note">Normalized</span>}</div>
          <div>{rootMode ? <RootActionPill action={r.action} /> : <ActionPill action={r.action} />}{r.targetName && <small>→ {r.targetName}</small>}{r.action === "MERGE" && r.suggestedAliases?.length ? <small className="alias-suggestion"><Tags size={9} />Add {r.suggestedAliases.length} alias{r.suggestedAliases.length === 1 ? "" : "es"}</small> : null}</div>
          <div><span className="source-pill">{r.decisionSource || "Legacy decision"}</span></div><div><Confidence value={r.confidence} /></div>
          <div>{r.status === "needs-review" ? <span className="status review">Needs review</span> : r.status === "reviewed" ? <span className="status done"><Check size={12} />Saved task</span> : <span className="status ready"><Sparkles size={12} />Auto-ready</span>}</div>
          <div className="row-research-actions" onClick={(event) => event.stopPropagation()}><ResearchLinks name={r.name} />{rootMode ? <AdminBrandLink id={r.id} name={r.name} /> : <AdminUnknownBrandLink name={r.name} />}</div>
          <div onClick={(event) => event.stopPropagation()}><button className="icon-button row-edit" onClick={() => setInlineEditId(inlineEditId === r.id ? null : r.id)} title={`Edit ${r.name} in this table`}><Pencil size={14} /></button></div>
        </div>
        {inlineEditId === r.id && <InlineReviewEditor record={r} rootMode={rootMode} onCancel={() => setInlineEditId(null)} onFullReview={() => { setInlineEditId(null); onSelect(r); }} onSave={onUpdate} />}
      </Fragment>)}
    </div>{!visible.length && <EmptyState icon={Search} title="No matching records" body="Try another search or queue filter." />}</div>
    <p className="table-caption">Showing {visible.length} of {records.length} brands · Use the pencil for fast editing, or select the row to open the full side review.</p>
  </>;
}

function BulkOutput({ records, batch, data, onNavigate, onRestart }: { records: BrandRecord[]; batch?: ImportBatch; data: AppData; onNavigate: (view: View) => void; onRestart: () => void }) {
  const rootMode = batch?.workflowSource === "ROOT";
  const readiness = getBulkExportReadiness(records);
  const needs = records.filter((record) => record.status === "needs-review").length;
  const invalidIds = readiness.invalidIds.length;
  const invalidMerges = readiness.incompleteMerges.length;
  const invalidCreates = readiness.incompleteCreates.length;
  const rootIncomplete = rootMode ? records.filter((record) => record.action === "MERGE" && (!record.targetId?.startsWith("brand_") || record.targetId === record.id || !record.targetName?.trim())).length : 0;
  const ready = rootMode ? needs === 0 && rootIncomplete === 0 : readiness.ready;
  const count = (action: Action) => records.filter((r) => r.action === action).length;
  const rootIds = new Set(records.map((record) => record.sourceBrandId || record.id));
  const rootChanges = Object.values(data.rootChanges).filter((change) => rootIds.has(change.id) && change.adminStatus !== "REJECTED" && change.adminStatus !== "SUPERSEDED");
  if (rootMode) return <><WorkflowStepper stage={2} onNavigate={onNavigate} onRestart={onRestart} hasImport={records.length > 0} rootMode /><PageHead eyebrow="ROOT CLEANUP" title="Root cleanup does not use Bulk Step 3" body="Root recommendations are saved as persistent workspace tasks. Perform the actual edit, alias consolidation, or deletion in the Admin portal; a future Root import will verify the result." /><section className="root-no-bulk"><div><Database size={28} /><span><b>{rootChanges.filter((change) => change.status !== "APPLIED").length} Admin task{rootChanges.filter((change) => change.status !== "APPLIED").length === 1 ? "" : "s"} pending</b><p>The UBQ workflow still uses Step 3 and retains the exact required five-column bulk-upload CSV.</p></span></div><div><button className="secondary" onClick={() => onNavigate("review")}>Return to Root review</button><button className="primary" onClick={() => onNavigate("brands")}>View pending Root tasks</button></div></section></>;
  return <><WorkflowStepper stage={3} onNavigate={onNavigate} onRestart={onRestart} hasImport={records.length > 0} outputReady={ready} rootMode={rootMode} />
    <PageHead eyebrow="STEP 3 OF 3" title={rootMode ? "Root table cleanup output" : "Bulk output CSV"} body={rootMode ? "Download the staged Root changes or open each source record in the admin tool. This is separate from the UBQ bulk mapping file." : "Download the finished mapping file, then upload it in the real Bulk Upload Brand Mappings tool."} />
    {!records.length ? <div className="panel"><EmptyState icon={FileUp} title="No processed worklist" body="Import brands or select Root/UBQ records from Brand management." action={<button className="primary" onClick={() => onNavigate("brands")}>Open Brand management</button>} /></div> : !ready ? <div className="output-blocked"><div className="output-status-icon"><FileClock size={24} /></div><h2>Your output needs attention</h2><p>Return to processing and resolve every check before downloading the output.</p><div className="output-checks">{!rootMode && <span className={invalidIds ? "bad" : "good"}>{invalidIds ? <X size={14} /> : <Check size={14} />}Valid unmapped IDs <b>{invalidIds ? `${invalidIds} missing` : "Complete"}</b></span>}<span className={needs ? "bad" : "good"}>{needs ? <X size={14} /> : <Check size={14} />}Review decisions <b>{needs ? `${needs} remaining` : "Complete"}</b></span><span className={(rootMode ? rootIncomplete : invalidMerges) ? "bad" : "good"}>{(rootMode ? rootIncomplete : invalidMerges) ? <X size={14} /> : <Check size={14} />}MERGE targets <b>{(rootMode ? rootIncomplete : invalidMerges) ? `${rootMode ? rootIncomplete : invalidMerges} incomplete` : "Complete"}</b></span>{!rootMode && <span className={invalidCreates ? "bad" : "good"}>{invalidCreates ? <X size={14} /> : <Check size={14} />}CREATE target names <b>{invalidCreates ? `${invalidCreates} incomplete` : "Complete"}</b></span>}</div><button className="primary" onClick={() => onNavigate("review")}>Return to process & review</button></div> : rootMode ? <>
      <div className="output-success"><div className="output-status-icon"><Check size={25} /></div><div><span>ROOT CLEANUP STAGED</span><h2>{rootChanges.length.toLocaleString()} Root table changes are ready</h2><p>MERGE stages sameAs + INACTIVE, DELETE stages BLOCKED, and CREATE keeps or renames the canonical record.</p></div><button className="primary output-download" disabled={!rootChanges.length} onClick={() => download("brandmaster-root-table-changes.csv", toRootChangesCsv(rootChanges))}><ArrowDownToLine size={17} />Download Root changes CSV</button></div>
      <section className="panel output-preview"><div className="panel-head"><div><h2>Root cleanup actions</h2><p>Open Admin for the actual source record when a direct edit or delete is required.</p></div><span className="status done"><Check size={12} />{rootChanges.length} staged changes</span></div><div className="root-output-list">{records.map((record) => <div key={record.id}><span><b>{record.name}</b><code>{record.id}</code></span><ActionPill action={record.action} /><span>{record.action === "MERGE" ? `sameAs ${record.targetName} · ${record.targetId}` : record.action === "DELETE" ? "Status → BLOCKED" : record.action === "CREATE" ? `Canonical name → ${record.targetName}` : "No Root change"}</span><AdminBrandLink id={record.id} name={record.name} compact /></div>)}</div></section>
    </> : <>
      <div className="output-success"><div className="output-status-icon"><Check size={25} /></div><div><span>READY FOR BULK UPLOAD</span><h2>{records.length.toLocaleString()} brand mappings passed every check</h2><p>The file contains only the five columns accepted by the real upload tool.</p></div><button className="primary output-download" onClick={() => download("brandmaster-bulk-brand-mappings.csv", toCsv(records))}><ArrowDownToLine size={17} />Download bulk output CSV</button></div>
      <section className="output-summary"><div><b>{records.length}</b><span>Total rows</span></div><div className="merge"><b>{count("MERGE")}</b><span>MERGE</span></div><div className="create"><b>{count("CREATE")}</b><span>CREATE</span></div><div className="skip"><b>{count("SKIP")}</b><span>SKIP</span></div><div className="delete"><b>{count("DELETE")}</b><span>DELETE</span></div></section>
      <section className="panel output-preview"><div className="panel-head"><div><h2>File preview</h2><p>{batch?.filename} → brandmaster-bulk-brand-mappings.csv</p></div><span className="status done"><Check size={12} />5 required columns</span></div><div className="output-table"><div><b>UnmappedBrandID</b><b>UnmappedBrandName</b><b>Action</b><b>TargetBrandID</b><b>TargetBrandName</b></div>{records.slice(0, 6).map((r) => <div key={r.id}><code>{r.id}</code><span>{r.name}</span><ActionPill action={r.action} /><code>{r.action === "MERGE" ? r.targetId : ""}</code><span>{r.action === "CREATE" || r.action === "MERGE" ? r.targetName : ""}</span></div>)}</div>{records.length > 6 && <p className="preview-more">Previewing 6 of {records.length.toLocaleString()} rows</p>}</section>
    </>}
  </>;
}

function DecisionDrawer({ record, brands, onClose, onSave }: { record: BrandRecord; brands: CatalogBrand[]; onClose: () => void; onSave: (id: string, changes: Partial<BrandRecord>, learn?: boolean) => void }) {
  const [action, setAction] = useState<Action>(record.action); const [unmappedId, setUnmappedId] = useState(record.id); const [target, setTarget] = useState(record.targetId || ""); const [targetName, setTargetName] = useState(record.targetName || record.normalized); const [notes, setNotes] = useState(record.notes || "");
  const rootMode = record.workflowSource === "ROOT";
  return <><div className="drawer-scrim" onClick={onClose} /><aside className="drawer"><div className="drawer-head"><div><span>BRAND DECISION</span><h2>{record.name}</h2></div><button className="icon-button" onClick={onClose}><X size={20} /></button></div><div className="drawer-body">
    <div className="name-transform"><div><span>Original</span><b>{record.name}</b></div><strong>→</strong><div><span>Normalized</span><b>{record.normalized}</b></div></div>
    <label className="field identity-field"><span>{rootMode ? "Root BrandID" : "UnmappedBrandID"}</span><input readOnly={rootMode} value={unmappedId.startsWith("missing_id_") ? "" : unmappedId} onChange={(e) => setUnmappedId(e.target.value.trim())} placeholder={rootMode ? "brand_..." : "draft_brand_..."} /><small>{rootMode ? "Existing source identity is locked. The reviewed action will stage a Root table change." : unmappedId.startsWith("draft_brand_") ? "Valid bulk-upload ID format" : "A real UBQ draft_brand_… ID is required before export. Load the UBQ export to resolve it automatically."}</small></label>
    {!rootMode && record.relatedUbq?.length ? <section className="drawer-ubq-family"><h3>Related names in the UBQ table</h3><p>These are similarity clues, not valid MERGE targets unless an existing <code>brand_…</code> ID is shown.</p><div>{record.relatedUbq.map((item) => <span key={item.id}><b>{item.name}</b><small>{item.score}% · {item.reason}</small><code>{item.id}</code></span>)}</div>{record.ubqFamilyCanonicalName && <em>Suggested canonical candidate: <b>{record.ubqFamilyCanonicalName}</b></em>}</section> : null}
    {record.action === "MERGE" && record.suggestedAliases?.length ? <section className="drawer-alias-plan"><h3>Alias plan for {record.targetName}</h3><p>When this decision is saved, Brandmaster also stages these aliases as a Root Admin task.</p><div>{record.suggestedAliases.map((alias) => <span key={alias}><Tags size={12} />{alias}</span>)}</div>{record.canonicalTargetChain && record.canonicalTargetChain.length > 1 && <small>Target chain resolved: {record.canonicalTargetChain.join(" → ")}</small>}</section> : null}
    {record.previouslyMergedStillPresent && <section className="stale-merge-warning"><History size={18} /><div><b>Previously merged, but still present in UBQ</b><p>Recommended default: reapply MERGE to <strong>{record.priorFamilyTargetName}</strong> · <code>{record.priorFamilyTargetId}</code>. Choose DELETE only when Admin confirms this is a stale queue artifact with no valid listings to preserve.</p></div></section>}
    <section><h3>{rootMode ? "Admin action and research" : "Research this brand"}</h3><div className="drawer-admin-research">{rootMode ? <AdminBrandLink id={record.id} name={record.name} /> : <AdminUnknownBrandLink name={record.name} />}<ResearchLinks name={record.name} /></div></section>
    <section><h3>Recommendation</h3><div className="ai-recommendation"><div><Sparkles size={18} /><b>{record.decisionSource || "Local decision engine"}</b><Confidence value={record.confidence} /></div><ActionPill action={record.action} /><p>{record.reason}</p></div></section>
    <section><h3>Evidence</h3><div className="evidence-list">{record.evidence.map((item, i) => <div key={item}><span>{i === 0 ? <Database size={15} /> : <Search size={15} />}</span><div><b>{item}</b><p>{item.includes("Offline") ? "Connect an enrichment API in Settings for live source verification." : "Matched during local processing."}</p></div><Check size={15} /></div>)}</div></section>
    <section><h3>{rootMode ? "Root recommendation" : "Your decision"}</h3><div className="action-picker">{(["MERGE", "CREATE", "SKIP", "DELETE"] as Action[]).map((a) => <button key={a} className={`${a.toLowerCase()} ${action === a ? "active" : ""}`} onClick={() => setAction(a)}><span>{a === "MERGE" ? "↗" : a === "CREATE" ? "+" : a === "SKIP" ? "–" : "×"}</span>{rootMode ? (a === "MERGE" ? "CONSOLIDATE" : a === "CREATE" ? "EDIT / KEEP" : a) : a}<Check size={14} /></button>)}</div>
      {action === "MERGE" && <div className="merge-fields"><label className="field"><span>Known target shortcut</span><select value={brands.some((b) => b.id === target) ? target : ""} onChange={(e) => { const brand = brands.find((b) => b.id === e.target.value); setTarget(brand?.id || ""); setTargetName(brand?.name || ""); }}><option value="">Choose or enter a target below…</option>{brands.map((b) => <option key={b.id} value={b.id}>{b.name} — {b.id}</option>)}</select></label><label className="field"><span>TargetBrandID</span><input value={target} onChange={(e) => setTarget(e.target.value.trim())} placeholder="brand_xxxxxxxxxxxxxxxxxxxxxx" /></label><label className="field"><span>TargetBrandName</span><input value={targetName} onChange={(e) => setTargetName(e.target.value)} placeholder="Canonical brand name" /></label></div>}
      {action === "CREATE" && <label className="field"><span>{rootMode ? "Corrected canonical name" : "TargetBrandName"}</span><input value={targetName} onChange={(e) => setTargetName(e.target.value)} placeholder={rootMode ? "Correct Root brand name" : "Canonical brand name to create"} /><small>{rootMode ? "This records an edit recommendation; make the actual name or alias change in Admin." : "TargetBrandID stays blank for CREATE."}</small></label>}
      <label className="field"><span>Reviewer notes</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Explain this decision for the review history…" /></label>
    </section></div><div className="drawer-footer"><p><kbd>⌘</kbd><kbd>↵</kbd> Save decision</p><button className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={(action === "MERGE" && (!target.startsWith("brand_") || target === record.id || !targetName.trim())) || (action === "CREATE" && !targetName.trim())} onClick={() => onSave(record.id, { id: unmappedId, ubqVerified: rootMode ? record.ubqVerified : unmappedId.startsWith("draft_brand_"), action, targetId: action === "MERGE" ? target : undefined, targetName: action === "MERGE" || action === "CREATE" ? targetName.trim() : undefined, notes, confidence: 100, reason: rootMode ? `Validated Root cleanup: ${action}` : `Validated for bulk upload: ${action}`, blockedByTargetCreation: false }, true)}>Save decision</button></div></aside></>;
}

type CatalogSortKey = "name" | "id" | "category" | "aliases" | "country" | "source";

function researchUrl(provider: "google" | "ebay" | "amazon" | "walmart", name: string) {
  const query = provider === "google" ? `Is "${name}" an automotive parts brand or manufacturer?` : name;
  if (provider === "google") return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
  if (provider === "ebay") return `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}`;
  if (provider === "amazon") return `https://www.amazon.com/s?k=${encodeURIComponent(query)}`;
  return `https://www.walmart.com/search?q=${encodeURIComponent(query)}`;
}

function ResearchLinks({ name, compact = false }: { name: string; compact?: boolean }) {
  return <div className={`research-links ${compact ? "compact" : ""}`}>
    <a href={researchUrl("google", name)} target="_blank" rel="noopener noreferrer" title={`Search Google for ${name}`}><Globe size={14} />{!compact && "Google"}<ExternalLink size={11} /></a>
    <a href={researchUrl("ebay", name)} target="_blank" rel="noopener noreferrer" title={`Search eBay for ${name}`}><Search size={14} />{!compact && "eBay"}<ExternalLink size={11} /></a>
    <a href={researchUrl("amazon", name)} target="_blank" rel="noopener noreferrer" title={`Search Amazon for ${name}`}><ShoppingBag size={14} />{!compact && "Amazon"}<ExternalLink size={11} /></a>
    <a href={researchUrl("walmart", name)} target="_blank" rel="noopener noreferrer" title={`Search Walmart for ${name}`}><ShoppingCart size={14} />{!compact && "Walmart"}<ExternalLink size={11} /></a>
  </div>;
}

function AdminBrandLink({ id, name, compact = false, onOpen }: { id: string; name: string; compact?: boolean; onOpen?: () => void }) {
  return <a className={`admin-brand-link ${compact ? "compact" : ""}`} href={adminBrandUrl(id, name)} target="_blank" rel="noopener noreferrer" onClick={onOpen} title={`Edit, delete, or add aliases for ${name} in Admin`}><Database size={14} />{compact ? "Admin" : "Edit / delete / alias in Admin"}<ExternalLink size={11} /></a>;
}

function AdminUnknownBrandLink({ name, compact = false }: { name: string; compact?: boolean }) {
  return <a className={`admin-brand-link unknown ${compact ? "compact" : ""}`} href={adminUnknownBrandUrl(name)} target="_blank" rel="noopener noreferrer" title={`Search the Admin unknown-brand queue for ${name}`}><Search size={14} />{compact ? "Admin search" : "Search on Admin"}<ExternalLink size={11} /></a>;
}

function CatalogBrandDrawer({ brand, isNew, onClose, onSave }: { brand: CatalogBrand; isNew: boolean; onClose: () => void; onSave: (brand: CatalogBrand) => void }) {
  const [id, setId] = useState(brand.id);
  const [name, setName] = useState(brand.name);
  const [aliases, setAliases] = useState(brand.aliases.join("\n"));
  const [category, setCategory] = useState(brand.category);
  const [country, setCountry] = useState(brand.country || "");
  const [website, setWebsite] = useState(brand.website || "");
  const [sameAs, setSameAs] = useState(brand.sameAs || "");
  const [rootSource, setRootSource] = useState(brand.rootSource || "BRANDMASTER");
  const [rootStatus, setRootStatus] = useState(brand.rootStatus || "ACTIVE");
  const parsedAliases = [...new Map(aliases.split(/[\n,]/).map((alias) => alias.trim()).filter((alias) => alias && alias.toLowerCase() !== name.trim().toLowerCase()).map((alias) => [alias.toLowerCase(), alias])).values()];
  const valid = /^brand_.{4,}$/.test(id.trim()) && Boolean(name.trim()) && Boolean(category.trim());
  const source = brand.source === "Built-in" ? "Manual" : (brand.source || "Manual");
  const isRoot = source === "Root";
  return <><div className="drawer-scrim" onClick={onClose} /><aside className="drawer catalog-drawer"><div className="drawer-head"><div><span>{isNew ? `NEW ${isRoot ? "ROOT TABLE" : "LOCAL"} BRAND` : "BRAND MANAGEMENT"}</span><h2>{name.trim() || "Untitled brand"}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close brand editor"><X size={20} /></button></div><div className="drawer-body">
    <div className="catalog-editor-intro"><div className="catalog-monogram">{(name || "BM").slice(0, 2).toUpperCase()}</div><div><b>Canonical brand record</b><p>{isRoot ? "Root-table changes are tracked and included in the Root Changes CSV." : "Changes are saved on this device and used by future validation runs."}</p></div></div>
    <label className="field"><span>Brand ID</span><input value={id} readOnly={!isNew} onChange={(event) => setId(event.target.value.trim())} placeholder="brand_xxxxxxxxxxxxxxxxxxxxxx" /><small>{isNew ? "Use the real existing BrandID when adding a merge target." : "Brand IDs are locked so existing mappings remain valid."}</small></label>
    <label className="field"><span>Canonical brand name</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Official brand name" /></label>
    <label className="field"><span>Aliases</span><textarea className="alias-editor" value={aliases} onChange={(event) => setAliases(event.target.value)} placeholder={"One alias per line\nBrand OE\nBrand Original"} /><small>{parsedAliases.length} unique aliases. Commas and new lines are accepted.</small></label>
    {isRoot && <><div className="field-grid"><label className="field"><span>Root status</span><select value={rootStatus} onChange={(event) => setRootStatus(event.target.value)}><option>ACTIVE</option><option>INACTIVE</option><option>BLOCKED</option></select></label><label className="field"><span>Root source</span><input value={rootSource} onChange={(event) => setRootSource(event.target.value)} placeholder="BRANDMASTER" /></label></div><label className="field"><span>sameAs</span><input value={sameAs} onChange={(event) => setSameAs(event.target.value)} placeholder="Optional canonical reference" /><small>These fields are included in the Root Changes CSV.</small></label></>}
    <div className="field-grid"><label className="field"><span>Category</span><input value={category} onChange={(event) => setCategory(event.target.value)} placeholder="Automotive" /></label><label className="field"><span>Country</span><input value={country} onChange={(event) => setCountry(event.target.value)} placeholder="Country" /></label></div>
    <label className="field"><span>Official website</span><input value={website} onChange={(event) => setWebsite(event.target.value)} placeholder="manufacturer.com" /></label>
    <div className="catalog-source-note"><Database size={16} /><div><b>Source: {source}</b><p>{source === "Manual" ? "A local correction managed in Brandmaster." : `This edit updates the locally stored ${source} reference table.`}</p></div></div>
    {!isNew && <section className="admin-source-section"><h3>Source admin table</h3><p>Open this exact BrandID in the administration tool to review or edit the source record.</p><AdminBrandLink id={id} name={name.trim() || brand.name} /></section>}
    <section><h3>Research this brand</h3><ResearchLinks name={name.trim() || brand.name} /></section>
  </div><div className="drawer-footer"><p>{isRoot ? "Adds a pending Root table change" : "Saved locally and available offline"}</p><button className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={!valid} onClick={() => { onSave({ id: id.trim(), name: name.trim(), aliases: parsedAliases, category: category.trim(), country: country.trim() || undefined, website: website.trim() || undefined, source, sameAs: sameAs.trim() || undefined, rootSource: isRoot ? rootSource.trim() || "BRANDMASTER" : brand.rootSource, rootStatus: isRoot ? rootStatus : brand.rootStatus }); onClose(); }}><Check size={15} />Save brand</button></div></aside></>;
}

function BrandDatabase({ data, ubqSource, query, onSave, onUndoRootChange, onUpdateRootTask, onValidate }: { data: AppData; ubqSource: UbqSource | null; query: string; onSave: (brand: CatalogBrand) => void; onUndoRootChange: (id: string) => void; onUpdateRootTask: (id: string, status: NonNullable<AppData["rootChanges"][string]["adminStatus"]>) => void; onValidate: (source: "ROOT" | "UBQ", ids: string[]) => void }) {
  const [localQuery, setLocalQuery] = useState("");
  const [source, setSource] = useState("All");
  const [sort, setSort] = useState<CatalogSortKey>("name");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [conflictsOnly, setConflictsOnly] = useState(false);
  const [editing, setEditing] = useState<{ brand: CatalogBrand; isNew: boolean } | null>(null);
  const [selectedRoot, setSelectedRoot] = useState<string[]>([]);
  const [selectedUbq, setSelectedUbq] = useState<string[]>([]);
  const [ubqOpen, setUbqOpen] = useState(false);
  const [ubqQuery, setUbqQuery] = useState("");
  const allBrands = useMemo(() => effectiveCatalogBrands(data), [data]);
  const conflicts = useMemo(() => findCatalogConflicts(allBrands), [allBrands]);
  const conflictingIds = useMemo(() => new Set(conflicts.flatMap((conflict) => conflict.brandIds)), [conflicts]);
  const rootTasks = useMemo(() => Object.values(data.rootChanges).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [data.rootChanges]);
  const rootChanges = rootTasks.filter((change) => change.status !== "APPLIED" && change.adminStatus !== "REJECTED" && change.adminStatus !== "SUPERSEDED");
  const appliedRootTasks = rootTasks.filter((change) => change.status === "APPLIED");
  const sources = useMemo(() => [...new Set(allBrands.map((brand) => brand.source || "Manual"))].sort(), [allBrands]);
  const brands = useMemo(() => {
    const terms = [query, localQuery].map((value) => value.trim().toLowerCase()).filter(Boolean);
    const value = (brand: CatalogBrand) => sort === "aliases" ? brand.aliases.length : String(brand[sort] || "").toLowerCase();
    return allBrands
      .filter((brand) => source === "All" || (brand.source || "Manual") === source)
      .filter((brand) => !conflictsOnly || conflictingIds.has(brand.id))
      .filter((brand) => terms.every((term) => `${brand.name} ${brand.id} ${brand.aliases.join(" ")} ${brand.category} ${brand.country || ""} ${brand.source || "Manual"}`.toLowerCase().includes(term)))
      .sort((a, b) => { const left = value(a); const right = value(b); const result = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right), undefined, { numeric: true }); return direction === "asc" ? result : -result; });
  }, [allBrands, query, localQuery, source, sort, direction, conflictsOnly, conflictingIds]);
  const pages = Math.max(1, Math.ceil(brands.length / pageSize));
  useEffect(() => setPage(1), [query, localQuery, source, sort, direction, pageSize, conflictsOnly]);
  const visible = brands.slice((page - 1) * pageSize, page * pageSize);
  const ubqRows = useMemo(() => ubqSource ? [...ubqSource.byId.values()].filter((row) => `${row.name} ${row.id}`.toLowerCase().includes(ubqQuery.trim().toLowerCase())).slice(0, 250) : [], [ubqSource, ubqQuery]);
  function changeSort(next: CatalogSortKey) { if (sort === next) setDirection((current) => current === "asc" ? "desc" : "asc"); else { setSort(next); setDirection("asc"); } }
  const header = (label: string, key: CatalogSortKey) => <button className={sort === key ? "active" : ""} onClick={() => changeSort(key)}>{label}<ArrowUpDown size={12} /></button>;
  const newBrand: CatalogBrand = { id: "brand_", name: "", aliases: [], category: "Automotive", source: data.rootBrands.length ? "Root" : "Manual", rootSource: "BRANDMASTER", rootStatus: "ACTIVE" };
  return <><PageHead eyebrow="KNOWLEDGE BASE" title="Brand management" body={`${allBrands.length.toLocaleString()} canonical brands available for matching. Root-table edits are collected into an import-ready changes CSV.`} actions={<>{rootChanges.length > 0 && <button className="secondary" onClick={() => download("brandmaster-root-table-changes.csv", toRootChangesCsv(rootChanges))}><ArrowDownToLine size={16} />Root changes CSV ({rootChanges.length})</button>}<button className="primary" onClick={() => setEditing({ brand: newBrand, isNew: true })}><Plus size={16} />Add brand</button></>} />
    <section className="validation-kitchen"><div className="validation-kitchen-head"><span><WandSparkles size={20} /></span><div><b>Start a validation worklist</b><p>Send source records directly into the same Step 2 manual and AI review process—no temporary CSV required.</p></div></div><div className="validation-source-cards"><button onClick={() => { setSource("Root"); setConflictsOnly(false); setUbqOpen(false); }}><Database size={18} /><span><b>Root table cleanup</b><small>{data.rootBrands.length.toLocaleString()} source brands · select rows below</small></span><ChevronRight size={16} /></button><button onClick={() => setUbqOpen(!ubqOpen)}><FileClock size={18} /><span><b>UBQ mapping worklist</b><small>{ubqSource ? `${ubqSource.count.toLocaleString()} unmapped brands` : "Load UBQ in Validation modules"}</small></span><ChevronDown size={16} /></button></div>
      {ubqOpen && <div className="ubq-worklist"><div className="ubq-worklist-tools"><label><Search size={14} /><input value={ubqQuery} onChange={(event) => setUbqQuery(event.target.value)} placeholder="Find an unmapped UBQ brand…" /></label><span>{selectedUbq.length} selected</span><button className="primary" disabled={!selectedUbq.length} onClick={() => onValidate("UBQ", selectedUbq)}><WandSparkles size={14} />Validate selected in Step 2</button></div>{!ubqSource ? <EmptyState icon={Database} title="No UBQ table loaded" body="Open Validation modules and load the full UBQ export once; it will then be available here." /> : <div className="ubq-select-table">
        <div><input type="checkbox" checked={ubqRows.length > 0 && ubqRows.every((row) => selectedUbq.includes(row.id))} onChange={(event) => setSelectedUbq(event.target.checked ? ubqRows.map((row) => row.id) : [])} /><b>Unmapped brand</b><b>UnmappedBrandID</b><b>Listings</b><b>SKUs</b><b>Admin queue</b></div>
        {ubqRows.map((row) => <div key={row.id}><input type="checkbox" checked={selectedUbq.includes(row.id)} onChange={(event) => setSelectedUbq(event.target.checked ? [...new Set([...selectedUbq, row.id])] : selectedUbq.filter((id) => id !== row.id))} /><b>{row.name}</b><code>{row.id}</code><span>{row.listingCount ?? "—"}</span><span>{row.skuCount ?? "—"}</span><AdminUnknownBrandLink name={row.name} compact /></div>)}
      </div>}</div>}
    </section>
    {(rootChanges.length > 0 || appliedRootTasks.length > 0) && <section className="root-task-center"><div className="root-task-center-head"><span><FileClock size={20} /></span><div><b>Root Admin task center</b><p>{rootChanges.length} pending · {rootTasks.filter((task) => task.adminStatus === "COMPLETED" && task.status !== "APPLIED").length} completed but awaiting verification · {appliedRootTasks.length} verified</p></div>{rootChanges.length > 0 && <button className="primary" onClick={() => download("brandmaster-root-table-changes.csv", toRootChangesCsv(rootChanges))}><ArrowDownToLine size={15} />Download pending changes</button>}</div><div className="root-task-list">{rootTasks.filter((change) => change.adminStatus !== "REJECTED" && change.adminStatus !== "SUPERSEDED").slice(0, 8).map((change) => <div key={change.id} className={change.status === "APPLIED" ? "verified" : ""}><span className="task-state">{change.status === "APPLIED" ? <Check size={14} /> : change.adminStatus === "COMPLETED" ? <History size={14} /> : <FileClock size={14} />}</span><span className="task-copy"><b>{change.before?.name || "New brand"} → {change.after.name}</b><small>{change.adminStatus || "RECOMMENDED"} · {change.changedFields.join(", ")}{change.verificationNote ? ` · ${change.verificationNote}` : ""}</small></span><div className="task-actions"><AdminBrandLink id={change.after.id} name={change.after.name} compact onOpen={() => onUpdateRootTask(change.id, "OPENED")} />{change.status !== "APPLIED" && <button className="secondary" onClick={() => onUpdateRootTask(change.id, "COMPLETED")}><Check size={12} />Done in Admin</button>}<button className="icon-button" title={change.status === "APPLIED" ? "Dismiss verified task" : "Reject and undo recommendation"} onClick={() => change.status === "APPLIED" ? onUndoRootChange(change.id) : onUpdateRootTask(change.id, "REJECTED")}><X size={13} /></button></div></div>)}</div></section>}
    {conflicts.length > 0 && <section className="conflict-banner"><div><CircleHelp size={18} /><span><b>{conflicts.length} alias or canonical-name {conflicts.length === 1 ? "conflict" : "conflicts"}</b><p>A lookup value points to more than one BrandID. Resolve these before trusting automatic MERGE recommendations.</p></span></div><button className={conflictsOnly ? "primary" : "secondary"} onClick={() => setConflictsOnly(!conflictsOnly)}>{conflictsOnly ? "Show all brands" : `Review ${conflicts.length} conflicts`}</button></section>}
    <div className="catalog-toolbar"><label><Search size={15} /><input value={localQuery} onChange={(event) => setLocalQuery(event.target.value)} placeholder="Filter name, ID, alias, category…" /></label><select value={source} onChange={(event) => setSource(event.target.value)}><option>All</option>{sources.map((item) => <option key={item}>{item}</option>)}</select>{selectedRoot.length > 0 && <button className="primary" onClick={() => onValidate("ROOT", selectedRoot)}><WandSparkles size={14} />Validate {selectedRoot.length} in Step 2</button>}<span>{brands.length.toLocaleString()} results</span></div>
    <div className="table-panel"><div className="data-table brand-table managed source-select">
      <div className="table-row table-head-row"><div><input type="checkbox" aria-label="Select visible Root brands" checked={visible.some((brand) => brand.source === "Root") && visible.filter((brand) => brand.source === "Root").every((brand) => selectedRoot.includes(brand.id))} onChange={(event) => { const ids = visible.filter((brand) => brand.source === "Root").map((brand) => brand.id); setSelectedRoot(event.target.checked ? [...new Set([...selectedRoot, ...ids])] : selectedRoot.filter((id) => !ids.includes(id))); }} /></div><div>{header("Brand", "name")}</div><div>{header("Brand ID", "id")}</div><div>{header("Category", "category")}</div><div>{header("Aliases", "aliases")}</div><div>{header("Country", "country")}</div><div>{header("Source", "source")}</div><div>Admin table</div><div>Research</div><div>Review</div></div>
      {visible.map((brand) => { const task = data.rootChanges[brand.id]; return <div className={`table-row ${conflictingIds.has(brand.id) ? "has-conflict" : ""}`} key={brand.id}>
        <div><input type="checkbox" disabled={brand.source !== "Root"} aria-label={`Select ${brand.name} for validation`} checked={selectedRoot.includes(brand.id)} onChange={(event) => setSelectedRoot(event.target.checked ? [...new Set([...selectedRoot, brand.id])] : selectedRoot.filter((id) => id !== brand.id))} /></div>
        <div className="brand-logo">{brand.name.slice(0, 2).toUpperCase()}<span><b>{brand.name}</b><small>{conflictingIds.has(brand.id) ? "Alias/name conflict — review" : brand.website || "Website not set"}</small></span></div><div><code>{brand.id}</code></div><div><span className="category">{brand.category}</span></div>
        <div><button className="alias-count" onClick={() => setEditing({ brand, isNew: false })}>{brand.aliases.length}<small>{brand.aliases.slice(0, 2).join(" · ") || "Add aliases"}</small></button></div><div>{brand.country || "—"}</div>
        <div><span className={`source-badge source-${(brand.source || "manual").toLowerCase()}`}>{brand.source || "Manual"}</span>{task && <small className={task.status === "APPLIED" ? "root-applied" : "root-pending"}>{task.status === "APPLIED" ? "Verified applied" : "Admin work pending"}</small>}</div>
        <div><AdminBrandLink id={brand.id} name={brand.name} compact onOpen={task ? () => onUpdateRootTask(task.id, "OPENED") : undefined} /></div><div><ResearchLinks name={brand.name} compact /></div><div className="row-edit-actions">{brand.source === "Root" && <button className="icon-button row-validate" onClick={() => onValidate("ROOT", [brand.id])} title={`Validate ${brand.name} in Step 2`}><WandSparkles size={14} /></button>}<button className="icon-button row-edit" onClick={() => setEditing({ brand, isNew: false })} title={`Edit ${brand.name}`}><Pencil size={14} /></button></div>
      </div>; })}
    </div>
      {!visible.length && <EmptyState icon={Search} title="No brands found" body="Change the search or source filter to see more records." />}
      <div className="catalog-pagination"><span>Rows per page <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></span><b>{brands.length ? `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, brands.length)} of ${brands.length.toLocaleString()}` : "0 records"}</b><button className="icon-button" disabled={page === 1} onClick={() => setPage((current) => current - 1)}><ChevronLeft size={16} /></button><button className="icon-button" disabled={page === pages} onClick={() => setPage((current) => current + 1)}><ChevronRight size={16} /></button></div>
    </div>
    {editing && <CatalogBrandDrawer key={`${editing.brand.id}-${editing.isNew}`} brand={editing.brand} isNew={editing.isNew} onClose={() => setEditing(null)} onSave={onSave} />}
  </>;
}

function Aliases({ data, onSave }: { data: AppData; onSave: (brand: CatalogBrand) => void }) {
  const [editing, setEditing] = useState<CatalogBrand | null>(null);
  const brands = effectiveCatalogBrands(data); const aliases = brands.flatMap((brand) => brand.aliases.map((alias) => ({ alias, brand }))).sort((a, b) => a.alias.localeCompare(b.alias));
  return <><PageHead eyebrow="KNOWLEDGE BASE" title="Brand aliases" body="Alternate names resolve to a single canonical catalog brand. Open any row to correct its alias list." actions={<span className="status ready"><Pencil size={12} />Editable locally</span>} /><div className="table-panel"><div className="data-table alias-table managed"><div className="table-row table-head-row"><div>Alias</div><div>Canonical brand</div><div>Brand ID</div><div>Match type</div><div>Source</div><div /></div>{aliases.map(({ alias, brand }) => <div className="table-row" key={`${brand.id}-${alias}`}><div><b>{alias}</b></div><div>{brand.name}</div><div><code>{brand.id}</code></div><div><span className="category">Exact alias</span></div><div>{brand.source || "Manual"}</div><div><button className="icon-button row-edit" onClick={() => setEditing(brand)} title={`Edit aliases for ${brand.name}`}><Pencil size={14} /></button></div></div>)}</div>{!aliases.length && <EmptyState icon={Tags} title="No aliases yet" body="Open Brand management and add aliases to a canonical brand." />}</div>{editing && <CatalogBrandDrawer key={editing.id} brand={editing} isNew={false} onClose={() => setEditing(null)} onSave={onSave} />}</>;
}

function Ledger({ entries, records }: { entries: LedgerEntry[]; records: BrandRecord[] }) {
  const exportRecords = entries.length ? entries : records;
  return <><PageHead eyebrow="DECISION HISTORY" title="Review history" body="See every brand decision you approved, changed, or imported from an AI review. This history is saved only on this device." actions={<><button className="secondary" onClick={() => download("brandmaster-review-history.json", JSON.stringify(entries, null, 2), "application/json")}><ArrowDownToLine size={16} />Export details</button><button className="primary" onClick={() => download("brandmaster-decisions.csv", toCsv(exportRecords))}><ArrowDownToLine size={16} />Export decisions CSV</button></>} />
    <section className="history-explainer"><div><Check size={17} /><span><b>What is recorded?</b><p>Saving a decision, using a bulk review action, or applying validated AI JSON creates a dated entry.</p></span></div><div><History size={17} /><span><b>How are corrections handled?</b><p>A correction adds a new entry. The newest reviewed decision is used for future validation.</p></span></div><div><ShieldCheck size={17} /><span><b>Where is it stored?</b><p>Locally in this browser. Export it for backup; clearing the workspace removes it.</p></span></div></section>
    <div className="table-panel">{entries.length ? <div className="data-table ledger-table"><div className="table-row table-head-row"><div>Reviewed on</div><div>Input brand</div><div>Decision</div><div>Target / reason</div><div>Confidence</div><div>Reviewed by</div></div>{entries.map((entry) => <div className="table-row" key={entry.ledgerId}><div><b>{fmtDate(entry.date)}</b><small>{fmtTime(entry.date)}</small></div><div><b>{entry.name}</b><small>{entry.name !== entry.normalized ? `Normalized: ${entry.normalized}` : entry.id}</small></div><div><ActionPill action={entry.action} /></div><div><b>{entry.targetName || "No target brand"}</b><small>{entry.reason}</small></div><div><Confidence value={entry.confidence} /></div><div><span className="reviewer-avatar">BM</span>{entry.reviewer || "You"}</div></div>)}</div> : <EmptyState icon={History} title="No reviewed decisions yet" body="Open Process & Review and save a brand decision. Your first review will appear here with its date, action, target, and reason." action={<span className="status ready"><History size={12} />Automatic recommendations are not added until reviewed</span>} />}</div></>;
}

function Analytics({ records, ledger }: { records: BrandRecord[]; ledger: LedgerEntry[] }) {
  const [granularity, setGranularity] = useState<MappingGranularity>("day");
  const summary = useMemo(() => summarizeMappingActivity(ledger, records), [ledger, records]);
  const recentDays = useMemo(() => buildMappingActivitySeries(ledger, "day", new Date(), 7), [ledger]);
  const high = records.filter((record) => record.confidence >= 90).length;
  const averageConfidence = records.length ? Math.round(records.reduce((sum, record) => sum + record.confidence, 0) / records.length) : 0;
  const maxDay = Math.max(1, ...recentDays.map((day) => day.total));
  const weekDelta = summary.lastWeek ? Math.round((summary.thisWeek - summary.lastWeek) / summary.lastWeek * 100) : summary.thisWeek ? 100 : 0;
  return <><PageHead eyebrow="MAPPING PERFORMANCE" title="Progress & effort analytics" body="Every saved review is counted as effort. Current worklist progress is measured separately, so corrections never make completion look better than it is." />
    <section className="analytics-progress-hero"><div className="progress-orb" style={{ "--progress": `${summary.completionPercent}%` } as React.CSSProperties}><span><b>{summary.completionPercent}%</b><small>reviewed</small></span></div><div className="progress-copy"><span>CURRENT MAPPING PROGRESS</span><h2>{summary.reviewedRows.toLocaleString()} of {records.length.toLocaleString()} rows reviewed</h2><p>{summary.remainingRows ? `${summary.remainingRows.toLocaleString()} rows still need a saved human decision.` : records.length ? "Every row currently in the workspace has been reviewed." : "Import or select brands to begin measuring mapping progress."}</p><div className="progress-track"><i style={{ width: `${summary.completionPercent}%` }} /></div></div><div className="quality-pulse"><ShieldCheck size={18} /><span><b>{averageConfidence}%</b><small>average confidence</small></span><span><b>{high.toLocaleString()}</b><small>high-confidence rows</small></span></div></section>
    <section className="mapping-dashboard-grid"><div className="panel mapping-trend-panel"><div className="panel-head"><div><h2>Brand mapping actions over time</h2><p>Cumulative reviewed decisions in the selected period</p></div><div className="analytics-toggle"><button className={granularity === "day" ? "active" : ""} onClick={() => setGranularity("day")}>Daily</button><button className={granularity === "week" ? "active" : ""} onClick={() => setGranularity("week")}>Weekly</button></div></div>{ledger.length ? <MappingTrendChart entries={ledger} granularity={granularity} /> : <EmptyState icon={TrendingUp} title="No reviewed effort yet" body="Save decisions in Process & Review. The first action will immediately appear here with its date." />}</div>
      <aside className="mapping-stat-stack"><AnalyticsStat label="Total effort" value={summary.totalEffort} detail={`${summary.activeDays} active day${summary.activeDays === 1 ? "" : "s"}`} icon={Boxes} /><AnalyticsStat label="Today" value={summary.today} detail="saved decisions" icon={Activity} /><AnalyticsStat label="This week" value={summary.thisWeek} detail={`${weekDelta >= 0 ? "+" : ""}${weekDelta}% vs last week`} icon={TrendingUp} /><AnalyticsStat label="Last week" value={summary.lastWeek} detail="saved decisions" icon={CalendarDays} /></aside>
    </section>
    <section className="analytics-lower-grid"><div className="panel daily-effort-panel"><div className="panel-head"><div><h2>Last 7 days</h2><p>Daily review effort—not automatic recommendations</p></div><strong>{summary.averagePerActiveDay}<small>avg / active day</small></strong></div><div className="daily-effort-bars">{recentDays.map((day, index) => <div key={day.key} className={index === recentDays.length - 1 ? "today" : ""}><span><i style={{ height: `${Math.max(day.total ? 8 : 2, day.total / maxDay * 100)}%` }}><em>{day.total || ""}</em></i></span><b>{index === recentDays.length - 1 ? "Today" : day.start.toLocaleDateString(undefined, { weekday: "short" })}</b><small>{day.counts.MERGE} merge · {day.counts.CREATE} create</small></div>)}</div></div>
      <div className="panel"><div className="panel-head"><div><h2>Reviewed action mix</h2><p>What the team actually decided</p></div></div>{ledger.length ? <DonutChart records={ledger} /> : <EmptyState icon={BarChart3} title="No action mix yet" body="Reviewed CREATE, MERGE, SKIP, and DELETE actions appear here." />}</div>
      <div className="panel contributor-panel"><div className="panel-head"><div><h2>Reviewer effort</h2><p>Saved decisions by contributor</p></div><Users size={16} /></div>{summary.reviewerEffort.length ? <div className="contributor-list">{summary.reviewerEffort.slice(0, 6).map((item) => <div key={item.reviewer}><span>{item.reviewer.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span><div><b>{item.reviewer}</b><i><em style={{ width: `${item.decisions / summary.reviewerEffort[0].decisions * 100}%` }} /></i></div><strong>{item.decisions.toLocaleString()}<small>decisions</small></strong></div>)}</div> : <EmptyState icon={Users} title="No reviewer activity" body="Reviewer names are recorded when decisions are saved." />}</div>
    </section>
  </>;
}

function AnalyticsStat({ label, value, detail, icon: Icon }: { label: string; value: number; detail: string; icon: typeof Activity }) {
  return <div><span><Icon size={16} /></span><div><small>{label}</small><b>{value.toLocaleString()}</b><em>{detail}</em></div></div>;
}

function MappingTrendChart({ entries, granularity }: { entries: LedgerEntry[]; granularity: MappingGranularity }) {
  const buckets = useMemo(() => cumulativeMappingSeries(buildMappingActivitySeries(entries, granularity)), [entries, granularity]);
  const actions: { action: Action; label: string; color: string }[] = [
    { action: "CREATE", label: "New brand", color: "#4d86e8" },
    { action: "MERGE", label: "Alias / merge", color: "#8765d8" },
    { action: "SKIP", label: "Skipped", color: "#e69542" },
    { action: "DELETE", label: "Deleted", color: "#d65c67" },
  ];
  const width = 900; const height = 294; const left = 48; const right = 18; const top = 18; const bottom = 42;
  const plotWidth = width - left - right; const plotHeight = height - top - bottom;
  const max = Math.max(1, ...buckets.map((bucket) => bucket.cumulativeTotal));
  const x = (index: number) => left + (buckets.length === 1 ? plotWidth / 2 : index / (buckets.length - 1) * plotWidth);
  const y = (value: number) => top + plotHeight - value / max * plotHeight;
  let lower = buckets.map(() => 0);
  const layers = actions.map((item) => {
    const bottomValues = [...lower];
    const topValues = buckets.map((bucket, index) => bottomValues[index] + bucket.cumulative[item.action]);
    lower = topValues;
    return { ...item, bottomValues, topValues };
  });
  const line = (values: number[]) => values.map((value, index) => `${index ? "L" : "M"}${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(" ");
  const area = (upper: number[], base: number[]) => `${line(upper)} ${[...base].reverse().map((value, reverseIndex) => { const index = base.length - 1 - reverseIndex; return `L${x(index).toFixed(1)},${y(value).toFixed(1)}`; }).join(" ")} Z`;
  const labelEvery = granularity === "day" ? 2 : 1;
  return <div className="mapping-trend"><div className="mapping-legend">{actions.map((item) => <span key={item.action}><i style={{ background: item.color }} />{item.label}<b>{buckets.at(-1)?.cumulative[item.action] || 0}</b></span>)}</div><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Cumulative mapping decisions by ${granularity}`}>
    {[0, .25, .5, .75, 1].map((fraction) => <g key={fraction}><line x1={left} x2={width - right} y1={y(max * fraction)} y2={y(max * fraction)} className="trend-grid" /><text x={left - 9} y={y(max * fraction) + 3} textAnchor="end">{Math.round(max * fraction).toLocaleString()}</text></g>)}
    {layers.map((layer) => <g key={layer.action}><path d={area(layer.topValues, layer.bottomValues)} fill={layer.color} opacity=".13" /><path d={line(layer.topValues)} fill="none" stroke={layer.color} strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />{layer.topValues.map((value, index) => <circle key={buckets[index].key} cx={x(index)} cy={y(value)} r="2.1" fill={layer.color}><title>{buckets[index].label}: {layer.label} {buckets[index].cumulative[layer.action]} cumulative · {buckets[index].counts[layer.action]} this {granularity}</title></circle>)}</g>)}
    {buckets.map((bucket, index) => index % labelEvery === 0 || index === buckets.length - 1 ? <text key={bucket.key} x={x(index)} y={height - 13} textAnchor="middle" className="trend-x-label">{bucket.label}</text> : null)}
  </svg><p className="trend-caption"><CircleHelp size={12} />The chart counts reviewed actions from the decision history. Re-saving a correction counts as additional effort.</p></div>;
}

function ArtifactsView({ data, onNavigate }: { data: AppData; onNavigate: (view: View) => void }) {
  const totalRows = data.batches.reduce((sum, batch) => sum + batch.rows, 0);
  const ready = (batch: ImportBatch) => getBulkExportReadiness(batch.records).ready;
  const pendingRootChanges = Object.values(data.rootChanges).filter((change) => change.status !== "APPLIED" && change.adminStatus !== "REJECTED" && change.adminStatus !== "SUPERSEDED");
  return <><PageHead eyebrow="WORKSPACE DATA" title="Data & artifacts" body="Import history, generated bulk files, decisions, and offline reference sources live here—not in the validation workflow." actions={<button className="secondary" onClick={() => onNavigate("settings")}><Settings size={15} />Validation modules</button>} />
    <section className="artifact-stats"><div><FileUp size={17} /><span><b>{data.batches.length}</b><small>Imports</small></span></div><div><Boxes size={17} /><span><b>{totalRows.toLocaleString()}</b><small>Processed rows</small></span></div><div><ArrowDownToLine size={17} /><span><b>{data.batches.filter(ready).length}</b><small>Ready bulk files</small></span></div><div><History size={17} /><span><b>{data.ledger.length}</b><small>Manual decisions</small></span></div></section>
    <div className="artifact-layout"><section className="panel"><div className="panel-head"><div><h2>Import history</h2><p>Processing runs stored on this device</p></div></div>{data.batches.length ? <div className="artifact-list">{data.batches.map((batch, index) => { const isReady = ready(batch); const needs = batch.records.filter((record) => record.status === "needs-review").length; return <div key={batch.id}><div className="file-icon">CSV</div><div><b>{batch.filename}</b><p>{fmtDate(batch.createdAt)} at {fmtTime(batch.createdAt)} · {batch.rows.toLocaleString()} brands</p></div><span className={`status ${isReady ? "done" : "review"}`}>{isReady ? <><Check size={12} />Ready</> : `${needs} to review`}</span>{index === 0 && <button className="text-button" onClick={() => onNavigate("review")}>Open latest</button>}</div>; })}</div> : <EmptyState icon={Archive} title="No import history" body="Completed and in-progress validation runs will appear here." />}</section>
      <aside className="artifact-side"><section className="panel"><div className="panel-head"><div><h2>Bulk CSV artifacts</h2><p>Files ready for the real upload tool</p></div></div>{data.batches.length ? <div className="download-list">{data.batches.slice(0, 6).map((batch) => <div key={batch.id}><div><b>{batch.filename.replace(/\.csv$/i, "")}</b><small>{ready(batch) ? `${batch.rows.toLocaleString()} mappings` : "Complete review first"}</small></div><button className="icon-button" disabled={!ready(batch)} title={ready(batch) ? "Download bulk output" : "Not ready"} onClick={() => download(`brandmaster-${batch.filename.replace(/\.csv$/i, "")}-bulk.csv`, toCsv(batch.records))}><ArrowDownToLine size={16} /></button></div>)}</div> : <EmptyState icon={ArrowDownToLine} title="No artifacts" body="Validated bulk files will appear here." />}</section>
        <section className="panel"><div className="panel-head"><div><h2>Offline sources</h2><p>Stored in this browser profile</p></div></div><div className="source-summary"><div><span>Previous decisions</span><b>{Object.keys(data.learned).length.toLocaleString()}</b></div><div><span>Existing brands</span><b>{data.rootBrands.length.toLocaleString()}</b></div><div><span>Pending Root recommendations</span><b>{pendingRootChanges.length.toLocaleString()}</b></div><div><span>ACA brands</span><b>{data.acaBrands.length.toLocaleString()}</b></div><div><span>FPA brands</span><b>{data.fpaBrands.length.toLocaleString()}</b></div>{pendingRootChanges.length > 0 && <button className="primary source-download" onClick={() => download("brandmaster-root-table-changes.csv", toRootChangesCsv(pendingRootChanges))}><ArrowDownToLine size={14} />Download pending Root changes</button>}<button className="text-button" onClick={() => onNavigate("settings")}>Manage sources →</button></div></section>
      </aside></div>
  </>;
}

function ModuleToggle({ label, body, enabled, onChange, locked = false, online = false, unavailable = false }: { label: string; body: string; enabled: boolean; onChange?: () => void; locked?: boolean; online?: boolean; unavailable?: boolean }) {
  return <button className={`module-row ${unavailable ? "unavailable" : ""}`} onClick={onChange} disabled={locked || unavailable}><span className={`module-check ${enabled ? "enabled" : ""}`}>{enabled && <Check size={13} />}</span><div><b>{label}</b><p>{body}</p></div>{unavailable ? <em>NOT CONNECTED</em> : online ? <em>ONLINE</em> : locked ? <em>REQUIRED</em> : null}</button>;
}

function UbqUploader({ source, meta, onLoad }: { source: UbqSource | null; meta?: SourceMetadata; onLoad: (filename: string, rows: ParsedRow[]) => void }) {
  const input = useRef<HTMLInputElement>(null); const [loading, setLoading] = useState(false); const [error, setError] = useState("");
  function accept(file?: File) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) { setError("The UBQ reference must be a CSV file."); return; }
    setLoading(true); setError("");
    const reader = new FileReader();
    reader.onload = () => { const rows = parseCsv(String(reader.result)); setLoading(false); if (!rows.length || !rows.some((row) => row.id.startsWith("draft_brand_"))) { setError("Expected UnmappedBrandID/Brand ID and UnmappedBrandName/Brand Name columns with draft_brand_ IDs."); return; } onLoad(file.name, rows); };
    reader.onerror = () => { setLoading(false); setError("This UBQ CSV could not be read."); };
    reader.readAsText(file);
  }
  return <div className={`reference-upload ubq-upload ${source ? "loaded" : ""}`}><div className="reference-icon">{source ? <Check size={18} /> : <FileUp size={18} />}</div><div className="reference-info"><span>UNMAPPED BRAND ID SOURCE</span><b>Full UBQ Export</b><p>{source ? `${source.count.toLocaleString()} unmapped brands indexed and available offline` : "Required to turn pasted brand names into real draft_brand_ IDs"}</p><small>{sourceUpdated(meta)}</small><code>UnmappedBrandID · UnmappedBrandName · optional counts</code></div><input ref={input} type="file" accept=".csv,text/csv" hidden onChange={(event) => { accept(event.target.files?.[0]); event.target.value = ""; }} /><button className={source ? "secondary" : "primary"} onClick={() => input.current?.click()}>{loading ? "Indexing UBQ…" : source ? "Replace UBQ export" : "Choose full UBQ export"}</button>{error && <div className="reference-error"><CircleHelp size={14} />{error}</div>}</div>;
}

function ReferenceUploader({ source, count, meta, onLoad }: { source: "ACA" | "FPA" | "ROOT"; count: number; meta?: SourceMetadata; onLoad: (brands: CatalogBrand[], filename: string) => void }) {
  const input = useRef<HTMLInputElement>(null); const [loading, setLoading] = useState(false); const [error, setError] = useState("");
  function accept(file?: File) { if (!file) return; setLoading(true); setError(""); const reader = new FileReader(); reader.onload = () => { const brands = parseReferenceCsv(String(reader.result), source); setLoading(false); if (!brands.length) { setError(source === "ACA" ? "Expected BrandID and BrandName columns." : source === "ROOT" ? "Expected aliases, id, name, and status columns." : "Expected aliases, id, and name columns with brand_ IDs."); return; } onLoad(brands, file.name); }; reader.onerror = () => { setLoading(false); setError("This CSV could not be read."); }; reader.readAsText(file); }
  const title = source === "ROOT" ? "Existing Brand Table (root table)" : `${source} Brand Table`; const purpose = source === "ACA" ? "BRAND RECOGNITION" : source === "ROOT" ? "AUTHORITATIVE EXISTING BRANDS" : "MERGE TARGETS & ALIASES"; const schema = source === "ACA" ? "BrandID · BrandName · SubBrandName" : source === "ROOT" ? "aliases · id · name · status" : "aliases · id · name";
  return <div className={`reference-upload ${source === "ROOT" ? "root-upload" : ""} ${count ? "loaded" : ""}`}><div className="reference-icon">{count ? <Check size={18} /> : <Database size={18} />}</div><div className="reference-info"><span>{purpose}</span><b>{title}</b><p>{count ? `${count.toLocaleString()} ${source === "ACA" ? "recognized" : "canonical"} brands available offline` : "Not loaded"}</p><small>{sourceUpdated(meta)}</small><code>{schema}</code></div><input ref={input} type="file" accept=".csv,text/csv" hidden onChange={(e) => accept(e.target.files?.[0])} /><button className={count ? "secondary" : "primary"} onClick={() => input.current?.click()}>{loading ? "Validating…" : count ? "Replace" : "Add table"}</button>{error && <div className="reference-error"><CircleHelp size={14} />{error}</div>}</div>;
}

function DecisionUploader({ count, meta, onLoad }: { count: number; meta?: SourceMetadata; onLoad: (decisions: AppData["learned"], filename: string) => void }) {
  const input = useRef<HTMLInputElement>(null); const [loading, setLoading] = useState(false); const [message, setMessage] = useState(""); const [error, setError] = useState("");
  function accept(file?: File) { if (!file) return; setLoading(true); setError(""); const reader = new FileReader(); reader.onload = () => { const result = parseDecisionCsv(String(reader.result)); setLoading(false); if (!result.imported) { setError("Expected listing_brand, action, merge_target, and fpa_brand_id columns."); return; } onLoad(result.decisions, file.name); setMessage(`${result.imported.toLocaleString()} imported${result.skipped ? ` · ${result.skipped} skipped` : ""}${result.conflicts ? ` · ${result.conflicts} conflicts excluded` : ""}`); }; reader.onerror = () => { setLoading(false); setError("This CSV could not be read."); }; reader.readAsText(file); }
  return <div className={`reference-upload decision-upload ${count ? "loaded" : ""}`}><div className="reference-icon">{count ? <Check size={18} /> : <History size={18} />}</div><div className="reference-info"><span>HIGHEST-PRIORITY VALIDATION SOURCE</span><b>Previous Decisions</b><p>{count ? `${count.toLocaleString()} total decisions available offline` : "Add reviewed CREATE, MERGE, SKIP, and DELETE decisions"}</p><small>{sourceUpdated(meta)}{message ? ` · ${message}` : ""}</small><code>Latest upload wins · matching older decisions are corrected · unrelated manual reviews remain</code></div><input ref={input} type="file" accept=".csv,text/csv" hidden onChange={(e) => accept(e.target.files?.[0])} /><button className={count ? "secondary" : "primary"} onClick={() => input.current?.click()}>{loading ? "Validating…" : count ? "Replace decisions CSV" : "Add decisions"}</button>{error && <div className="reference-error"><CircleHelp size={14} />{error}</div>}</div>;
}

function GitHubWorkspacePanel({ createSnapshot, applySnapshot, session, onSession, remoteUpdate, onRemoteUpdate, teamSync, onTeamSync }: { createSnapshot: () => SharedWorkspaceSnapshot; applySnapshot: (snapshot: SharedWorkspaceSnapshot) => Promise<void>; session: GitHubSession | null; onSession: (session: GitHubSession | null) => void; remoteUpdate: GitHubRemoteUpdate | null; onRemoteUpdate: (update: GitHubRemoteUpdate | null) => void; teamSync?: SharedWorkspaceSnapshot["sync"]; onTeamSync: (sync?: SharedWorkspaceSnapshot["sync"]) => void }) {
  const revisionKey = "brandmaster-github-revision"; const syncedAtKey = "brandmaster-github-synced-at";
  const [tokenInput, setTokenInput] = useState(""); const token = session?.token || ""; const user = session?.user || null;
  const [busy, setBusy] = useState(""); const [message, setMessage] = useState(""); const [error, setError] = useState(""); const [lastSyncedAt, setLastSyncedAt] = useState("");
  useEffect(() => { setLastSyncedAt(localStorage.getItem(syncedAtKey) || ""); }, []);
  function friendlyError(cause: unknown) { return cause instanceof GitHubWorkspaceError || cause instanceof Error ? cause.message : "Corporate GitHub could not be reached."; }
  async function remember(revision: string | null, workspace: SharedWorkspaceSnapshot) {
    if (revision) localStorage.setItem(revisionKey, revision); else localStorage.removeItem(revisionKey);
    const when = workspace.sync?.lastSyncedAt || new Date().toISOString(); localStorage.setItem(syncedAtKey, when); setLastSyncedAt(when); onTeamSync(workspace.sync); onRemoteUpdate(null);
    await saveGitHubBaseline(workspace);
  }
  async function connect() {
    const candidate = tokenInput.trim(); if (!candidate) { setError("Paste a Corporate GitHub personal access token first."); return; }
    if (/BEGIN (RSA |EC )?PRIVATE KEY|^ssh-|^Iv1\./m.test(candidate)) { setError("This looks like an app private key, SSH key, or client ID. Create a Corporate GitHub personal access token instead."); return; }
    setBusy("connect"); setError(""); setMessage("");
    try {
      const [account] = await Promise.all([connectGitHubWorkspace(candidate), verifyGitHubWorkspaceRepository(candidate)]);
      onSession({ token: candidate, user: account }); setTokenInput(""); setMessage(`Connected as ${account.login}. Brandmaster checks for team updates every 45 seconds on every page.`);
    } catch (cause) { setError(friendlyError(cause)); }
    finally { setBusy(""); }
  }
  async function saveMerged(remoteRevision: string, remoteWorkspace: SharedWorkspaceSnapshot, baseline: SharedWorkspaceSnapshot | null, local: SharedWorkspaceSnapshot) {
    let latestRevision = remoteRevision; let latestWorkspace = remoteWorkspace; let merged = mergeWorkspaceSnapshots(baseline, local, latestWorkspace);
    if (!merged.localChanges) { await applySnapshot(latestWorkspace); await remember(latestRevision, latestWorkspace); return { mode: "pull" as const, changes: merged.remoteChanges }; }
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const saved = await putGitHubWorkspace(token, merged.workspace, latestRevision, user!.login, merged.localChanges);
        await applySnapshot(saved.workspace!); await remember(saved.revision, saved.workspace!); return { mode: "sync" as const, changes: merged.localChanges };
      } catch (cause) {
        if (!(cause instanceof GitHubWorkspaceError) || cause.status !== 409) throw cause;
        await new Promise((resolve) => setTimeout(resolve, 180 + attempt * 180));
        const newest = await getGitHubWorkspace(token); if (!newest.revision || !newest.workspace) throw cause;
        latestRevision = newest.revision; latestWorkspace = newest.workspace; merged = mergeWorkspaceSnapshots(baseline, local, latestWorkspace);
      }
    }
    throw new GitHubWorkspaceError("The team workspace kept changing during four save attempts. Wait a moment, then click Sync & Pull again.", 409);
  }
  async function sync() {
    if (!token || !user) return;
    setBusy("sync"); setError(""); setMessage("");
    try {
      const remote = await getGitHubWorkspace(token); const local = createSnapshot(); let baseline = await loadGitHubBaseline(); const lastRevision = localStorage.getItem(revisionKey);
      if (!remote.revision || !remote.workspace) {
        try {
          const saved = await putGitHubWorkspace(token, local, null, user.login, 1); await applySnapshot(saved.workspace!); await remember(saved.revision, saved.workspace!);
          setMessage("Created the shared workspace and recorded this sync in team activity."); return;
        } catch (cause) {
          if (!(cause instanceof GitHubWorkspaceError) || cause.status !== 409) throw cause;
          const newest = await getGitHubWorkspace(token); if (!newest.revision || !newest.workspace) throw cause;
          const result = await saveMerged(newest.revision, newest.workspace, null, local);
          setMessage(`Merged and synced ${result.changes} change${result.changes === 1 ? "" : "s"} after another user created the team file.`); return;
        }
      }
      if (!baseline && lastRevision) baseline = lastRevision === remote.revision ? remote.workspace : await getGitHubWorkspaceAtRevision(token, lastRevision);
      if (!lastRevision) {
        const hasLocalWork = local.data.batches.length || local.data.ledger.length || local.data.rootBrands.length || local.data.acaBrands.length || local.data.fpaBrands.length || Object.keys(local.data.learned).length;
        if (!hasLocalWork) { await applySnapshot(remote.workspace); await remember(remote.revision, remote.workspace); setMessage(`Pulled the team workspace${remote.workspace.sync?.lastSyncedBy ? ` from @${remote.workspace.sync.lastSyncedBy}` : ""}.`); return; }
      }
      const result = await saveMerged(remote.revision, remote.workspace, baseline, local);
      setMessage(result.mode === "pull" ? `Pulled ${result.changes || "the latest"} team change${result.changes === 1 ? "" : "s"}.` : `Synced ${result.changes} incremental change${result.changes === 1 ? "" : "s"} and kept teammates' updates.`);
    } catch (cause) { setError(friendlyError(cause)); }
    finally { setBusy(""); }
  }
  function disconnect() { onSession(null); setTokenInput(""); onRemoteUpdate(null); setError(""); setMessage("Disconnected. The token was removed from browser memory."); }
  const history = teamSync?.history || [];
  return <section className="shared-workspace"><div className="section-title"><div><h2>Shared GitHub workspace</h2><p>Incrementally merge team updates and save your changes to the private Brandmaster-data repository.</p></div><span className={`connection-chip ${user ? "online" : ""}`}>{user ? <Check size={13} /> : <Github size={13} />}{user ? "Connected" : "Not connected"}</span></div><div className="shared-workspace-card">
    <div className="shared-workspace-intro"><div className="shared-cloud"><Github size={22} /></div><div><b>{GITHUB_WORKSPACE_REPOSITORY}</b><p><code>brandmaster/workspace.json</code> is a small manifest; large tables are stored as safe sub-megabyte chunks and committed atomically.</p></div><a className="secondary shared-repo-link" href={`https://github.corp.ebay.com/${GITHUB_WORKSPACE_REPOSITORY}`} target="_blank" rel="noreferrer">Open repository<ExternalLink size={13} /></a></div>
    {!user ? <div className="github-connect"><div className="github-connect-copy"><KeyRound size={18} /><span><b>Connect for this browser session</b><p>Create your own Corporate GitHub token. It stays in temporary memory and is forgotten on refresh—it is never added to workspace.json or either repository.</p></span></div><details className="token-guide" open><summary>How to create your repository token</summary><ol><li><span>1</span><div><b>Open Corporate GitHub token settings</b><p>Use Corporate GitHub—not github.com—and choose a short expiration.</p></div></li><li><span>2</span><div><b>Limit repository access</b><p>Resource owner: <code>bmeshesha</code> · Only selected repository: <code>Brandmaster-data</code>.</p></div></li><li><span>3</span><div><b>Grant Contents read and write</b><p>Generate the token, copy it once, and paste it below. Repository collaborators who cannot select this personal repository may need a classic <code>repo</code> token.</p></div></li></ol><div><a className="primary" href="https://github.corp.ebay.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">Create fine-grained token<ExternalLink size={13} /></a><a className="secondary" href="https://github.corp.ebay.com/settings/tokens/new?scopes=repo&description=Brandmaster%20workspace%20sync" target="_blank" rel="noreferrer">Classic token fallback<ExternalLink size={13} /></a></div></details><div className="github-connect-form"><input type="password" autoComplete="off" spellCheck={false} value={tokenInput} onChange={(event) => setTokenInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void connect(); }} placeholder="Paste Corporate GitHub personal access token" aria-label="Repository access token" /><button className="primary" disabled={busy === "connect"} onClick={() => void connect()}><Github size={15} />{busy === "connect" ? "Connecting…" : "Connect Corporate GitHub"}</button></div></div> : <><div className="github-session"><div className="github-user"><div>{user.login.slice(0, 2).toUpperCase()}</div><span><b>{user.name || user.login}</b><p>@{user.login} · Update check every 45 seconds</p></span></div><div className="github-sync-status"><span>{lastSyncedAt ? "LAST LOCAL SYNC" : "READY TO SYNC"}</span><b>{lastSyncedAt ? `${fmtDate(lastSyncedAt)} at ${fmtTime(lastSyncedAt)}` : "Pull and merge team data"}</b>{teamSync?.lastSyncedBy && <small>Team file by @{teamSync.lastSyncedBy}</small>}</div><div className="sync-actions"><button className="text-button" disabled={Boolean(busy)} onClick={disconnect}><LogOut size={14} />Disconnect</button><button className="primary" disabled={Boolean(busy)} onClick={() => void sync()}><RefreshCw className={busy === "sync" ? "spinning" : ""} size={15} />{busy === "sync" ? "Merging changes…" : remoteUpdate ? "Pull, merge & sync" : "Sync & Pull"}</button></div></div>{remoteUpdate && <div className="github-update"><Bell size={17} /><span><b>New team update available</b><p>{remoteUpdate.sync?.lastSyncedBy ? `@${remoteUpdate.sync.lastSyncedBy} synced` : "A collaborator synced"}{remoteUpdate.sync?.lastSyncedAt ? ` ${fmtDate(remoteUpdate.sync.lastSyncedAt)} at ${fmtTime(remoteUpdate.sync.lastSyncedAt)}` : ""}. Your edits will be merged, not overwritten.</p></span><button className="secondary" disabled={Boolean(busy)} onClick={() => void sync()}>Pull, merge & sync</button></div>}{history.length > 0 && <details className="sync-history"><summary>Recent team sync activity</summary><div>{history.slice(0, 6).map((entry, index) => <div key={`${entry.syncedAt}-${index}`}><span>{entry.syncedBy.slice(0, 2).toUpperCase()}</span><p><b>@{entry.syncedBy}</b><small>{fmtDate(entry.syncedAt)} at {fmtTime(entry.syncedAt)} · {entry.changeCount} change{entry.changeCount === 1 ? "" : "s"}</small></p></div>)}</div></details>}</>}
    <details className="github-admin"><summary>Administrator links and access setup</summary><p>Collaborators need repository access. The installed GitHub App is reserved for a future server-backed sign-in flow; this static browser connection uses each user&apos;s session token.</p><a href="https://github.corp.ebay.com/settings/apps/brandmaster-sync/installations" target="_blank" rel="noreferrer">Manage GitHub App installation<ExternalLink size={12} /></a></details>
    {message && <div className="sync-message success"><Check size={14} />{message}</div>}{error && <div className="sync-message error"><CircleHelp size={14} />{error}</div>}
  </div></section>;
}

function WorkspaceBackupPanel({ onBackup, onRestore }: { onBackup: () => void; onRestore: (file: File) => Promise<void> }) {
  const input = useRef<HTMLInputElement>(null); const [restoring, setRestoring] = useState(false);
  async function restore(file?: File) { if (!file) return; setRestoring(true); await onRestore(file); setRestoring(false); }
  return <div className="workspace-backup"><div><Archive size={18} /><span><b>Workspace backup</b><p>Save imports, reviews, settings, Root changes, reference tables, and the UBQ index in one JSON file.</p></span></div><div><button className="secondary" onClick={onBackup}><ArrowDownToLine size={14} />Download backup</button><input ref={input} type="file" accept=".json,application/json" hidden onChange={(event) => { void restore(event.target.files?.[0]); event.target.value = ""; }} /><button className="secondary" disabled={restoring} onClick={() => input.current?.click()}><FileUp size={14} />{restoring ? "Restoring…" : "Restore backup"}</button></div></div>;
}

type SettingsViewProps = { data: AppData; ubqSource: UbqSource | null; onLoadUbq: (filename: string, rows: ParsedRow[]) => void; onClear: () => void; onUpdateSettings: (settings: Partial<ValidationSettings>) => void; onSetReference: (source: "ACA" | "FPA" | "ROOT", brands: CatalogBrand[], filename: string) => void; onAddDecisions: (decisions: AppData["learned"], filename: string) => void; onBackup: () => void; onRestore: (file: File) => Promise<void>; createSnapshot: () => SharedWorkspaceSnapshot; applySnapshot: (snapshot: SharedWorkspaceSnapshot) => Promise<void>; githubSession: GitHubSession | null; onGitHubSession: (session: GitHubSession | null) => void; githubRemoteUpdate: GitHubRemoteUpdate | null; onGitHubRemoteUpdate: (update: GitHubRemoteUpdate | null) => void; githubTeamSync?: SharedWorkspaceSnapshot["sync"]; onGitHubTeamSync: (sync?: SharedWorkspaceSnapshot["sync"]) => void };

function SettingsView({ data, ubqSource, onLoadUbq, onClear, onUpdateSettings, onSetReference, onAddDecisions, onBackup, onRestore, createSnapshot, applySnapshot, githubSession, onGitHubSession, githubRemoteUpdate, onGitHubRemoteUpdate, githubTeamSync, onGitHubTeamSync }: SettingsViewProps) {
  const [confirm, setConfirm] = useState(false); const s = data.validationSettings;
  return <><PageHead eyebrow="OFFLINE DATA & VALIDATION" title="Reference tables" body="Load the catalog sources that make matching accurate. Files stay on this Mac and remain available offline." />
    <div className="module-layout"><div className="settings-content"><GitHubWorkspacePanel createSnapshot={createSnapshot} applySnapshot={applySnapshot} session={githubSession} onSession={onGitHubSession} remoteUpdate={githubRemoteUpdate} onRemoteUpdate={onGitHubRemoteUpdate} teamSync={githubTeamSync} onTeamSync={onGitHubTeamSync} />
      <section className="reference-section"><div className="section-title"><div><h2>Brand data sources</h2><p>The UBQ export supplies real unmapped IDs. Previous decisions resolve known work first; the existing brand table, ACA, and FPA support validation.</p></div><span className="offline-chip"><CloudOff size={13} />Stored offline</span></div><div className="reference-list"><UbqUploader source={ubqSource} meta={data.sourceMeta.UBQ} onLoad={onLoadUbq} /><DecisionUploader count={Object.keys(data.learned).length} meta={data.sourceMeta.DECISIONS} onLoad={onAddDecisions} /><ReferenceUploader source="ROOT" count={data.rootBrands.length} meta={data.sourceMeta.ROOT} onLoad={(brands, filename) => onSetReference("ROOT", brands, filename)} /><ReferenceUploader source="ACA" count={data.acaBrands.length} meta={data.sourceMeta.ACA} onLoad={(brands, filename) => onSetReference("ACA", brands, filename)} /><ReferenceUploader source="FPA" count={data.fpaBrands.length} meta={data.sourceMeta.FPA} onLoad={(brands, filename) => onSetReference("FPA", brands, filename)} /></div>{(ubqSource || data.rootBrands.length > 0) && <div className="tables-ready"><Check size={16} /><div><b>{ubqSource ? "UBQ ID resolution is ready" : "Authoritative existing-brand validation is ready"}</b><p>{ubqSource ? `${ubqSource.count.toLocaleString()} UBQ rows, ` : "No UBQ export, "}{data.rootBrands.length.toLocaleString()} active existing brands, {Object.keys(data.learned).length.toLocaleString()} previous decisions, {data.acaBrands.length.toLocaleString()} ACA brands, and {data.fpaBrands.length.toLocaleString()} FPA brands are available.</p></div></div>}</section>
      <section><div className="section-title"><div><h2>Offline modules</h2><p>Fast, private, and available without an internet connection.</p></div><span className="offline-chip"><CloudOff size={13} />Always available</span></div>
        <div className="module-list"><ModuleToggle label="Normalize brands" body="Clean OEM wording, separators, punctuation, and whitespace." enabled locked /><ModuleToggle label="Previous decisions" body="Use prior reviews and manual overrides as final decisions." enabled={s.previousDecisions} onChange={() => onUpdateSettings({ previousDecisions: !s.previousDecisions })} /><ModuleToggle label="Alias table" body="Resolve aliases from the existing and FPA brand tables." enabled={s.aliasTable} onChange={() => onUpdateSettings({ aliasTable: !s.aliasTable })} /><ModuleToggle label="Existing brand table" body={`Authoritative exact and fuzzy matching against ${data.rootBrands.length.toLocaleString()} ACTIVE brands.`} enabled={s.rootBrandTable} onChange={() => onUpdateSettings({ rootBrandTable: !s.rootBrandTable })} /><ModuleToggle label="ACA brand table" body={`Exact and fuzzy recognition against ${data.acaBrands.length.toLocaleString()} locally loaded brands.`} enabled={s.acaTable} onChange={() => onUpdateSettings({ acaTable: !s.acaTable })} /><ModuleToggle label="FPA brand table" body={`Fallback matching against ${(SEED_BRANDS.length + data.fpaBrands.length).toLocaleString()} available brands.`} enabled={s.fpaTable} onChange={() => onUpdateSettings({ fpaTable: !s.fpaTable })} /><ModuleToggle label="Offline brand rules" body="Detect placeholders, OEM language, retailers, and generic text." enabled={s.offlineRules} onChange={() => onUpdateSettings({ offlineRules: !s.offlineRules })} /></div>
      </section>
      <section><div className="section-title"><div><h2>Online integrations</h2><p>No online connector is installed. These modules do not run and never appear in validation progress.</p></div><span className="connection-chip"><CloudOff size={13} />Not connected</span></div>
        <div className="module-list"><ModuleToggle label="Official website search" body="Unavailable until a real search connector is installed and tested." enabled={false} online unavailable /><ModuleToggle label="Marketplace search" body="eBay, Amazon, Walmart, RockAuto, RevZilla, and CMSNL are not connected." enabled={false} online unavailable /><ModuleToggle label="Google search" body="No Google or other search-provider API is connected." enabled={false} online unavailable /><ModuleToggle label="AI validator" body="No OpenAI request is made. Use Manual AI Assist in review if desired." enabled={false} online unavailable /></div>
        <div className="info-banner"><ShieldCheck size={17} /><span>Brandmaster currently performs offline validation only. It will not request or store an API key for unavailable integrations.</span></div>
      </section>
      <section><h2>Workspace data</h2><p>{data.batches.length} imports, {data.ledger.length} reviewed decisions, and {(data.rootBrands.length + data.acaBrands.length + data.fpaBrands.length).toLocaleString()} reference brands are stored locally.</p><WorkspaceBackupPanel onBackup={onBackup} onRestore={onRestore} /><div className="danger-row"><div><b>Clear local workspace</b><p>Remove imports, references, settings, review history, and learned decisions.</p></div>{confirm ? <div className="confirm-actions"><button className="secondary" onClick={() => setConfirm(false)}>Cancel</button><button className="danger" onClick={() => { onClear(); setConfirm(false); }}><Trash2 size={15} />Clear everything</button></div> : <button className="danger-outline" onClick={() => setConfirm(true)}>Clear data</button>}</div></section>
    </div><aside className="engine-order"><span>EXECUTION ORDER</span><ol>{ubqSource && <li>Resolve UBQ IDs</li>}<li className="required">Normalize</li>{s.previousDecisions && <li>Previous decisions</li>}{s.aliasTable && <li>Alias table</li>}{s.rootBrandTable && <li>Existing brand table</li>}{s.acaTable && <li>ACA brand table</li>}{s.fpaTable && <li>FPA brand table</li>}{s.offlineRules && <li>Offline rules</li>}</ol><p>The first decisive local match stops processing. Only modules shown in this list actually run.</p></aside></div>
  </>;
}
