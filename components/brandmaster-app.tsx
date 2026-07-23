"use client";

import {
  Activity, Archive, Tags, ArrowDownToLine, ArrowUpDown, BarChart3, Bell, BookOpen, Boxes, CalendarDays, Check, ChevronDown, ChevronUp,
  ChevronLeft, ChevronRight, ExternalLink, Globe, Pencil,
  CircleHelp, Cloud, CloudOff, Database, FileClock, FileUp, Gauge, Github, History, KeyRound, LayoutDashboard, LogOut,
  Menu, Moon, MoreHorizontal, PanelLeftClose, Pause, Play, Pin, Plus, RefreshCw, RotateCcw, Search, Settings, ShieldCheck, ShoppingBag, ShoppingCart, Sparkles,
  Sun, Trash2, TrendingUp, UploadCloud, Users, WandSparkles, X,
} from "lucide-react";
import Image from "next/image";
import { ChangeEvent, DragEvent, Fragment, useEffect, useMemo, useRef, useState } from "react";
import { buildAvailableMappingSeries, buildMappingActivitySeries, buildWeeklyCompletionActivity, buildWeeklyTargetProgress, canonicalAnalyticsReviewer, completionActivityForReviewer, cumulativeMappingSeries, MappingActivityEntry, MappingGranularity, summarizeMappingActivity } from "@/lib/analytics";
import { analyticsExcelXml } from "@/lib/analytics-export";
import { adminRunFromRecords, adminRunFromRootChanges, backfillAdminRuns, ImportReconciliationSummary, reconcileAdminRuns, summarizeImportedSource } from "@/lib/admin-reconciliation";
import { AdminUploadResultRow, applyAdminUploadResultsToRecords, parseAdminUploadResults, summarizeAdminUploadResults } from "@/lib/admin-upload-results";
import { adminBrandUrl, adminUnknownBrandUrl, aiReviewRequestId, assessMergeCompatibility, buildAiReviewPrompt, canonicalRootCatalog, classifyBrand, findCatalogConflicts, findPriorUbqFamilyMerge, findRelatedUbqBrands, getBulkExportReadiness, normalizeBrand, parseAiReviewJson, parseCsv, parseDecisionCsv, parsePastedBrands, parseReferenceCsv, reconcileRootRecommendations, resolveRootBrandTarget, SEED_BRANDS, toCsv, toRootChangesCsv } from "@/lib/brand-engine";
import { CompletedBrandDetail, findCompletedBrandDetails, findCompletedBrandDetailsNotInUbq } from "@/lib/completed-brands";
import { brandMatchLabel, matchCatalogBrand } from "@/lib/brand-search";
import { connectGitHubWorkspace, getGitHubWorkspace, getGitHubWorkspaceAtRevision, getGitHubWorkspaceStatus, GITHUB_WORKSPACE_REPOSITORY, GitHubUser, GitHubWorkspaceError, mergeWorkspaceSnapshots, protectActiveTriage, putGitHubWorkspace, shouldProtectTriage, verifyGitHubWorkspaceRepository } from "@/lib/github-workspace";
import { HistoricalImportMode, mergeHistoricalMappings, mergeManualFpaIds, parseHistoricalMappingCsv } from "@/lib/historical-mappings";
import { createDeviceId, LOCAL_PROFILE_KEY, LocalProfile, localProfileIdentity, migrateAppIdentity, normalizeLocalUsername, validLocalUsername } from "@/lib/local-profile";
import { applyNotDoneSnapshot, isNotDoneSnapshot } from "@/lib/not-done-snapshot";
import { completePriorityQueueFromBatch, markPriorityQueueAdminDone, markPriorityQueueExported, normalizePriorityQueueItems, planPriorityImports, priorityImportDisposition, priorityQueueScore, priorityTaskKey, reconcilePriorityQueueWithUbq, removePriorityQueueItems, resetPriorityQueueItems } from "@/lib/priority-queue";
import { activeUserBatch, archiveFinishedTriage, archiveTerminalTriages, resolveWorkflowCheckpoint, triageWorklistForMode } from "@/lib/triage-lifecycle";
import { reviewHistoryProgressCsv } from "@/lib/review-history-export";
import { analyzeRootBrands, analyzeUbqBrands, CleanupIssue, CleanupSeverity, CleanupSource, cleanupIssueCounts, cleanupRecordFingerprint } from "@/lib/smart-cleanup";
import { clearGitHubBaseline, clearReferenceTables, download, EMPTY_DATA, loadData, loadGitHubBaseline, loadReferenceTables, loadUbqReference, loadWorkspaceData, saveData, saveGitHubBaseline, saveReferenceTable, saveUbqReference, workspaceBackupFilename } from "@/lib/storage";
import { getSyncSession, logoutSync, pullSharedWorkspace, pushSharedWorkspace, syncLoginUrl, SyncSession } from "@/lib/sync";
import type { AuthenticatedBrandmasterUser } from "@/lib/supabase-auth";
import { Action, AdminUpdateItem, AppData, BrandRecord, CatalogBrand, HistoricalMappingEntry, ImportBatch, ImportIntakeDecision, LedgerEntry, ManualFpaIdReference, PriorityQueueItem, PriorityQueueSource, PriorityQueueStatus, SharedWorkspaceSnapshot, SourceMetadata, ValidationSettings, View, WorkflowSource } from "@/lib/types";

const UNIFIED_NAV: { section?: string; items: { id: View; label: string; icon: typeof Gauge }[] }[] = [
  { section: "Daily work", items: [
    { id: "dashboard", label: "Home", icon: LayoutDashboard },
    { id: "imports", label: "1  Add brands", icon: FileUp },
    { id: "review", label: "2  Review decisions", icon: FileClock },
    { id: "output", label: "3  Download file", icon: ArrowDownToLine },
  ]},
  { section: "Progress", items: [
    { id: "analytics", label: "Team progress", icon: BarChart3 },
    { id: "ledger", label: "Review history", icon: History },
  ]},
  { section: "Brand tools", items: [
    { id: "cleanup", label: "Smart cleanup", icon: WandSparkles },
    { id: "quality", label: "Data quality analytics", icon: Gauge },
    { id: "brands", label: "Existing brands", icon: Database },
    { id: "aliases", label: "Brand aliases", icon: Tags },
  ]},
  { section: "Data & setup", items: [
    { id: "artifacts", label: "Data & artifacts", icon: Archive },
    { id: "settings", label: "Data sources & setup", icon: Settings },
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
const sourceUpdated = (meta?: SourceMetadata) => meta ? `${meta.filename} · Updated ${fmtDate(meta.updatedAt)} at ${fmtTime(meta.updatedAt)}${meta.rowCount !== undefined ? ` · ${meta.rowCount.toLocaleString()} rows` : ""}${meta.fingerprint ? ` · Snapshot ${meta.fingerprint.replace("fnv1a-", "").toUpperCase()}` : ""}` : "Not updated yet";
const uid = () => globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
const sourceFingerprint = (rows: { id: string; name: string }[]) => {
  let hash = 2166136261;
  rows.forEach((row) => { const value = `${row.id}\u0000${row.name}\u0001`; for (let index = 0; index < value.length; index += 1) hash = Math.imul(hash ^ value.charCodeAt(index), 16777619); });
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
};
const intakeDecisionKey = (item: { id: string; name?: string; brand?: string }) => `${item.id}:${normalizeBrand(item.name || item.brand || "").toLowerCase()}`;
type ParsedRow = ReturnType<typeof parseCsv>[number];
type UbqSource = { filename: string; count: number; capturedAt?: string; byId: Map<string, ParsedRow>; byName: Map<string, ParsedRow[]> };
type ProcessingRun = { filename: string; count: number; steps: string[]; current: number; source?: WorkflowSource };
type GitHubSession = { token: string; user: GitHubUser };
type GitHubRemoteUpdate = { revision: string; sync?: SharedWorkspaceSnapshot["sync"] };
type TriageCounts = { inBasket: number; inReview: number; ready: number };
type SourceVerificationImport = { source: "UBQ" | "ROOT"; filename: string; importedAt: string; rowCount: number };
type ImportPreflight = { filename: string; rows: ParsedRow[]; decisions: ImportIntakeDecision[] };
const APP_BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";
const SYNC_SERVICE_URL = process.env.NEXT_PUBLIC_SYNC_SERVICE_URL || "";
const USE_SYNC_SERVICE = process.env.NEXT_PUBLIC_TEAM_SYNC_MODE === "nukv" && Boolean(SYNC_SERVICE_URL);
const GITHUB_TOKEN_KEY = "brandmaster-github-token";
const GITHUB_USER_KEY = "brandmaster-github-user";
const GITHUB_REVISION_KEY = "brandmaster-github-revision";
const WALKTHROUGH_SEEN_KEY = "brandmaster-guided-walkthrough-v2";
const GITHUB_SYNCED_AT_KEY = "brandmaster-github-synced-at";
const ACTIVE_TEAM_MEMBER_KEY = "brandmaster-active-team-member";
const ACTIVE_VIEW_KEY = "brandmaster-active-view";
const WORKSPACE_MODE_KEY = "brandmaster-workspace-mode";
const COMPLETED_BRAND_NOTICE_KEY = "brandmaster-completed-brand-notice";
const IMPORT_PREFLIGHT_KEY = "brandmaster-import-preflight";
const MAX_WORKLIST_SIZE = 20;
const TEAM_MEMBERS = ["Mike", "Tristan", "Bef", "Shae", "Nick"] as const;

function isWorkflowView(view?: View): view is "imports" | "review" | "output" {
  return view === "imports" || view === "review" || view === "output";
}

function isKnownView(view: View) {
  return UNIFIED_NAV.flatMap((group) => group.items).some((item) => item.id === view);
}

function normalizeSharedTaskOwners(data: AppData): AppData {
  let changed = false;
  const allowed = new Set<string>(TEAM_MEMBERS);
  const resolvedByQueueId = new Map((data.batches || []).flatMap((batch) => batch.records)
    .filter((record) => record.priorityQueueId && record.triageResolution && record.triageResolvedAt)
    .map((record) => [record.priorityQueueId!, record]));
  const normalized = normalizePriorityQueueItems(data.priorityQueue || []);
  if (normalized.length !== (data.priorityQueue || []).length || normalized.some((item, index) => item !== data.priorityQueue?.[index])) changed = true;
  const priorityQueue = normalized.map((item) => {
    const resolved = resolvedByQueueId.get(item.id);
    if (resolved && !item.resolvedWithoutMappingAt) {
      changed = true;
      return {
        ...item,
        status: "COMPLETED" as const,
        assignedTo: undefined,
        assignedAt: undefined,
        completedAt: resolved.triageResolvedAt,
        resolvedWithoutMappingAt: resolved.triageResolvedAt,
        resolvedWithoutMappingBy: resolved.triageResolvedBy,
        triageResolution: resolved.triageResolution,
        triageResolutionNote: resolved.triageResolutionNote,
        updatedAt: resolved.triageResolvedAt!,
      };
    }
    if (!item.assignedTo || allowed.has(item.assignedTo)) return item;
    changed = true;
    return item.status === "COMPLETED"
      ? { ...item, assignedTo: undefined, assignedAt: undefined }
      : { ...item, status: "UNASSIGNED" as const, assignedTo: undefined, assignedAt: undefined, completedAt: undefined, updatedAt: new Date().toISOString() };
  });
  const normalizedData = { ...data, teamPresence: data.teamPresence || {}, teamActivity: data.teamActivity || [] };
  return archiveTerminalTriages(changed ? { ...normalizedData, priorityQueue } : normalizedData);
}

function indexUbqRows(filename: string, rows: ParsedRow[], capturedAt?: string): UbqSource {
  const byId = new Map<string, ParsedRow>();
  const byName = new Map<string, ParsedRow[]>();
  rows.forEach((row) => {
    byId.set(row.id, row);
    const key = normalizeBrand(row.name).toLowerCase();
    byName.set(key, [...(byName.get(key) || []), row]);
  });
  return { filename, count: rows.length, capturedAt, byId, byName };
}

function manualFpaReferences(data: AppData) {
  const migrated = data.historicalMappings
    .filter((entry) => entry.ubq === true && entry.sourceBrandId)
    .map((entry): ManualFpaIdReference => ({
      id: `manual-fpa:${entry.sourceBrandId}`,
      brand: entry.brand,
      normalized: entry.normalized,
      sourceBrandId: entry.sourceBrandId!,
      ubq: true,
      listingCount: entry.listingCount,
      sellerCount: entry.sellerCount,
      reviewer: entry.reviewer,
      sourceRow: entry.sourceRow,
      sourceFilename: entry.sourceFilename,
      importedAt: entry.importedAt,
    }));
  return mergeManualFpaIds(migrated, data.manualFpaIds || [], "append");
}

function activeUbqSource(source: UbqSource | null, data: AppData) {
  const latestFullUbqAt = data.sourceMeta.UBQ?.updatedAt;
  const presentManualRows: ParsedRow[] = manualFpaReferences(data)
    .filter((reference) => reference.ubq === true && (!source || !latestFullUbqAt || reference.importedAt >= latestFullUbqAt))
    .map((reference) => ({
      id: reference.sourceBrandId,
      name: reference.brand,
      listingCount: reference.listingCount,
    }));
  if (!source && !presentManualRows.length) return null;
  const rows = new Map(presentManualRows.map((row) => [row.id, row]));
  source?.byId.forEach((row, id) => rows.set(id, row));
  const capturedAt = [source?.capturedAt, latestFullUbqAt, ...manualFpaReferences(data).filter((reference) => reference.ubq === true).map((reference) => reference.importedAt)].filter(Boolean).sort().at(-1);
  return indexUbqRows(source ? `${source.filename} + Manual FPA` : "Manual FPA", [...rows.values()], capturedAt);
}

function manualFpaIdSource(source: UbqSource | null, data: AppData) {
  const manualRows: ParsedRow[] = manualFpaReferences(data).map((reference) => ({
    id: reference.sourceBrandId,
    name: reference.brand,
    listingCount: reference.listingCount,
  }));
  if (!source && !manualRows.length) return null;
  const rows = new Map(manualRows.map((row) => [row.id, row]));
  source?.byId.forEach((row, id) => rows.set(id, row));
  return indexUbqRows(source ? `${source.filename} + Manual FPA IDs` : "Manual FPA IDs", [...rows.values()], source?.capturedAt);
}

function isPresentInCurrentUbq(source: UbqSource | null, row: { id?: string; name: string }) {
  if (!source) return false;
  if (row.id && source.byId.has(row.id)) return true;
  return source.byName.has(normalizeBrand(row.name).toLowerCase());
}

function ubqSnapshotCovers(source: UbqSource | null, workAt?: string) {
  return !source?.capturedAt || !workAt || workAt <= source.capturedAt;
}

function planImportIntake(data: AppData, rows: ParsedRow[], currentUser: string, source: UbqSource | null, reviewAgainKeys = new Set<string>()) {
  const currentSource = activeUbqSource(source, data);
  const planned = planPriorityImports(rows, data.priorityQueue, currentUser);
  const completedByName = new Map(findCompletedBrandDetailsNotInUbq(data, rows, currentSource).map((detail) => [normalizeBrand(detail.brand).toLowerCase(), detail]));
  return planned.map(({ row, accepted, reason, disposition, existing }) => {
    const completed = completedByName.get(normalizeBrand(row.name).toLowerCase());
    const workAt = existing?.verifiedAt || existing?.exportedAt || existing?.resolvedWithoutMappingAt || existing?.completedAt;
    const presentInSnapshot = isPresentInCurrentUbq(currentSource, row);
    const returnedInUbq = presentInSnapshot && ubqSnapshotCovers(currentSource, workAt);
    const protectedByActiveWork = disposition === "TEAMMATE_ACTIVE_WORK" || disposition === "YOUR_ACTIVE_WORK";
    const reviewAgainAllowed = disposition !== "TEAMMATE_ACTIVE_WORK" && (Boolean(completed) || !accepted);
    const reviewAgain = reviewAgainAllowed && reviewAgainKeys.has(intakeDecisionKey(row));
    const snapshotLabel = currentSource?.capturedAt
      ? `${currentSource.filename} uploaded ${fmtDate(currentSource.capturedAt)} at ${fmtTime(currentSource.capturedAt)}`
      : currentSource?.filename || "the current not-done source";
    if (reviewAgain) return { id: row.id, brand: row.name, outcome: "IMPORTED" as const, reason: `Explicitly reopened by ${currentUser} for review again` };
    if (!workAt && !completed && !protectedByActiveWork && ["READY_FOR_EXPORT", "AWAITING_VERIFICATION", "VERIFIED_COMPLETE", "RESOLVED_WITHOUT_MAPPING"].includes(disposition)) {
      return { id: row.id, brand: row.name, outcome: "IMPORTED" as const, reason: "NOT DONE — no reliable completion timestamp was recorded" };
    }
    if (returnedInUbq && !protectedByActiveWork && ["READY_FOR_EXPORT", "AWAITING_VERIFICATION", "VERIFIED_COMPLETE", "RESOLVED_WITHOUT_MAPPING"].includes(disposition)) {
      return { id: row.id, brand: row.name, outcome: "IMPORTED" as const, reason: `NOT DONE — present in ${snapshotLabel}; the older completion is invalid` };
    }
    if (presentInSnapshot && accepted) return { id: row.id, brand: row.name, outcome: "IMPORTED" as const, reason: `NOT DONE — present in ${snapshotLabel}` };
    return completed
      ? { id: row.id, brand: row.name, outcome: "NOT_IMPORTED" as const, reason: `${completed.action} completed ${fmtDate(completed.date)} at ${fmtTime(completed.date)}${presentInSnapshot && currentSource?.capturedAt ? ` — after the ${fmtTime(currentSource.capturedAt)} not-done snapshot` : " — no newer not-done record found"}`, reviewAgainAllowed, action: completed.action, date: completed.date }
      : { id: row.id, brand: row.name, outcome: accepted ? "IMPORTED" as const : "NOT_IMPORTED" as const, reason: accepted ? "No completed record found — ready to review" : reason, reviewAgainAllowed };
  });
}

function resolveRecordWithUbq(record: BrandRecord, source: UbqSource) {
  const exactId = source.byId.get(record.id);
  const nameMatches = source.byName.get(normalizeBrand(record.name).toLowerCase()) || [];
  const match = exactId || (nameMatches.length === 1 ? nameMatches[0] : undefined);
  if (!match?.id.startsWith("draft_brand_")) return record;
  return { ...record, id: match.id, listingCount: match.listingCount ?? record.listingCount, skuCount: match.skuCount ?? record.skuCount, ubqVerified: true, reason: record.reason === "This brand was not found in the loaded UBQ export" ? "UBQ ID verified; review the current brand decision" : record.reason, evidence: [...new Set([`UBQ ID verified: ${match.id}`, ...record.evidence.filter((item) => item !== "UBQ lookup failed")])] };
}

function effectiveCatalogBrands(data: AppData) {
  const brands = new Map<string, CatalogBrand>();
  [...data.fpaBrands, ...data.acaBrands, ...SEED_BRANDS, ...data.rootBrands, ...data.customBrands].forEach((brand) => brands.set(brand.id, brand));
  return [...brands.values()];
}

function findExistingBrandByName(value: string, brands: CatalogBrand[], excludeId?: string) {
  const key = value.trim().toLowerCase();
  if (!key) return undefined;
  return brands.find((brand) => brand.id !== excludeId && (
    brand.name.trim().toLowerCase() === key
    || brand.aliases.some((alias) => alias.trim().toLowerCase() === key)
  ));
}

function isActiveTriageRecord(record: BrandRecord) {
  return !record.excludedFromExport && !record.triageResolution && record.adminUploadStatus !== "SUCCESS";
}

function activeTriageForUser(data: AppData, user: string) {
  const batch = activeUserBatch(data, user);
  return batch?.records.some(isActiveTriageRecord) ? batch : undefined;
}

function isActivePriorityTask(item: PriorityQueueItem) {
  return !item.exportedAt && !item.resolvedWithoutMappingAt;
}

function getPriorityQueueCounts(items: PriorityQueueItem[], currentUser = "") {
  const active = items.filter(isActivePriorityTask);
  const mine = currentUser ? active.filter((item) => item.assignedTo === currentUser) : [];
  return {
    active: active.length,
    available: active.filter((item) => item.status === "UNASSIGNED").length,
    assigned: active.filter((item) => item.status !== "UNASSIGNED" && item.status !== "COMPLETED").length,
    inReview: active.filter((item) => item.status === "IN_REVIEW").length,
    ready: active.filter((item) => item.status === "COMPLETED").length,
    mineOpen: mine.filter((item) => item.status !== "COMPLETED").length,
    mineReady: mine.filter((item) => item.status === "COMPLETED").length,
    mineTotal: mine.length,
    exported: items.filter((item) => Boolean(item.exportedAt)).length,
  };
}

function getTriageCounts(records: BrandRecord[], rootMode = false): TriageCounts {
  if (!rootMode) {
    const active = records.filter(isActiveTriageRecord);
    const readiness = getBulkExportReadiness(active);
    const blocked = new Set([...readiness.invalidIds, ...readiness.needsReview, ...readiness.incompleteMerges, ...readiness.incompleteCreates, ...readiness.duplicateSourceMappings]);
    return { inBasket: active.length, inReview: active.filter((record) => blocked.has(record)).length, ready: active.filter((record) => !blocked.has(record)).length };
  }
  const individuallyReady = records.filter((record) => {
    if (!isActiveTriageRecord(record)) return false;
    if (record.status === "needs-review" || record.blockedByTargetCreation) return false;
    if (rootMode) return record.action !== "MERGE" || Boolean(record.targetId?.startsWith("brand_") && record.targetId !== record.id && record.targetName?.trim());
    if (!record.ubqVerified || !record.id.startsWith("draft_brand_")) return false;
    if (record.action === "MERGE") return Boolean(record.targetId?.startsWith("brand_") && record.targetName?.trim());
    if (record.action === "CREATE") return Boolean(record.targetName?.trim());
    return true;
  }).length;
  const inReview = records.filter((record) => isActiveTriageRecord(record) && (
    record.status === "needs-review"
    || Boolean(record.blockedByTargetCreation)
    || (!rootMode && (!record.ubqVerified || !record.id.startsWith("draft_brand_")))
    || (record.action === "MERGE" && (!record.targetId?.startsWith("brand_") || !record.targetName?.trim() || (rootMode && record.targetId === record.id)))
    || (record.action === "CREATE" && !record.targetName?.trim())
  )).length;
  return { inBasket: records.filter(isActiveTriageRecord).length, inReview, ready: individuallyReady };
}

function triageRecordLabel(record: BrandRecord, records: BrandRecord[]) {
  if (record.excludedFromExport) return "Excluded from download";
  const readiness = getBulkExportReadiness(records.filter(isActiveTriageRecord));
  if (readiness.duplicateSourceMappings.includes(record)) return "Duplicate source ID — choose one decision";
  if (readiness.invalidIds.includes(record)) return "Missing or unverified UBQ ID";
  if (record.blockedByTargetCreation) return "Waiting for its target brand";
  if (readiness.needsReview.includes(record)) return "Needs a reviewer decision";
  if (readiness.incompleteMerges.includes(record)) return "MERGE target needs correction";
  if (readiness.incompleteCreates.includes(record)) return "CREATE name is missing";
  return "Ready for Step 3";
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
    const targetCompatibility = rootTarget?.targetName ? assessMergeCompatibility(record.name, rootTarget.targetName) : undefined;
    const trustedTargetEvidence = Boolean(rootTarget && ["Alias table", "Brand table exact", "FPA exact", "Previous manual decision", "Admin-verified previous decision"].includes(rootTarget.decisionSource));
    const safeRootTarget = rootTarget && (targetCompatibility?.safe || trustedTargetEvidence) ? rootTarget : undefined;
    const previouslyMergedStillPresent = history.some((candidate) => candidate.id === record.id && candidate.action === "MERGE" && candidate.targetId?.startsWith("brand_"));
    const canonical = [...familyRows].sort((left, right) => (right.listingCount || 0) - (left.listingCount || 0) || Number(/[\\/]/.test(left.name)) - Number(/[\\/]/.test(right.name)) || left.name.length - right.name.length)[0];
    const familyEvidence = related.map((item) => `Related UBQ: ${item.name} (${item.score}% · ${item.id})`);
    if (safeRootTarget) return { ...record, action: "MERGE", targetId: safeRootTarget.targetId, targetName: safeRootTarget.targetName, confidence: Math.min(96, Math.max(88, safeRootTarget.confidence - (directTarget ? 0 : 3))), reason: previouslyMergedStillPresent ? `This exact UBQ row was previously MERGED to ${safeRootTarget.targetName} but is still present. Reapply the MERGE or manually DELETE the stale queue record in Admin` : priorTarget ? `A previous MERGE in this UBQ family maps the remaining variation to ${safeRootTarget.targetName}` : `A related UBQ variation resolves to the existing brand ${safeRootTarget.targetName}`, decisionSource: previouslyMergedStillPresent ? "Previously merged UBQ still present" : priorTarget ? "Previous UBQ family MERGE" : "UBQ family + existing brand", status: "needs-review" as const, relatedUbq: related, ubqFamilyCanonicalId: canonical.id, ubqFamilyCanonicalName: canonical.name, priorFamilyTargetId: safeRootTarget.targetId, priorFamilyTargetName: safeRootTarget.targetName, previouslyMergedStillPresent, canonicalTargetChain: safeRootTarget.canonicalTargetChain, blockedByTargetCreation: false, suggestedAliases: [...new Set([record.name, ...related.map((item) => item.name)].filter((name) => name.toLowerCase() !== safeRootTarget.targetName?.toLowerCase()))], evidence: [`Family target: ${safeRootTarget.targetName} · ${safeRootTarget.targetId}`, ...(safeRootTarget.canonicalTargetChain && safeRootTarget.canonicalTargetChain.length > 1 ? [`Target chain resolved: ${safeRootTarget.canonicalTargetChain.join(" → ")}`] : []), ...(priorTarget ? [`Prior MERGE: ${priorTarget.name} → ${priorTarget.targetName}`] : []), ...familyEvidence, ...record.evidence] };
    if (directTarget && rootTarget && !safeRootTarget) return { ...record, action: "CREATE", targetId: undefined, targetName: record.normalized, confidence: 45, reason: `Rejected weak automatic MERGE to ${rootTarget.targetName}: ${targetCompatibility?.reason || "insufficient brand identity evidence"}`, decisionSource: "Weak merge rejected", status: "needs-review" as const, mergeOverride: false, relatedUbq: related, evidence: [`Rejected target: ${rootTarget.targetName} · ${rootTarget.targetId}`, ...familyEvidence, ...record.evidence] };
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

export default function BrandmasterApp({ authenticatedIdentity = null, onAuthenticatedSignOut }: { authenticatedIdentity?: AuthenticatedBrandmasterUser | null; onAuthenticatedSignOut?: () => Promise<void> }) {
  const [view, setView] = useState<View>("imports");
  const [data, setData] = useState<AppData>(EMPTY_DATA);
  const [loaded, setLoaded] = useState(false);
  const [dark, setDark] = useState(false);
  const [sidebar, setSidebar] = useState(false);
  const [online, setOnline] = useState(true);
  const [toast, setToast] = useState("");
  const [selected, setSelected] = useState<BrandRecord | null>(null);
  const [reviewFocusIds, setReviewFocusIds] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [ubqSource, setUbqSource] = useState<UbqSource | null>(null);
  const [processing, setProcessing] = useState<ProcessingRun | null>(null);
  const [restartOpen, setRestartOpen] = useState(false);
  const [resettingTriage, setResettingTriage] = useState(false);
  const [githubSession, setGitHubSession] = useState<GitHubSession | null>(null);
  const [githubRemoteUpdate, setGitHubRemoteUpdate] = useState<GitHubRemoteUpdate | null>(null);
  const [githubTeamSync, setGitHubTeamSync] = useState<SharedWorkspaceSnapshot["sync"]>();
  const [serviceSession, setServiceSession] = useState<SyncSession | null>(null);
  const [localProfile, setLocalProfile] = useState<LocalProfile | null>(null);
  const [activeTeamMember, setActiveTeamMember] = useState("");
  const [profileOpen, setProfileOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const [workflowView, setWorkflowView] = useState<"clean" | "advanced">("clean");
  const [appUpdateReady, setAppUpdateReady] = useState(false);
  const [storageHydrated, setStorageHydrated] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [savePending, setSavePending] = useState(false);
  const [workspaceMode, setWorkspaceMode] = useState<"team" | "offline">("team");
  const [queueUndo, setQueueUndo] = useState<{ items: PriorityQueueItem[]; message: string } | null>(null);
  const [sourceVerification, setSourceVerification] = useState<SourceVerificationImport | null>(null);
  const [completedBrandNotice, setCompletedBrandNotice] = useState<CompletedBrandDetail[] | null>(null);
  const [importPreflight, setImportPreflight] = useState<ImportPreflight | null>(null);
  const [syncProtectionReleasedBatchId, setSyncProtectionReleasedBatchId] = useState<string | null>(null);
  const githubSessionRef = useRef<GitHubSession | null>(null);
  const dataRef = useRef<AppData>(EMPTY_DATA);
  const ubqSourceRef = useRef<UbqSource | null>(null);
  const githubSyncRunningRef = useRef(false);
  const githubSyncQueuedRef = useRef(false);
  const githubLocalVersionRef = useRef(0);
  const teamSyncPauseRef = useRef<NonNullable<SharedWorkspaceSnapshot["sync"]>["pause"]>(undefined);
  const githubLiveSyncRef = useRef<(reason: "connect" | "poll" | "edit" | "online" | "manual") => Promise<string>>(async () => "Team Sync is starting.");

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(COMPLETED_BRAND_NOTICE_KEY) || "null") as CompletedBrandDetail[] | null;
      const validActions = new Set(["CREATE", "MERGE", "SKIP", "DELETE", "COMPLETED"]);
      if (Array.isArray(saved) && saved.length && saved.every((item) => item && typeof item.brand === "string" && typeof item.date === "string" && validActions.has(item.action))) {
        setCompletedBrandNotice(saved);
      } else {
        localStorage.removeItem(COMPLETED_BRAND_NOTICE_KEY);
      }
    } catch {
      localStorage.removeItem(COMPLETED_BRAND_NOTICE_KEY);
    }
  }, []);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(IMPORT_PREFLIGHT_KEY) || "null") as ImportPreflight | null;
      if (saved && typeof saved.filename === "string" && Array.isArray(saved.rows) && Array.isArray(saved.decisions) && saved.rows.length > 0 && saved.rows.length === saved.decisions.length) {
        setImportPreflight(saved);
      } else {
        localStorage.removeItem(IMPORT_PREFLIGHT_KEY);
      }
    } catch {
      localStorage.removeItem(IMPORT_PREFLIGHT_KEY);
    }
  }, []);

  useEffect(() => {
    const savedData = normalizeSharedTaskOwners(loadData());
    setWorkspaceMode(localStorage.getItem(WORKSPACE_MODE_KEY) === "offline" ? "offline" : "team");
    const savedView = localStorage.getItem(ACTIVE_VIEW_KEY) as View | null;
    const savedTeamMember = localStorage.getItem(ACTIVE_TEAM_MEMBER_KEY) || "";
    if (TEAM_MEMBERS.some((member) => member === savedTeamMember)) {
      setActiveTeamMember(savedTeamMember);
      const workspace = savedData.userWorkspaces[savedTeamMember];
      const batch = activeUserBatch(savedData, savedTeamMember);
      const checkpoint = resolveWorkflowCheckpoint(workspace?.activeView, batch);
      setView(checkpoint || "imports");
      setReviewFocusIds((workspace?.reviewFocusIds || []).filter((id) => batch?.records.some((record) => record.id === id)));
    } else if (savedView && isKnownView(savedView)) setView(savedView);
    const savedUser = localStorage.getItem("brandmaster-last-user");
    let profile: LocalProfile | null = null;
    try {
      const stored = JSON.parse(localStorage.getItem(LOCAL_PROFILE_KEY) || "null") as LocalProfile | null;
      if (stored && validLocalUsername(stored.username) && stored.deviceId) profile = stored;
    } catch { /* A new local profile will replace invalid browser data. */ }
    if (!profile && savedUser && savedUser !== "Local user") profile = { username: normalizeLocalUsername(savedUser), deviceId: createDeviceId(), createdAt: new Date().toISOString(), verifiedLogin: normalizeLocalUsername(savedUser) };
    if (profile) {
      localStorage.setItem(LOCAL_PROFILE_KEY, JSON.stringify(profile));
      Object.assign(savedData, migrateAppIdentity(savedData, ["Local user", "You"], localProfileIdentity(profile)));
      setLocalProfile(profile);
    }
    if (Object.keys(savedData.learned).length && !savedData.sourceMeta.DECISIONS) savedData.sourceMeta.DECISIONS = { filename: "Previously loaded decisions", updatedAt: new Date().toISOString() };
    setData(savedData);
    const workspaceLoad = loadWorkspaceData().then((saved) => {
      if (!saved) return;
      setData((current) => normalizeSharedTaskOwners({
        ...EMPTY_DATA, ...saved,
        // Catalogs are restored from their dedicated records and may finish
        // before this request. Never replace them with an older embedded copy.
        acaBrands: current.acaBrands,
        fpaBrands: current.fpaBrands,
        rootBrands: current.rootBrands,
        historicalMappings: saved.historicalMappings || [],
        manualFpaIds: saved.manualFpaIds || [],
        priorityQueue: saved.priorityQueue || [],
        cleanupConfirmations: saved.cleanupConfirmations || [],
        adminUpdateRuns: saved.adminUpdateRuns || [],
        userWorkspaces: saved.userWorkspaces || {},
        teamPresence: saved.teamPresence || {},
        teamActivity: saved.teamActivity || [],
        rootChanges: saved.rootChanges || {},
        sourceMeta: saved.sourceMeta || {},
        validationSettings: { ...EMPTY_DATA.validationSettings, ...(saved.validationSettings || {}) },
      }));
    }).catch(() => undefined);
    const notDoneLoad = workspaceLoad.then(async () => {
      const response = await fetch(`${APP_BASE_PATH}/manual-fpa-current.json`, { cache: "no-store" });
      if (!response.ok) return;
      const snapshot = await response.json() as unknown;
      if (!isNotDoneSnapshot(snapshot)) return;
      setData((prev) => applyNotDoneSnapshot(prev, snapshot));
    }).catch(() => undefined);
    const referenceLoad = loadReferenceTables().then((tables) => setData((prev) => {
      const sourceMeta = { ...prev.sourceMeta };
      const restoredAt = new Date().toISOString();
      if (tables.rootBrands.length && !sourceMeta.ROOT) sourceMeta.ROOT = { filename: "Previously loaded root table", updatedAt: restoredAt };
      if (tables.acaBrands.length && !sourceMeta.ACA) sourceMeta.ACA = { filename: "Previously loaded ACA table", updatedAt: restoredAt };
      if (tables.fpaBrands.length && !sourceMeta.FPA) sourceMeta.FPA = { filename: "Previously loaded FPA table", updatedAt: restoredAt };
      return { ...prev, ...tables, sourceMeta };
    })).catch(() => setToast("Local reference tables could not be restored"));
    const ubqLoad = loadUbqReference().then((saved) => {
      if (!saved?.rows.length) return;
      const source = indexUbqRows(saved.filename, saved.rows, savedData.sourceMeta.UBQ?.updatedAt);
      setUbqSource(source);
      setData((prev) => ({ ...prev, batches: prev.batches.map((batch) => ({ ...batch, records: batch.records.map((record) => resolveRecordWithUbq(record, source)) })), sourceMeta: { ...prev.sourceMeta, UBQ: prev.sourceMeta.UBQ || { filename: saved.filename, updatedAt: new Date().toISOString() } } }));
    }).catch(() => undefined);
    void Promise.allSettled([notDoneLoad, referenceLoad, ubqLoad]).then(() => {
      setStorageHydrated(true);
      setLoaded(true);
    });
    setDark(localStorage.getItem("brandmaster-theme") === "dark" || (!localStorage.getItem("brandmaster-theme") && matchMedia("(prefers-color-scheme: dark)").matches));
    setWorkflowView(localStorage.getItem("brandmaster-workflow-view") === "advanced" ? "advanced" : "clean");
    const update = () => setOnline(navigator.onLine); update();
    addEventListener("online", update); addEventListener("offline", update);
    const hadServiceWorkerController = "serviceWorker" in navigator && Boolean(navigator.serviceWorker.controller);
    const handleServiceWorkerChange = () => {
      if (hadServiceWorkerController && navigator.serviceWorker.controller) setAppUpdateReady(true);
    };
    if ("serviceWorker" in navigator && process.env.NEXT_PUBLIC_ENABLE_OFFLINE === "true") {
      navigator.serviceWorker.addEventListener("controllerchange", handleServiceWorkerChange);
      navigator.serviceWorker.register(`${APP_BASE_PATH}/sw.js`, { scope: `${APP_BASE_PATH}/`, updateViaCache: "none" }).then((registration) => {
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          worker?.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) setAppUpdateReady(true);
          });
        });
        return registration.update();
      }).catch(() => undefined);
    } else if ("serviceWorker" in navigator) {
      // Remove a worker left by an older Vercel deployment. Vercel/Next owns
      // application asset versioning; the offline worker is only for static builds.
      void navigator.serviceWorker.getRegistrations().then((registrations) => Promise.all(registrations
        .filter((registration) => new URL(registration.scope).origin === location.origin)
        .map((registration) => registration.unregister()))).then(() => {
          if ("caches" in globalThis) return caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith("brandmaster-")).map((key) => caches.delete(key))));
        }).catch(() => undefined);
    }
    return () => {
      removeEventListener("online", update);
      removeEventListener("offline", update);
      if ("serviceWorker" in navigator) navigator.serviceWorker.removeEventListener("controllerchange", handleServiceWorkerChange);
    };
  }, []);
  useEffect(() => { dataRef.current = data; githubLocalVersionRef.current += 1; if (githubSyncRunningRef.current) githubSyncQueuedRef.current = true; }, [data]);
  useEffect(() => { ubqSourceRef.current = ubqSource; githubLocalVersionRef.current += 1; if (githubSyncRunningRef.current) githubSyncQueuedRef.current = true; }, [ubqSource]);
  useEffect(() => { githubSessionRef.current = githubSession; }, [githubSession]);
  useEffect(() => { if (loaded && storageHydrated) saveData(data); }, [data, loaded, storageHydrated]);
  useEffect(() => {
    if (!USE_SYNC_SERVICE) return;
    getSyncSession(SYNC_SERVICE_URL).then((session) => setServiceSession(session)).catch(() => setServiceSession({ authenticated: false }));
  }, []);
  useEffect(() => {
    if (!loaded || !storageHydrated || USE_SYNC_SERVICE || githubSessionRef.current) return;
    const token = localStorage.getItem(GITHUB_TOKEN_KEY)?.trim(); if (!token) return;
    let cachedUser: GitHubUser | null = null;
    try { cachedUser = JSON.parse(localStorage.getItem(GITHUB_USER_KEY) || "null") as GitHubUser | null; } catch { /* Revalidate below. */ }
    if (cachedUser?.login) {
      const cachedSession = { token, user: cachedUser };
      githubSessionRef.current = cachedSession;
      setGitHubSession(cachedSession);
    }
    let active = true;
    void Promise.all([connectGitHubWorkspace(token), verifyGitHubWorkspaceRepository(token)]).then(([user]) => {
      localStorage.setItem(GITHUB_USER_KEY, JSON.stringify(user));
      if (active) { githubSessionRef.current = { token, user }; setGitHubSession({ token, user }); }
    }).catch(() => {
      if (active && !cachedUser?.login) setToast("The saved Team Sync connection could not be verified yet. Reconnect to VPN, then use Save & pull.");
    });
    return () => { active = false; };
  }, [loaded, storageHydrated]);
  useEffect(() => {
    if (!authenticatedIdentity?.login) return;
    const login = authenticatedIdentity.login;
    localStorage.setItem("brandmaster-last-user", login);
    let previous: LocalProfile | null = null;
    try { previous = JSON.parse(localStorage.getItem(LOCAL_PROFILE_KEY) || "null") as LocalProfile | null; } catch { /* Replace invalid local identity data. */ }
    const nextProfile: LocalProfile = { username: login, deviceId: previous?.deviceId || createDeviceId(), createdAt: previous?.createdAt || new Date().toISOString(), verifiedLogin: login };
    localStorage.setItem(LOCAL_PROFILE_KEY, JSON.stringify(nextProfile));
    setData((prev) => migrateAppIdentity(prev, [previous ? localProfileIdentity(previous) : "", previous?.username || "", "Local user", "You"], login));
    setLocalProfile(nextProfile); setProfileOpen(false);
  }, [authenticatedIdentity]);
  useEffect(() => { document.documentElement.dataset.theme = dark ? "dark" : "light"; localStorage.setItem("brandmaster-theme", dark ? "dark" : "light"); }, [dark]);
  useEffect(() => { localStorage.setItem(ACTIVE_VIEW_KEY, view); }, [view]);
  useEffect(() => {
    if (!loaded || !activeTeamMember || !isWorkflowView(view)) return;
    setSavePending(true);
    setData((prev) => {
      const existing = prev.userWorkspaces[activeTeamMember] || { pinnedQueueIds: [], uploads: [], updatedAt: new Date().toISOString() };
      const nextFocus = view === "review" ? reviewFocusIds : existing.reviewFocusIds || [];
      if (existing.activeView === view && JSON.stringify(existing.reviewFocusIds || []) === JSON.stringify(nextFocus)) return prev;
      const now = new Date().toISOString();
      return { ...prev, userWorkspaces: { ...prev.userWorkspaces, [activeTeamMember]: { ...existing, activeView: view, reviewFocusIds: nextFocus, checkpointAt: now, updatedAt: now } } };
    });
  }, [loaded, activeTeamMember, view, reviewFocusIds]);
  useEffect(() => { localStorage.setItem("brandmaster-workflow-view", workflowView); }, [workflowView]);
  useEffect(() => { localStorage.setItem(WORKSPACE_MODE_KEY, workspaceMode); }, [workspaceMode]);
  useEffect(() => {
    if (!loaded || localStorage.getItem(WALKTHROUGH_SEEN_KEY)) return;
    const timer = window.setTimeout(() => setTourOpen(true), 900);
    return () => window.clearTimeout(timer);
  }, [loaded]);
  function closeWalkthrough() {
    localStorage.setItem(WALKTHROUGH_SEEN_KEY, "seen");
    setTourOpen(false);
  }
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => { setToast(""); setQueueUndo(null); }, queueUndo ? 6500 : 2800); return () => clearTimeout(timer); }, [toast, queueUndo]);
  useEffect(() => {
    if (!githubSession || !storageHydrated || USE_SYNC_SERVICE) return;
    setSyncBusy(true);
    const statusCheck = getGitHubWorkspaceStatus(githubSession.token).then((status) => {
        const lastRevision = localStorage.getItem(GITHUB_REVISION_KEY);
        setGitHubTeamSync(status.sync);
        setGitHubRemoteUpdate(status.revision && status.revision !== lastRevision ? { revision: status.revision, sync: status.sync } : null);
        teamSyncPauseRef.current = status.sync?.pause;
      });
    void statusCheck.catch(() => undefined).finally(() => setSyncBusy(false));
  }, [githubSession, storageHydrated]);
  useEffect(() => {
    if (!USE_SYNC_SERVICE || !serviceSession?.authenticated) return;
    let active = true;
    async function check() {
      try {
        const remote = await pullSharedWorkspace(SYNC_SERVICE_URL); if (!active) return;
        setGitHubTeamSync(remote.workspace?.sync);
        const lastRevision = localStorage.getItem("brandmaster-service-revision");
        setGitHubRemoteUpdate(remote.revision && remote.revision !== lastRevision ? { revision: remote.revision, sync: remote.workspace?.sync } : null);
      } catch { /* Manual sync displays actionable authentication or network errors. */ }
    }
    void check();
    return () => { active = false; };
  }, [serviceSession]);

  const allRecords = useMemo(() => data.batches.flatMap((batch) => batch.records), [data.batches]);
  const userBatches = useMemo(() => data.batches.filter((batch) => !batch.archivedAt && (batch.owner === activeTeamMember || (!batch.owner && !activeTeamMember))), [data.batches, activeTeamMember]);
  const userRecords = useMemo(() => userBatches.flatMap((batch) => batch.records), [userBatches]);
  const knownBrandIds = useMemo(() => new Set([
    ...SEED_BRANDS, ...canonicalRootCatalog(data.rootBrands), ...data.fpaBrands, ...data.customBrands,
  ].map((brand) => brand.id).filter((id) => id.startsWith("brand_")).concat(allRecords.map((record) => record.targetId || "").filter((id) => id.startsWith("brand_")))), [data.rootBrands, data.fpaBrands, data.customBrands, allRecords]);
  const catalogBrands = useMemo(() => effectiveCatalogBrands(data), [data]);
  const currentUbqSource = useMemo(() => activeUbqSource(ubqSource, data), [ubqSource, data]);
  const workflowUbqSource = useMemo(() => manualFpaIdSource(ubqSource, data), [ubqSource, data]);
  const preferredBatchId = activeTeamMember ? data.userWorkspaces[activeTeamMember]?.activeBatchId : undefined;
  const activeBatch = preferredBatchId ? userBatches.find((batch) => batch.id === preferredBatchId) : undefined;
  const current = activeBatch ? triageWorklistForMode(activeBatch, workflowView === "clean", MAX_WORKLIST_SIZE) : undefined;
  const teamWeeklyCompletionActivity = useMemo(() => buildWeeklyCompletionActivity(data.historicalMappings, data.manualFpaIds, data.adminUpdateRuns), [data.historicalMappings, data.manualFpaIds, data.adminUpdateRuns]);
  const topWeeklyTarget = useMemo(() => buildWeeklyTargetProgress(teamWeeklyCompletionActivity), [teamWeeklyCompletionActivity]);
  const topPersonalWeeklyTarget = useMemo(() => buildWeeklyTargetProgress(completionActivityForReviewer(teamWeeklyCompletionActivity, activeTeamMember || "Unattributed")), [teamWeeklyCompletionActivity, activeTeamMember]);
  const protectedTriage = shouldProtectTriage(view, current?.id, syncProtectionReleasedBatchId);
  const teamSyncPause = githubTeamSync?.pause;
  teamSyncPauseRef.current = teamSyncPause;
  const serviceLogin = serviceSession?.authenticated ? serviceSession.user?.login : undefined;
  const technicalLogin = authenticatedIdentity?.login || serviceLogin || githubSession?.user.login;
  const currentUser = activeTeamMember || "Unassigned team member";
  const queueUser = activeTeamMember;
  const identityDisplay = activeTeamMember || "Choose team member";
  const identityVerified = Boolean(activeTeamMember);
  const teamConnected = Boolean(serviceSession?.authenticated || githubSession);
  const editingAllowed = teamConnected || workspaceMode === "offline";
  const identityInitials = activeTeamMember ? activeTeamMember.slice(0, 2).toUpperCase() : "?";
  const activeUserRecords = userRecords.filter(isActiveTriageRecord);
  const pending = activeUserRecords.filter((r) => r.status === "needs-review");
  const avg = activeUserRecords.length ? Math.round(activeUserRecords.reduce((sum, item) => sum + item.confidence, 0) / activeUserRecords.length) : 0;
  const activeTeammates = Object.values(data.teamPresence || {}).filter((entry) => Date.now() - new Date(entry.lastSeenAt).getTime() < 6 * 60_000).sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt));
  const recentTeamActivity = (data.teamActivity || []).slice().sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6);

  useEffect(() => {
    if (!importPreflight || !queueUser) return;
    const decisions = planImportIntake(data, importPreflight.rows, queueUser, ubqSource);
    if (JSON.stringify(decisions) === JSON.stringify(importPreflight.decisions)) return;
    const refreshed = { ...importPreflight, decisions };
    localStorage.setItem(IMPORT_PREFLIGHT_KEY, JSON.stringify(refreshed));
    setImportPreflight(refreshed);
  }, [data, importPreflight, queueUser, ubqSource]);

  useEffect(() => {
    if (teamConnected && workspaceMode !== "team") setWorkspaceMode("team");
  }, [teamConnected, workspaceMode]);
  useEffect(() => { if (!editingAllowed) setSelected(null); }, [editingAllowed]);

  function presenceArea(): AppData["teamPresence"][string]["area"] {
    if (view === "imports") return "STEP_1";
    if (view === "review") return "STEP_2";
    if (view === "output") return "STEP_3";
    return "ADMIN";
  }
  function withPresence(prev: AppData, user = activeTeamMember, area = presenceArea()): AppData {
    if (!user) return prev;
    return { ...prev, teamPresence: { ...(prev.teamPresence || {}), [user]: { user, area, lastSeenAt: new Date().toISOString(), deviceId: localProfile?.deviceId } } };
  }
  function withTeamActivity(prev: AppData, type: AppData["teamActivity"][number]["type"], message: string, count?: number, batchId?: string): AppData {
    const now = new Date().toISOString();
    const entry = { id: `team:${type}:${now}:${uid()}`, at: now, by: activeTeamMember || "Shared team", type, message, count, batchId };
    return { ...withPresence(prev), teamActivity: [entry, ...(prev.teamActivity || [])].slice(0, 250) };
  }

  function chooseTeamMember(member: string) {
    if (!TEAM_MEMBERS.some((candidate) => candidate === member)) return;
    localStorage.setItem(ACTIVE_TEAM_MEMBER_KEY, member);
    setActiveTeamMember(member);
    const workspace = dataRef.current.userWorkspaces[member];
    const batch = activeUserBatch(dataRef.current, member);
    const checkpoint = resolveWorkflowCheckpoint(workspace?.activeView, batch);
    if (checkpoint) {
      setView(checkpoint);
      setReviewFocusIds((workspace?.reviewFocusIds || []).filter((id) => batch?.records.some((record) => record.id === id)));
    } else {
      setView("imports");
      setReviewFocusIds([]);
    }
    setData((prev) => withPresence(prev, member));
    setToast(`Working as ${member} across Brandmaster`);
  }

  useEffect(() => {
    if (!activeTeamMember || !teamConnected) return;
    const area = view === "imports" ? "STEP_1" : view === "review" ? "STEP_2" : view === "output" ? "STEP_3" : "ADMIN";
    const touch = () => {
      const lastSeenAt = new Date().toISOString();
      setData((prev) => ({ ...prev, teamPresence: { ...(prev.teamPresence || {}), [activeTeamMember]: { user: activeTeamMember, area, lastSeenAt, deviceId: localProfile?.deviceId } } }));
      setSavePending(true);
    };
    touch();
    const timer = setInterval(touch, 4 * 60_000);
    return () => clearInterval(timer);
  }, [activeTeamMember, teamConnected, view, localProfile?.deviceId]);

  function updateUserWorkspace(user: string, changes: Partial<AppData["userWorkspaces"][string]>) {
    if (!user) return;
    setData((prev) => {
      const existing = prev.userWorkspaces[user] || { pinnedQueueIds: [], uploads: [], updatedAt: new Date().toISOString() };
      return { ...prev, userWorkspaces: { ...prev.userWorkspaces, [user]: { ...existing, ...changes, updatedAt: new Date().toISOString() } } };
    });
    markPriorityPending();
  }
  function togglePinnedTask(id: string) {
    if (!queueUser) { setToast("Choose who is working before pinning a task"); return; }
    const currentPins = data.userWorkspaces[queueUser]?.pinnedQueueIds || [];
    const pinnedQueueIds = currentPins.includes(id) ? currentPins.filter((item) => item !== id) : [id, ...currentPins];
    updateUserWorkspace(queueUser, { pinnedQueueIds });
    setToast(currentPins.includes(id) ? "Task unpinned from your workspace" : `Task pinned for ${queueUser}`);
  }

  function currentGitHubSnapshot(): SharedWorkspaceSnapshot {
    const source = ubqSourceRef.current;
    return { schemaVersion: "brandmaster.workspace.v1", exportedAt: new Date().toISOString(), data: dataRef.current, ubq: source ? { filename: source.filename, rows: [...source.byId.values()] } : null };
  }
  async function rememberGitHubWorkspace(revision: string | null, workspace: SharedWorkspaceSnapshot, apply = false, advanceBaseline = apply) {
    if (!advanceBaseline) {
      // The local state changed while this request was in flight. Keep the old
      // common ancestor so the queued retry can perform a correct three-way
      // merge; advancing it here could turn remote additions into deletions.
      setGitHubTeamSync(workspace.sync);
      setGitHubRemoteUpdate(revision ? { revision, sync: workspace.sync } : null);
      return;
    }
    if (apply) {
      dataRef.current = workspace.data;
      ubqSourceRef.current = workspace.ubq ? indexUbqRows(workspace.ubq.filename, workspace.ubq.rows, workspace.data.sourceMeta.UBQ?.updatedAt) : null;
      await applyWorkspaceSnapshot(workspace);
    }
    if (revision) localStorage.setItem(GITHUB_REVISION_KEY, revision); else localStorage.removeItem(GITHUB_REVISION_KEY);
    const when = workspace.sync?.lastSyncedAt || new Date().toISOString();
    localStorage.setItem(GITHUB_SYNCED_AT_KEY, when); setGitHubTeamSync(workspace.sync); setGitHubRemoteUpdate(null); await saveGitHubBaseline(workspace);
  }
  async function saveGitHubMerge(session: GitHubSession, remoteRevision: string, remoteWorkspace: SharedWorkspaceSnapshot, baseline: SharedWorkspaceSnapshot | null, local: SharedWorkspaceSnapshot) {
    const protect = (result: ReturnType<typeof mergeWorkspaceSnapshots>) => {
      const workspace = protectActiveTriage(local, result.workspace, activeTeamMember);
      const restoredActiveWork = JSON.stringify(workspace.data.batches) !== JSON.stringify(result.workspace.data.batches)
        || JSON.stringify(workspace.data.userWorkspaces[activeTeamMember]) !== JSON.stringify(result.workspace.data.userWorkspaces[activeTeamMember]);
      return { ...result, workspace, localChanges: result.localChanges + (restoredActiveWork ? 1 : 0) };
    };
    let revision = remoteRevision; let remote = remoteWorkspace; let merged = protect(mergeWorkspaceSnapshots(baseline, local, remote));
    for (let attempt = 0; attempt < 4; attempt += 1) {
      if (!merged.localChanges) return { revision, workspace: remote, localChanges: 0, remoteChanges: merged.remoteChanges, pushed: false };
      try {
        const saved = await putGitHubWorkspace(session.token, merged.workspace, revision, activeTeamMember || "Shared team", merged.localChanges);
        return { revision: saved.revision, workspace: saved.workspace!, localChanges: merged.localChanges, remoteChanges: merged.remoteChanges, pushed: true };
      } catch (cause) {
        if (!(cause instanceof GitHubWorkspaceError) || cause.status !== 409 || attempt === 3) throw cause;
        const newest = await getGitHubWorkspace(session.token); if (!newest.revision || !newest.workspace) throw cause;
        revision = newest.revision; remote = newest.workspace; merged = protect(mergeWorkspaceSnapshots(baseline, local, remote));
      }
    }
    throw new Error("Team Sync could not settle concurrent updates. Try Sync & Pull again.");
  }
  async function runGitHubLiveSync(reason: "connect" | "poll" | "edit" | "online" | "manual") {
    const session = githubSessionRef.current;
    if (!session || USE_SYNC_SERVICE) throw new Error("Connect Corporate GitHub before syncing.");
    if (!navigator.onLine) throw new Error("Team Sync is paused while this device is offline. It will resume automatically when the connection returns.");
    if (teamSyncPauseRef.current) throw new Error(`Team Sync was paused by ${teamSyncPauseRef.current.pausedBy}. Resume team sync before saving or pulling changes.`);
    if (githubSyncRunningRef.current) { githubSyncQueuedRef.current = true; return "A sync is already running; the newest changes are queued."; }
    githubSyncRunningRef.current = true;
    try {
      const startVersion = githubLocalVersionRef.current;
      const remote = await getGitHubWorkspace(session.token); const local = currentGitHubSnapshot(); let baseline = await loadGitHubBaseline(); const lastRevision = localStorage.getItem(GITHUB_REVISION_KEY);
      if (!remote.revision || !remote.workspace) {
        const saved = await putGitHubWorkspace(session.token, local, null, activeTeamMember || "Shared team", 1);
        await rememberGitHubWorkspace(saved.revision, saved.workspace!, githubLocalVersionRef.current === startVersion);
        return "Created the shared workspace and loaded all local data sources.";
      }
      if (!baseline && lastRevision) baseline = lastRevision === remote.revision ? remote.workspace : await getGitHubWorkspaceAtRevision(session.token, lastRevision);
      if (!baseline) {
        const localData = local.data;
        const hasLocalWork = Boolean(local.ubq || localData.batches.length || localData.ledger.length || localData.historicalMappings.length || localData.manualFpaIds.length || localData.priorityQueue.length || localData.cleanupConfirmations.length || localData.rootBrands.length || localData.acaBrands.length || localData.fpaBrands.length || localData.customBrands.length || Object.keys(localData.learned).length || Object.keys(localData.rootChanges).length);
        if (!hasLocalWork) {
          await rememberGitHubWorkspace(remote.revision, remote.workspace, githubLocalVersionRef.current === startVersion);
          return "Loaded the shared workspace, reference tables, decisions, and team queue.";
        }
        const bootstrapped = await saveGitHubMerge(session, remote.revision, remote.workspace, null, local);
        await rememberGitHubWorkspace(bootstrapped.revision, bootstrapped.workspace, githubLocalVersionRef.current === startVersion);
        return `Connected and merged ${bootstrapped.localChanges} local change${bootstrapped.localChanges === 1 ? "" : "s"} with the team workspace.`;
      }
      const result = await saveGitHubMerge(session, remote.revision, remote.workspace, baseline, local);
      const localClaims = new Map(local.data.priorityQueue.filter((item) => item.assignedTo === activeTeamMember).map((item) => [item.taskKey || priorityTaskKey(item.source, item.brandId, item.name), item]));
      const lostClaims = result.workspace.data.priorityQueue.filter((item) => {
        const before = localClaims.get(item.taskKey || priorityTaskKey(item.source, item.brandId, item.name));
        return before && item.assignedTo && item.assignedTo !== activeTeamMember;
      });
      const remoteChanged = remote.revision !== lastRevision || result.remoteChanges > 0;
      const unchangedSinceStart = githubLocalVersionRef.current === startVersion;
      await rememberGitHubWorkspace(result.revision, result.workspace, (result.pushed || remoteChanged) && unchangedSinceStart, unchangedSinceStart);
      if (lostClaims.length) setToast(`${lostClaims.length} task assignment${lostClaims.length === 1 ? " was" : "s were"} updated by a teammate. The latest owner was kept to prevent duplicate work.`);
      if (result.pushed) return `Saved ${result.localChanges} local change${result.localChanges === 1 ? "" : "s"} and merged the latest team data.`;
      return remoteChanged ? `Pulled ${result.remoteChanges} team change${result.remoteChanges === 1 ? "" : "s"}.` : "Team workspace is up to date.";
    } catch (cause) {
      if (reason === "connect" || reason === "manual" || (cause instanceof GitHubWorkspaceError && cause.status === 401)) {
        setToast(cause instanceof Error ? cause.message : "Team Sync could not reach Corporate GitHub.");
      }
      throw cause;
    } finally {
      githubSyncRunningRef.current = false;
      if (githubSyncQueuedRef.current) {
        githubSyncQueuedRef.current = false;
        if (navigator.onLine && githubSessionRef.current) setTimeout(() => void runGitHubLiveSync("edit").catch(() => undefined), 250);
      }
    }
  }
  githubLiveSyncRef.current = runGitHubLiveSync;

  async function setTeamSyncPaused(paused: boolean) {
    const session = githubSessionRef.current;
    if (!session || USE_SYNC_SERVICE) { navigate("settings"); return; }
    if (!activeTeamMember) { setToast("Choose who is working before pausing or resuming team sync."); return; }
    if (!navigator.onLine) { setToast("Reconnect to the network before changing the team-wide sync status."); return; }
    setSyncBusy(true);
    try {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const remote = await getGitHubWorkspace(session.token);
        if (!remote.revision || !remote.workspace) throw new Error("The shared workspace has not been created yet.");
        const nextPause = paused ? { pausedAt: new Date().toISOString(), pausedBy: activeTeamMember } : undefined;
        const activityType = paused ? "SYNC_PAUSED" : "SYNC_RESUMED";
        const activity = { id: `team:${activityType}:${new Date().toISOString()}:${uid()}`, at: new Date().toISOString(), by: activeTeamMember, type: activityType as "SYNC_PAUSED" | "SYNC_RESUMED", message: `${activeTeamMember} ${paused ? "paused" : "resumed"} Team Sync` };
        const remoteData = remote.workspace.data;
        const workspace: SharedWorkspaceSnapshot = { ...remote.workspace, data: { ...remoteData, teamPresence: { ...(remoteData.teamPresence || {}), [activeTeamMember]: { user: activeTeamMember, area: presenceArea(), lastSeenAt: new Date().toISOString(), deviceId: localProfile?.deviceId } }, teamActivity: [activity, ...(remoteData.teamActivity || [])].slice(0, 250) }, sync: { ...(remote.workspace.sync || { lastSyncedAt: new Date().toISOString(), lastSyncedBy: activeTeamMember, history: [] }), pause: nextPause } };
        try {
          const saved = await putGitHubWorkspace(session.token, workspace, remote.revision, activeTeamMember, 1);
          await rememberGitHubWorkspace(saved.revision, saved.workspace!, false);
          teamSyncPauseRef.current = saved.workspace?.sync?.pause;
          setToast(paused ? `Team Sync paused by ${activeTeamMember}. Everyone will see this status.` : `Team Sync resumed by ${activeTeamMember}. Saving and pulling the latest team changes now.`);
          if (!paused) setTimeout(() => void runGitHubLiveSync("manual").then((message) => { setToast(message); setSavePending(false); }).catch(() => undefined), 150);
          return;
        } catch (cause) {
          if (!(cause instanceof GitHubWorkspaceError) || cause.status !== 409 || attempt === 2) throw cause;
        }
      }
    } catch (cause) {
      setToast(cause instanceof Error ? cause.message : "The team-wide sync status could not be changed.");
    } finally { setSyncBusy(false); }
  }

  async function syncAndPullNow() {
    if (!githubSession || USE_SYNC_SERVICE) { navigate("settings"); return; }
    setSyncBusy(true);
    try {
      if (teamSyncPauseRef.current) {
        const status = await getGitHubWorkspaceStatus(githubSession.token);
        setGitHubTeamSync(status.sync); teamSyncPauseRef.current = status.sync?.pause;
        setToast(status.sync?.pause ? `Team Sync is paused by ${status.sync.pause.pausedBy}. Resume it before saving or pulling.` : "The team pause has ended. Sync & Pull is ready again.");
        return;
      }
      setToast(await runGitHubLiveSync("manual")); setSavePending(false);
    }
    catch { /* runGitHubLiveSync already provides an actionable message. */ }
    finally { setSyncBusy(false); }
  }

  async function prepareProtectedExport(onProgress?: (step: "local" | "team") => void) {
    // A network save must never prevent a locally validated CSV from downloading.
    // The export itself is deterministic from the current reviewed batch. Team state
    // is saved separately and can be retried without asking the reviewer to redo work.
    onProgress?.("local");
    saveData(dataRef.current);
    await new Promise<void>((resolve) => setTimeout(resolve, 120));
    if (workspaceMode === "offline" && !teamConnected) {
      setSavePending(false);
      return true;
    }
    if (!teamConnected || !navigator.onLine || teamSyncPauseRef.current) {
      setSavePending(true);
      return false;
    }
    onProgress?.("team");
    setSyncBusy(true);
    try {
      if (USE_SYNC_SERVICE) {
        await saveTeamSnapshot(currentGitHubSnapshot());
        setToast("Completed batch saved to the team workspace.");
      } else {
        setToast(await runGitHubLiveSync("manual"));
      }
      setSavePending(false);
      return true;
    } catch {
      setSavePending(true);
      setToast("Saved on this device. The team workspace save is still pending—retry when the connection is available.");
      return false;
    } finally { setSyncBusy(false); }
  }

  function saveLocalProfile(username: string) {
    const normalized = normalizeLocalUsername(username);
    if (!validLocalUsername(normalized) || teamConnected) return;
    const next: LocalProfile = { username: normalized, deviceId: localProfile?.deviceId || createDeviceId(), createdAt: localProfile?.createdAt || new Date().toISOString() };
    const previous = localProfile ? localProfileIdentity(localProfile) : "Local user";
    localStorage.setItem(LOCAL_PROFILE_KEY, JSON.stringify(next));
    setData((prev) => migrateAppIdentity(prev, [previous, localProfile?.username || "", "Local user", "You"], localProfileIdentity(next)));
    setLocalProfile(next); setProfileOpen(false); setToast(`Local profile saved as @${normalized}`);
  }

  function navigate(next: View) {
    if (next === "review" && current?.id === syncProtectionReleasedBatchId) setSyncProtectionReleasedBatchId(null);
    const preserveFocus = next === "review" && view === "review";
    if (!preserveFocus) setReviewFocusIds([]);
    setView(next); setSidebar(false); setSelected(null);
  }
  function showCompletedBrandNotice(details: CompletedBrandDetail[]) {
    localStorage.setItem(COMPLETED_BRAND_NOTICE_KEY, JSON.stringify(details));
    setCompletedBrandNotice(details);
  }
  function confirmCompletedBrandNotice() {
    localStorage.removeItem(COMPLETED_BRAND_NOTICE_KEY);
    setCompletedBrandNotice(null);
  }
  function loadUbqSource(filename: string, rows: ParsedRow[]) {
    const verifiedAt = new Date().toISOString();
    const source = indexUbqRows(filename, rows, verifiedAt);
    const resolveRecord = (record: BrandRecord) => resolveRecordWithUbq(record, source);
    const unresolved = data.batches.flatMap((batch) => batch.records).filter((record) => !record.ubqVerified);
    const resolved = unresolved.filter((record) => resolveRecord(record) !== record).length;
    ubqSourceRef.current = source;
    setUbqSource(source);
    void saveUbqReference(filename, rows);
    setData((prev) => {
      const priorityQueue = reconcilePriorityQueueWithUbq(prev.priorityQueue, new Set(source.byId.keys()), `UBQ import · ${filename}`, verifiedAt, new Set(source.byName.keys()));
      const seededRuns = backfillAdminRuns(prev.adminUpdateRuns, prev.priorityQueue, prev.rootChanges);
      const adminUpdateRuns = reconcileAdminRuns(seededRuns, { source: "UBQ", filename, importedAt: verifiedAt, ubqIds: new Set(source.byId.keys()), rootBrands: prev.rootBrands });
      const learned = { ...prev.learned };
      priorityQueue.forEach((item) => {
        if (item.externalStatus !== "VERIFIED" || !item.finalAction) return;
        learned[item.name.trim().toLowerCase()] = { action: item.finalAction, targetId: item.finalTargetId, targetName: item.finalTargetName, reason: item.finalReason || "Verified by the latest UBQ export", reviewedAt: item.completedAt || verifiedAt, origin: "manual", verification: "ADMIN_VERIFIED", verifiedAt: item.verifiedAt || verifiedAt };
      });
      adminUpdateRuns.flatMap((run) => run.items).forEach((item) => {
        if (item.status !== "VERIFIED") return;
        learned[normalizeBrand(item.originalName).toLowerCase()] = { action: item.action, targetId: item.actualTargetId || item.targetId, targetName: item.actualTargetName || item.targetName, reason: item.detail, reviewedAt: item.lastCheckedAt || verifiedAt, origin: "manual", verification: "ADMIN_VERIFIED", verifiedAt: item.lastCheckedAt || verifiedAt };
      });
      return { ...prev, learned, priorityQueue, adminUpdateRuns, batches: resolved ? prev.batches.map((batch) => ({ ...batch, records: batch.records.map(resolveRecord) })) : prev.batches, sourceMeta: { ...prev.sourceMeta, UBQ: { filename, updatedAt: verifiedAt, rowCount: rows.length, fingerprint: sourceFingerprint(rows) } } };
    });
    setSourceVerification({ source: "UBQ", filename, importedAt: verifiedAt, rowCount: rows.length });
    markPriorityPending();
    setToast(`${rows.length.toLocaleString()} UBQ records indexed${resolved ? ` · ${resolved} missing ID${resolved === 1 ? "" : "s"} fixed` : ""}`);
  }
  function importRows(filename: string, rows: ReturnType<typeof parseCsv>, priorityItems: PriorityQueueItem[] = [], preflightConfirmed = false, reviewAgainKeys = new Set<string>()) {
    if (!rows.length) { setToast("No valid brand rows found"); return; }
    if (workflowView === "clean" && rows.length > MAX_WORKLIST_SIZE) { setToast(`Choose no more than ${MAX_WORKLIST_SIZE} brands in Clean View, or switch to Advanced View.`); return; }
    if (!queueUser) { setToast("Choose who is working before starting validation"); return; }
    const openBatch = activeTriageForUser(dataRef.current, queueUser);
    if (openBatch) {
      setView(resolveWorkflowCheckpoint(undefined, openBatch) || "review");
      setToast(`Finish the current ${openBatch.records.filter(isActiveTriageRecord).length}-brand run before starting another.`);
      return;
    }
    const activeCurrentUbq = activeUbqSource(ubqSourceRef.current, dataRef.current);
    const currentUbq = manualFpaIdSource(ubqSourceRef.current, dataRef.current);
    let repeatSummary = "";
    let intakeDecisions: ImportIntakeDecision[] = rows.map((row) => ({ id: row.id, brand: row.name, outcome: "IMPORTED", reason: "New brand — ready to import" }));
    if (!priorityItems.length) {
      const now = new Date().toISOString();
      const queueByKey = new Map(normalizePriorityQueueItems(dataRef.current.priorityQueue).map((item) => [item.taskKey || priorityTaskKey(item.source, item.brandId, item.name), item]));
      intakeDecisions = planImportIntake(dataRef.current, rows, queueUser, ubqSourceRef.current, reviewAgainKeys);
      const notImported = intakeDecisions.filter((item) => item.outcome === "NOT_IMPORTED");
      if (notImported.length && !preflightConfirmed) {
        const preflight = { filename, rows, decisions: intakeDecisions };
        localStorage.setItem(IMPORT_PREFLIGHT_KEY, JSON.stringify(preflight));
        setImportPreflight(preflight);
        return;
      }
      const accepted = rows.filter((_, index) => intakeDecisions[index]?.outcome === "IMPORTED");
      if (!accepted.length) {
        localStorage.removeItem(IMPORT_PREFLIGHT_KEY);
        setImportPreflight(null);
        setToast("No brands were imported. Every submitted brand is already protected by team history or active work.");
        return;
      }
      accepted.forEach((row) => {
        const source: PriorityQueueSource = row.id.startsWith("draft_brand_") ? "UBQ" : "CSV";
        const taskKey = priorityTaskKey(source, row.id, row.name);
        const existing = queueByKey.get(taskKey);
        const reviewAgain = reviewAgainKeys.has(intakeDecisionKey(row));
        const workAt = existing?.verifiedAt || existing?.exportedAt || existing?.resolvedWithoutMappingAt || existing?.completedAt;
        const returnedInUbq = isPresentInCurrentUbq(activeCurrentUbq, row) && Boolean(existing) && ubqSnapshotCovers(activeCurrentUbq, workAt) && priorityImportDisposition(existing, queueUser) !== "AVAILABLE";
        const missingCompletionTimestamp = Boolean(existing) && !workAt && ["READY_FOR_EXPORT", "AWAITING_VERIFICATION", "VERIFIED_COMPLETE", "RESOLVED_WITHOUT_MAPPING"].includes(priorityImportDisposition(existing, queueUser));
        const item: PriorityQueueItem = existing ? reviewAgain || returnedInUbq || missingCompletionTimestamp ? {
          ...existing,
          status: "ASSIGNED",
          externalStatus: "NOT_STARTED",
          assignedTo: queueUser,
          assignedAt: now,
          completedAt: undefined,
          finalAction: undefined,
          finalTargetId: undefined,
          finalTargetName: undefined,
          finalReason: undefined,
          exportedAt: undefined,
          exportedBy: undefined,
          exportFilename: undefined,
          verifiedAt: undefined,
          verifiedBy: undefined,
          resolvedWithoutMappingAt: undefined,
          resolvedWithoutMappingBy: undefined,
          triageResolution: undefined,
          triageResolutionNote: undefined,
          updatedAt: now,
          activity: [queueActivity("REOPENED", reviewAgain ? `${queueUser} explicitly selected Review again` : returnedInUbq ? "Returned in the current UBQ and reopened automatically" : "Reopened because no reliable completion timestamp was recorded", now, queueUser), ...(existing.activity || [])].slice(0, 30),
        } : { ...existing, assignedTo: queueUser, assignedAt: existing.assignedAt || now, status: existing.status === "UNASSIGNED" ? "ASSIGNED" : existing.status, updatedAt: now } : {
          id: `priority:${encodeURIComponent(taskKey)}`, taskKey, brandId: row.id, name: row.name, source, listingCount: row.listingCount, skuCount: row.skuCount,
          status: "ASSIGNED", externalStatus: "NOT_STARTED", assignedTo: queueUser, assignedAt: now, createdAt: now, createdBy: queueUser, updatedAt: now,
          activity: [queueActivity("ASSIGNED", `Added and assigned to ${queueUser}`, now, queueUser)],
        };
        queueByKey.set(taskKey, item); priorityItems.push(item);
      });
      rows = accepted;
      repeatSummary = notImported.length ? `${notImported.length} not imported (shown in the Step 2 intake summary)` : "";
      setData((prev) => ({ ...prev, priorityQueue: normalizePriorityQueueItems([...queueByKey.values()]) }));
      localStorage.removeItem(IMPORT_PREFLIGHT_KEY);
      setImportPreflight(null);
    }
    const base: AppData = dataRef.current;
    const s = base.validationSettings;
    const steps = ["Normalize brand names", s.previousDecisions && "Previous decisions", s.aliasTable && "Alias table", s.rootBrandTable && "Existing brand table", s.acaTable && "ACA brand table", s.fpaTable && "FPA brand table", s.offlineRules && "Offline brand rules"].filter(Boolean) as string[];
    setView("review"); setProcessing({ filename, count: rows.length, steps, current: 0, source: "IMPORT" });
    const advance = (index: number) => {
      if (index < steps.length) { setProcessing({ filename, count: rows.length, steps, current: index, source: "IMPORT" }); setTimeout(() => advance(index + 1), 340); return; }
      const records = rows.map((row) => {
        const byId = currentUbq?.byId.get(row.id);
        const nameMatches = currentUbq?.byName.get(normalizeBrand(row.name).toLowerCase()) || [];
        const source = byId || (nameMatches.length === 1 ? nameMatches[0] : undefined);
        const authoritative = source ? { ...row, ...source } : row;
        const record = classifyBrand(authoritative, base);
        const priorityQueueId = priorityItems.find((item) => item.brandId === row.id || item.name.toLowerCase() === row.name.toLowerCase())?.id;
        if (!currentUbq) return { ...record, ubqVerified: row.id.startsWith("draft_brand_"), priorityQueueId };
        if (source) return { ...record, ubqVerified: true, priorityQueueId };
        return { ...record, ubqVerified: false, priorityQueueId, status: "needs-review" as const, confidence: Math.min(record.confidence, 40), reason: "This brand was not found in the loaded UBQ export", evidence: ["UBQ lookup failed", ...record.evidence] };
      });
      const enriched = currentUbq ? enrichUbqFamilies(records, [...currentUbq.byId.values()], base) : records;
      const batch: ImportBatch = { id: uid(), filename, createdAt: new Date().toISOString(), rows: rows.length, records: enriched.map((record) => ({ ...record, workflowSource: "IMPORT" })), intakeDecisions, workflowSource: "IMPORT", owner: queueUser || undefined };
      setData((prev) => {
        const workspace = prev.userWorkspaces[queueUser] || { pinnedQueueIds: [], uploads: [], updatedAt: batch.createdAt };
        return { ...prev, batches: [batch, ...prev.batches], userWorkspaces: { ...prev.userWorkspaces, [queueUser]: { ...workspace, activeBatchId: batch.id, uploads: [{ id: batch.id, filename, at: batch.createdAt, rows: batch.rows }, ...workspace.uploads].slice(0, 30), updatedAt: batch.createdAt } } };
      }); markPriorityPending(); setProcessing(null); setToast(`${rows.length} brand${rows.length === 1 ? "" : "s"} processed${repeatSummary ? ` · ${repeatSummary}` : ""}`);
    };
    advance(0);
  }
  function startSourceWorklist(source: Exclude<WorkflowSource, "IMPORT">, ids: string[], priorityItems: PriorityQueueItem[] = []) {
    if (!ids.length) { setToast("Select at least one brand to validate"); return; }
    if (workflowView === "clean" && ids.length > MAX_WORKLIST_SIZE) { setToast(`Choose no more than ${MAX_WORKLIST_SIZE} brands in Clean View, or switch to Advanced View.`); return; }
    if (!queueUser) { setToast("Choose who is working before starting validation"); return; }
    const openBatch = activeTriageForUser(dataRef.current, queueUser);
    if (openBatch) {
      setView(resolveWorkflowCheckpoint(undefined, openBatch) || "review");
      setToast(`Finish the current ${openBatch.records.filter(isActiveTriageRecord).length}-brand run before starting another.`);
      return;
    }
    const settings = data.validationSettings;
    const steps = ["Normalize brand names", settings.previousDecisions && "Previous decisions", settings.aliasTable && "Alias table", settings.rootBrandTable && "Existing brand table", settings.acaTable && "ACA brand table", settings.fpaTable && "FPA brand table", settings.offlineRules && "Offline brand rules"].filter(Boolean) as string[];
    const currentUbq = activeUbqSource(ubqSourceRef.current, dataRef.current);
    const rows = source === "UBQ"
      ? ids.map((id) => currentUbq?.byId.get(id)).filter(Boolean) as ParsedRow[]
      : ids.map((id) => data.rootBrands.find((brand) => brand.id === id)).filter(Boolean).map((brand) => ({ id: brand!.id, name: brand!.name }));
    if (!rows.length) { setToast(source === "UBQ" ? "Load a UBQ table in Validation modules first" : "The selected Root records are no longer available"); return; }
    const alreadyCompleted = findCompletedBrandDetailsNotInUbq(dataRef.current, rows, currentUbq);
    if (alreadyCompleted.length) { showCompletedBrandNotice(alreadyCompleted); return; }
    const filename = `${source === "ROOT" ? "Root table cleanup" : "UBQ worklist"} · ${rows.length} brands`;
    setView("review"); setProcessing({ filename, count: rows.length, steps, current: 0, source });
    const advance = (index: number) => {
      if (index < steps.length) { setProcessing({ filename, count: rows.length, steps, current: index, source }); setTimeout(() => advance(index + 1), 300); return; }
      let records: BrandRecord[] = rows.map((row) => {
        const base = source === "ROOT" ? { ...data, rootBrands: data.rootBrands.filter((brand) => brand.id !== row.id), customBrands: data.customBrands.filter((brand) => brand.id !== row.id) } : data;
        const classified = classifyBrand(row, base);
        return { ...classified, id: row.id, workflowSource: source, sourceBrandId: source === "ROOT" ? row.id : undefined, ubqVerified: source === "UBQ", priorityQueueId: priorityItems.find((item) => item.brandId === row.id)?.id, status: "needs-review" as const, evidence: [`${source === "ROOT" ? "Root source BrandID" : "UBQ ID verified"}: ${row.id}`, ...classified.evidence] };
      });
      if (source === "ROOT") records = stabilizeRootConsolidations(records, data.rootBrands);
      if (source === "UBQ" && currentUbq) records = enrichUbqFamilies(records, [...currentUbq.byId.values()], data);
      const batch: ImportBatch = { id: uid(), filename, createdAt: new Date().toISOString(), rows: records.length, records, workflowSource: source, owner: queueUser || undefined };
      setData((prev) => {
        const workspace = prev.userWorkspaces[queueUser] || { pinnedQueueIds: [], uploads: [], updatedAt: batch.createdAt };
        return { ...prev, batches: [batch, ...prev.batches], userWorkspaces: { ...prev.userWorkspaces, [queueUser]: { ...workspace, activeBatchId: batch.id, uploads: [{ id: batch.id, filename, at: batch.createdAt, rows: batch.rows }, ...workspace.uploads].slice(0, 30), updatedAt: batch.createdAt } } };
      }); markPriorityPending(); setProcessing(null); setToast(`${records.length} ${source} brands sent to Process & Review`);
    };
    advance(0);
  }
  function updateRecord(recordId: string, changes: Partial<BrandRecord>, learn = false) {
    const activeBatchId = current?.id;
    const priorityRecord = current?.records.find((record) => record.id === recordId);
    const priorityQueueId = priorityRecord?.priorityQueueId;
    setData((prev) => {
      let changed: BrandRecord | undefined;
      const batches = prev.batches.map((batch) => batch.id !== activeBatchId ? batch : ({ ...batch, records: batch.records.map((record) => {
        if (record.id !== recordId) return record;
        const status = changes.status || "reviewed";
        changed = { ...record, ...changes, decisionSource: changes.decisionSource || "Manual override", reviewer: status === "reviewed" ? currentUser : record.reviewer, reviewedAt: status === "reviewed" ? new Date().toISOString() : record.reviewedAt, status };
        return changed;
      }) }));
      if (!changed) return prev;
      const reviewed = changed as BrandRecord;
      if (reviewed.status !== "reviewed") return { ...prev, batches };
      const entry: LedgerEntry = { ...reviewed, ledgerId: uid(), date: new Date().toISOString() };
      const learned = learn && reviewed.workflowSource !== "ROOT" ? { ...prev.learned, [reviewed.normalized.toLowerCase()]: { action: reviewed.action, targetId: reviewed.targetId, targetName: reviewed.targetName, reason: reviewed.reason, reviewedAt: entry.date, origin: "manual" as const, verification: "HUMAN" as const } } : prev.learned;
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
        const rootChanges: AppData["rootChanges"] = { ...prev.rootChanges, [target.id]: { id: target.id, type: "UPDATE" as const, before: targetBefore, after: targetAfter, changedFields: rootChangedFields(targetBefore, targetAfter), updatedAt: entry.date, status: "PENDING" as const, adminStatus: prev.rootChanges[target.id]?.adminStatus || "RECOMMENDED", adminUpdatedAt: entry.date, adminUpdatedBy: currentUser, verificationNote: `Add aliases learned from UBQ family: ${suggested.join(", ")}` } };
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
      const rootChanges: AppData["rootChanges"] = { ...prev.rootChanges, [sourceId]: { id: sourceId, type: "UPDATE" as const, before: originalRoot, after, changedFields, updatedAt: entry.date, status: "PENDING" as const, adminStatus: "RECOMMENDED" as const, adminUpdatedAt: entry.date, adminUpdatedBy: currentUser } };
      let rootBrands = prev.rootBrands.map((brand) => brand.id === sourceId ? after : brand);
      if (reviewed.action === "MERGE" && targetResolution?.brand && targetResolution.brand.id !== sourceId) {
        const targetCurrent = rootBrands.find((brand) => brand.id === targetResolution.brand!.id)!;
        const targetBefore = prev.rootChanges[targetCurrent.id]?.before || targetCurrent;
        const aliases = [...new Set([...(targetCurrent.aliases || []), originalRoot.name, ...originalRoot.aliases, ...(reviewed.suggestedAliases || [])].map((alias) => alias.trim()).filter((alias) => alias && alias.toLowerCase() !== targetCurrent.name.toLowerCase()))];
        const targetAfter = { ...targetCurrent, aliases, rootSource: targetCurrent.rootSource || "BRANDMASTER" };
        const targetFields = rootChangedFields(targetBefore, targetAfter);
        if (targetFields.length) {
          rootChanges[targetCurrent.id] = { id: targetCurrent.id, type: "UPDATE", before: targetBefore, after: targetAfter, changedFields: targetFields, updatedAt: entry.date, status: "PENDING", adminStatus: prev.rootChanges[targetCurrent.id]?.adminStatus || "RECOMMENDED", adminUpdatedAt: entry.date, adminUpdatedBy: currentUser, verificationNote: `Add aliases from consolidated Root brand ${originalRoot.name}` };
          rootBrands = rootBrands.map((brand) => brand.id === targetCurrent.id ? targetAfter : brand);
        }
      }
      void saveReferenceTable("ROOT", rootBrands);
      return { ...prev, batches, ledger: [entry, ...prev.ledger], learned, rootBrands, rootChanges, sourceMeta: { ...prev.sourceMeta, ROOT: { filename: prev.sourceMeta.ROOT?.filename || "Root table", updatedAt: entry.date } } };
    });
    if (priorityQueueId) setData((prev) => ({ ...prev, priorityQueue: prev.priorityQueue.map((item) => item.id === priorityQueueId ? { ...item, status: priorityRecord?.workflowSource === "ROOT" ? "COMPLETED" : "IN_REVIEW", completedAt: priorityRecord?.workflowSource === "ROOT" ? new Date().toISOString() : undefined, updatedAt: new Date().toISOString() } : item) }));
    setData((prev) => withTeamActivity(prev, "REVIEWED", `${currentUser} reviewed ${priorityRecord?.name || recordId}`, 1, activeBatchId));
    markPriorityPending(); setSelected(null); setToast("Decision saved to the knowledge base");
  }
  function resolveMissingUbqId(recordId: string, row: ParsedRow) {
    const activeBatchId = current?.id;
    const record = current?.records.find((item) => item.id === recordId);
    if (!activeBatchId || !record || !row.id.startsWith("draft_brand_")) return;
    const now = new Date().toISOString();
    setData((prev) => {
      const batches = prev.batches.map((batch) => batch.id !== activeBatchId ? batch : {
        ...batch,
        intakeDecisions: batch.intakeDecisions?.map((item) => item.id === recordId ? { ...item, id: row.id } : item),
        records: batch.records.map((item) => item.id !== recordId ? item : {
          ...item,
          id: row.id,
          listingCount: row.listingCount ?? item.listingCount,
          skuCount: row.skuCount ?? item.skuCount,
          ubqVerified: true,
          reason: item.reason === "This brand was not found in the loaded UBQ export" ? "UBQ ID found; review the current brand decision" : item.reason,
          evidence: [...new Set([`UBQ ID verified: ${row.id}`, ...item.evidence.filter((entry) => entry !== "UBQ lookup failed")])],
        }),
      });
      const priorityQueue = prev.priorityQueue.map((item) => item.id === record.priorityQueueId ? {
        ...item,
        source: "UBQ" as const,
        brandId: row.id,
        name: row.name,
        listingCount: row.listingCount ?? item.listingCount,
        skuCount: row.skuCount ?? item.skuCount,
        updatedAt: now,
        activity: [queueActivity("STATUS", `Missing UBQ ID resolved to ${row.id}`, now), ...(item.activity || [])].slice(0, 30),
      } : item);
      const userWorkspaces = Object.fromEntries(Object.entries(prev.userWorkspaces).map(([owner, workspace]) => [owner, {
        ...workspace,
        reviewFocusIds: workspace.reviewFocusIds?.map((id) => id === recordId ? row.id : id),
      }]));
      return { ...prev, batches, priorityQueue, userWorkspaces };
    });
    setReviewFocusIds((ids) => ids.map((id) => id === recordId ? row.id : id));
    markPriorityPending();
    setToast(`${record.name} matched to ${row.id}`);
  }
  function clearWorkspace() { setData(EMPTY_DATA); setUbqSource(null); void Promise.all([clearReferenceTables(), clearGitHubBaseline()]); localStorage.removeItem("brandmaster-github-revision"); localStorage.removeItem("brandmaster-github-synced-at"); setSelected(null); setToast("Local workspace cleared"); }
  function requestFreshTriage() {
    if (!current) { navigate("imports"); return; }
    setRestartOpen(true);
  }
  async function startFreshTriage() {
    setRestartOpen(false); setSelected(null); setProcessing(null); setResettingTriage(true);
    const activeBatchId = current?.id;
    const now = new Date().toISOString();
    const previous = dataRef.current;
    const workspace = queueUser ? previous.userWorkspaces[queueUser] : undefined;
    const returnedIds = new Set(activeBatch?.records.map((record) => record.priorityQueueId).filter(Boolean) as string[]);
    const priorityQueue = previous.priorityQueue.map((item) => returnedIds.has(item.id) && item.status === "IN_REVIEW" ? { ...item, status: "ASSIGNED" as const, updatedAt: now, activity: [queueActivity("STATUS", "Personal triage restarted; task returned to the assigned team queue", now, queueUser || item.assignedTo || "Team member"), ...(item.activity || [])].slice(0, 30) } : item);
    const cleared = withTeamActivity({ ...previous, priorityQueue, batches: previous.batches.map((batch) => batch.id === activeBatchId ? { ...batch, archivedAt: now, archivedBy: queueUser || currentUser } : batch), userWorkspaces: queueUser && workspace ? { ...previous.userWorkspaces, [queueUser]: { ...workspace, activeBatchId: undefined, updatedAt: now } } : previous.userWorkspaces }, "STATUS", `${currentUser} closed the completed basket and started a new triage`, activeBatch?.records.length || 0, activeBatchId);
    if (activeBatchId) setSyncProtectionReleasedBatchId(activeBatchId);
    dataRef.current = cleared;
    setData(cleared); setSavePending(true);
    try {
      if (teamConnected) {
        const rows = ubqSourceRef.current ? [...ubqSourceRef.current.byId.values()] : [];
        await saveTeamSnapshot({ schemaVersion: "brandmaster.workspace.v1", exportedAt: now, data: cleared, ubq: ubqSourceRef.current ? { filename: ubqSourceRef.current.filename, rows } : null });
        setSavePending(false);
      }
      setToast(teamConnected ? "Previous triage saved to the team workspace — fresh basket ready" : "Fresh personal triage saved on this device");
    } catch (cause) {
      setToast(`${cause instanceof Error ? cause.message : "Team save failed"} Your fresh basket is saved locally; use Save & pull now to retry.`);
    }
    setQuery(""); setView("imports"); setResettingTriage(false);
  }
  function updateValidationSettings(changes: Partial<ValidationSettings>) { setData((prev) => ({ ...prev, validationSettings: { ...prev.validationSettings, ...changes } })); markPriorityPending(); }
  function setReferenceTable(source: "ACA" | "FPA" | "ROOT", brands: CatalogBrand[], filename: string) {
    const key = source === "ACA" ? "acaBrands" : source === "FPA" ? "fpaBrands" : "rootBrands";
    let unlockedFamilies = 0;
    const importedAt = new Date().toISOString();
    setData((prev) => {
      if (source !== "ROOT") return { ...prev, [key]: brands, sourceMeta: { ...prev.sourceMeta, [source]: { filename, updatedAt: importedAt, rowCount: brands.length, fingerprint: sourceFingerprint(brands) } } };
      const { rootBrands, rootChanges } = reconcileRootRecommendations(brands, prev.rootChanges);
      const nextBase = { ...prev, rootBrands, rootChanges };
      const verifiedAt = importedAt;
      const seededRuns = backfillAdminRuns(prev.adminUpdateRuns, prev.priorityQueue, prev.rootChanges);
      const adminUpdateRuns = reconcileAdminRuns(seededRuns, { source: "ROOT", filename, importedAt: verifiedAt, ubqIds: new Set(ubqSource ? [...ubqSource.byId.keys()] : []), rootBrands });
      const priorityQueue = prev.priorityQueue.map((item) => item.source === "ROOT" && rootChanges[item.brandId]?.status === "APPLIED" && item.externalStatus !== "VERIFIED" ? {
        ...item, externalStatus: "VERIFIED" as const, verifiedAt, verifiedBy: `Root import · ${filename}`, updatedAt: verifiedAt,
        activity: [queueActivity("VERIFIED", "Verified by the latest Root-table import", verifiedAt, `Root import · ${filename}`), ...(item.activity || [])].slice(0, 30),
      } : item);
      const allUbqRows = ubqSource ? [...ubqSource.byId.values()] : [];
      const batches = allUbqRows.length ? prev.batches.map((batch) => ({ ...batch, records: batch.records.map((record) => {
        if (!record.relatedUbq?.length || (!record.blockedByTargetCreation && record.decisionSource !== "UBQ family canonical") || record.status === "reviewed") return record;
        const refreshed = enrichUbqFamilies([record], allUbqRows, nextBase)[0];
        if (refreshed.action !== "MERGE" || !refreshed.targetId) return record;
        unlockedFamilies += 1;
        return { ...refreshed, status: "needs-review" as const, confidence: Math.min(refreshed.confidence, 94), reason: `New Root import unlocked this held UBQ family: ${refreshed.reason}`, decisionSource: "Root refresh second pass", blockedByTargetCreation: false, evidence: ["Automatically rechecked after Root table refresh", ...refreshed.evidence] };
      }) })) : prev.batches;
      void saveReferenceTable("ROOT", rootBrands);
      const learned = { ...prev.learned };
      adminUpdateRuns.flatMap((run) => run.items).forEach((item) => {
        if (item.status !== "VERIFIED" || item.source !== "UBQ") return;
        learned[normalizeBrand(item.originalName).toLowerCase()] = { action: item.action, targetId: item.actualTargetId || item.targetId, targetName: item.actualTargetName || item.targetName, reason: item.detail, reviewedAt: item.lastCheckedAt || verifiedAt, origin: "manual", verification: "ADMIN_VERIFIED", verifiedAt: item.lastCheckedAt || verifiedAt };
      });
      return { ...prev, batches, priorityQueue, adminUpdateRuns, learned, rootBrands, rootChanges, sourceMeta: { ...prev.sourceMeta, ROOT: { filename, updatedAt: verifiedAt, rowCount: brands.length, fingerprint: sourceFingerprint(brands) } } };
    });
    if (source !== "ROOT") void saveReferenceTable(source, brands);
    if (source === "ROOT") setSourceVerification({ source, filename, importedAt, rowCount: brands.length });
    markPriorityPending();
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
        if (changedFields.length) rootChanges[brand.id] = { id: brand.id, type: before ? "UPDATE" : "CREATE", before, after: brand, changedFields, updatedAt: new Date().toISOString(), status: "PENDING", adminStatus: existingChange?.adminStatus || "RECOMMENDED", adminUpdatedAt: new Date().toISOString(), adminUpdatedBy: currentUser };
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
      const updatedAt = new Date().toISOString();
      const updatedTask = { ...task, adminStatus, adminUpdatedAt: updatedAt, adminUpdatedBy: currentUser, verificationNote: adminStatus === "REJECTED" ? "Reviewer rejected this recommendation; it will not be exported or reapplied" : task.verificationNote };
      if (adminStatus !== "REJECTED") {
        const existingPending = prev.adminUpdateRuns.some((run) => run.source === "ROOT" && run.items.some((item) => item.sourceId === id && item.status === "AWAITING_NEWER_DATA"));
        const adminUpdateRuns = adminStatus === "COMPLETED" && !existingPending ? [adminRunFromRootChanges(`Root Admin task · ${task.after.name}`, currentUser, [updatedTask], updatedAt), ...prev.adminUpdateRuns] : prev.adminUpdateRuns;
        return { ...prev, adminUpdateRuns, rootChanges: { ...prev.rootChanges, [id]: updatedTask } };
      }
      const rootBrands = task.before
        ? prev.rootBrands.map((brand) => brand.id === id ? task.before! : brand)
        : prev.rootBrands.filter((brand) => brand.id !== id);
      void saveReferenceTable("ROOT", rootBrands);
      return { ...prev, rootBrands, rootChanges: { ...prev.rootChanges, [id]: updatedTask } };
    });
    markPriorityPending();
    setToast(adminStatus === "COMPLETED" ? "Marked completed in Admin — awaiting Root verification" : adminStatus === "REJECTED" ? "Root recommendation rejected" : "Admin task status updated");
  }
  function createWorkspaceSnapshot(): SharedWorkspaceSnapshot {
    const ubqRows = ubqSource ? [...ubqSource.byId.values()] : [];
    return { schemaVersion: "brandmaster.workspace.v1", exportedAt: new Date().toISOString(), data, ubq: ubqSource ? { filename: ubqSource.filename, rows: ubqRows } : null };
  }
  async function applyWorkspaceSnapshot(payload: SharedWorkspaceSnapshot) {
    if (payload.schemaVersion !== "brandmaster.workspace.v1" || !payload.data || !Array.isArray(payload.data.batches)) throw new Error("invalid");
    const restored: AppData = normalizeSharedTaskOwners({ ...EMPTY_DATA, ...payload.data, historicalMappings: payload.data.historicalMappings || [], manualFpaIds: payload.data.manualFpaIds || [], priorityQueue: payload.data.priorityQueue || [], cleanupConfirmations: payload.data.cleanupConfirmations || [], adminUpdateRuns: payload.data.adminUpdateRuns || [], userWorkspaces: payload.data.userWorkspaces || {}, teamPresence: payload.data.teamPresence || {}, teamActivity: payload.data.teamActivity || [], rootChanges: payload.data.rootChanges || {}, sourceMeta: payload.data.sourceMeta || {}, validationSettings: { ...EMPTY_DATA.validationSettings, ...(payload.data.validationSettings || {}) } });
    setData(restored);
    await Promise.all([saveReferenceTable("ROOT", restored.rootBrands || []), saveReferenceTable("ACA", restored.acaBrands || []), saveReferenceTable("FPA", restored.fpaBrands || [])]);
    if (payload.ubq?.filename && Array.isArray(payload.ubq.rows)) {
      await saveUbqReference(payload.ubq.filename, payload.ubq.rows); setUbqSource(indexUbqRows(payload.ubq.filename, payload.ubq.rows, restored.sourceMeta.UBQ?.updatedAt));
    } else setUbqSource(null);
  }
  function downloadWorkspaceBackup() {
    download(workspaceBackupFilename(new Date(), queueUser || "team"), JSON.stringify(createWorkspaceSnapshot(), null, 2), "application/json;charset=utf-8");
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
    markPriorityPending();
    setToast(`${Object.keys(decisions).length.toLocaleString()} decisions updated; matching older decisions replaced`);
  }
  function addHistoricalMappingHistory(entries: HistoricalMappingEntry[], filename: string, mode: HistoricalImportMode, idReferences: ManualFpaIdReference[] = []) {
    const now = new Date().toISOString();
    const currentData = dataRef.current;
    const merged = mergeHistoricalMappings(currentData.historicalMappings, entries, mode);
    const mergedIds = mergeManualFpaIds(currentData.manualFpaIds || [], idReferences, mode);
    const completionEntries = entries.filter((entry) => entry.ubq !== true);
    const byId = new Map(completionEntries.filter((entry) => entry.sourceBrandId).map((entry) => [entry.sourceBrandId!, entry]));
    const groupedByName = new Map<string, HistoricalMappingEntry[]>();
    completionEntries.forEach((entry) => {
      const key = entry.normalized.toLowerCase();
      groupedByName.set(key, [...(groupedByName.get(key) || []), entry]);
    });
    const uniqueByName = new Map([...groupedByName.entries()].filter(([, matches]) => matches.length === 1).map(([key, matches]) => [key, matches[0]]));
    const match = (id: string, name: string) => byId.get(id) || uniqueByName.get(normalizeBrand(name).toLowerCase());
    const currentReferences = mergedIds.filter((reference) => reference.ubq === true);
    const currentById = new Map(currentReferences.map((reference) => [reference.sourceBrandId, reference]));
    const referencesByName = new Map<string, ManualFpaIdReference[]>();
    currentReferences.forEach((reference) => {
      const key = reference.normalized.toLowerCase();
      referencesByName.set(key, [...(referencesByName.get(key) || []), reference]);
    });
    const uniqueReferenceByName = new Map([...referencesByName.entries()].filter(([, matches]) => matches.length === 1).map(([key, matches]) => [key, matches[0]]));
    const currentReference = (id: string, name: string) => currentById.get(id) || uniqueReferenceByName.get(normalizeBrand(name).toLowerCase());
    let queueClosed = 0;
    let triageClosed = 0;
    let reopened = 0;
    let idsResolved = 0;
    const priorityQueue = currentData.priorityQueue.map((item) => {
      if (item.source === "ROOT") return item;
      const reference = currentReference(item.brandId, item.name);
      if (reference) {
        const changedId = item.brandId !== reference.sourceBrandId;
        if (changedId) idsResolved += 1;
        if (item.status === "COMPLETED" || item.externalStatus === "VERIFIED") {
          reopened += 1;
          return {
            ...item,
            brandId: reference.sourceBrandId,
            source: "UBQ" as const,
            listingCount: reference.listingCount ?? item.listingCount,
            status: "UNASSIGNED" as const,
            assignedTo: undefined,
            assignedAt: undefined,
            completedAt: undefined,
            finalAction: undefined,
            finalTargetId: undefined,
            finalTargetName: undefined,
            finalReason: undefined,
            exportedAt: undefined,
            exportedBy: undefined,
            exportFilename: undefined,
            externalStatus: "NOT_STARTED" as const,
            verifiedAt: undefined,
            verifiedBy: undefined,
            resolvedWithoutMappingAt: undefined,
            resolvedWithoutMappingBy: undefined,
            triageResolution: undefined,
            triageResolutionNote: undefined,
            updatedAt: now,
            activity: [queueActivity("REOPENED", `Manual FPA says this brand is still in UBQ · ${filename}`, now), ...(item.activity || [])].slice(0, 30),
          };
        }
        return { ...item, brandId: reference.sourceBrandId, source: "UBQ" as const, listingCount: reference.listingCount ?? item.listingCount, updatedAt: now };
      }
      if (item.status === "COMPLETED") return item;
      const entry = match(item.brandId, item.name);
      if (!entry) return item;
      queueClosed += 1;
      return {
        ...item,
        status: "COMPLETED" as const,
        assignedTo: entry.reviewer || item.assignedTo,
        completedAt: entry.date,
        finalAction: entry.action,
        finalTargetId: entry.targetBrandId,
        finalTargetName: entry.targetBrandName,
        finalReason: `Reconciled from ${filename}${entry.sourceRow ? ` row ${entry.sourceRow}` : ""}`,
        listingCount: entry.listingCount ?? item.listingCount,
        externalStatus: "DONE_PENDING_VERIFICATION" as const,
        updatedAt: now,
        activity: [{
          id: `status:${now}:${entry.id}`,
          type: "STATUS" as const,
          at: now,
          by: entry.reviewer || queueUser || "Shared team",
          message: `Completed offline · ${entry.originalAction} · reconciled from ${filename}`,
        }, ...(item.activity || [])].slice(0, 30),
      };
    });
    const batches = currentData.batches.map((batch) => batch.workflowSource === "ROOT" ? batch : {
      ...batch,
      records: batch.records.map((record) => {
        const reference = currentReference(record.id, record.name);
        if (reference && (!batch.archivedAt || record.triageResolution === "ALREADY_DONE")) {
          const changedId = record.id !== reference.sourceBrandId;
          if (changedId) idsResolved += 1;
          if (record.triageResolution === "ALREADY_DONE") reopened += 1;
          return {
            ...record,
            id: reference.sourceBrandId,
            listingCount: reference.listingCount ?? record.listingCount,
            ubqVerified: true,
            status: "needs-review" as const,
            reason: "Still present in the Manual FPA UBQ reference — review required",
            evidence: [...new Set([`Manual FPA ID verified: ${reference.sourceBrandId}`, ...record.evidence.filter((item) => item !== "UBQ lookup failed")])],
            excludedFromExport: false,
            triageResolution: undefined,
            triageResolutionNote: undefined,
            triageResolvedAt: undefined,
            triageResolvedBy: undefined,
          };
        }
        if (!isActiveTriageRecord(record)) return record;
        const entry = match(record.id, record.name);
        if (!entry) return record;
        triageClosed += 1;
        return {
          ...record,
          action: entry.action,
          targetId: entry.targetBrandId,
          targetName: entry.targetBrandName || (entry.action === "CREATE" ? entry.normalized : undefined),
          listingCount: entry.listingCount ?? record.listingCount,
          status: "reviewed" as const,
          reviewer: entry.reviewer || "Offline team",
          reviewedAt: entry.date,
          reason: `Completed offline and reconciled from ${filename}`,
          excludedFromExport: true,
          triageResolution: "ALREADY_DONE" as const,
          triageResolutionNote: `${entry.originalAction}${entry.sourceRow ? ` · source row ${entry.sourceRow}` : ""}`,
          triageResolvedAt: entry.date,
          triageResolvedBy: entry.reviewer || "Offline team",
        };
      }),
    });
    let next: AppData = {
      ...currentData,
      historicalMappings: merged.entries,
      manualFpaIds: mergedIds,
      priorityQueue,
      batches,
      sourceMeta: {
        ...currentData.sourceMeta,
        HISTORICAL: { filename, updatedAt: now, rowCount: Math.max(entries.length, idReferences.length) },
        ...(idReferences.length ? { MANUAL_FPA: { filename, updatedAt: now, rowCount: idReferences.filter((reference) => reference.ubq === true).length } } : {}),
      },
    };
    if (queueClosed || triageClosed) {
      next = {
        ...next,
        teamActivity: [{
          id: `team:STATUS:${now}:${uid()}`,
          at: now,
          by: queueUser || "Shared team",
          type: "STATUS" as const,
          message: `Reconciled ${queueClosed + triageClosed} active item${queueClosed + triageClosed === 1 ? "" : "s"} from ${filename}`,
          count: queueClosed + triageClosed,
        }, ...(next.teamActivity || [])].slice(0, 250),
      };
    }
    next = archiveTerminalTriages(next, now);
    next = {
      ...next,
      batches: next.batches.map((batch) => batch.workflowSource === "ROOT" ? batch : {
        ...batch,
        records: batch.records.map((record) => {
          if (record.status === "reviewed" || !isActiveTriageRecord(record)) return record;
          const revised = classifyBrand({ id: record.id, name: record.name, listingCount: record.listingCount, skuCount: record.skuCount }, next);
          return { ...record, ...revised, workflowSource: record.workflowSource, ubqVerified: record.ubqVerified };
        }),
      }),
    };
    setData(next);
    markPriorityPending();
    setToast(`${entries.length.toLocaleString()} completed actions · ${idReferences.length.toLocaleString()} Manual FPA IDs indexed${reopened ? ` · ${reopened} stale completion${reopened === 1 ? "" : "s"} reopened` : ""}${idsResolved ? ` · ${idsResolved} missing ID${idsResolved === 1 ? "" : "s"} fixed` : ""}${queueClosed || triageClosed ? ` · ${queueClosed + triageClosed} active item${queueClosed + triageClosed === 1 ? "" : "s"} reconciled` : ""}`);
  }
  async function saveTeamSnapshot(snapshot: SharedWorkspaceSnapshot) {
    if (SYNC_SERVICE_URL && serviceSession?.authenticated && serviceSession.user?.login) {
      const revision = localStorage.getItem("brandmaster-service-revision");
      const saved = await pushSharedWorkspace(SYNC_SERVICE_URL, snapshot, revision);
      if (saved.revision) localStorage.setItem("brandmaster-service-revision", saved.revision);
      localStorage.setItem("brandmaster-service-synced-at", saved.updatedAt || new Date().toISOString());
      if (saved.workspace) await saveGitHubBaseline(saved.workspace);
      setGitHubTeamSync(saved.workspace?.sync); setGitHubRemoteUpdate(null);
      return saved;
    }
    if (!githubSession) throw new Error("Team Sync is not connected");
    dataRef.current = snapshot.data;
    return await runGitHubLiveSync("edit");
  }
  function markPriorityPending() {
    setSavePending(true);
  }
  async function saveProcessProgress() {
    saveData(dataRef.current);
    if (teamConnected) {
      await syncAndPullNow();
      return;
    }
    setSavePending(false);
    setToast("Progress and the current step are saved on this device");
  }
  function installReadyUpdate() {
    saveData(dataRef.current);
    localStorage.setItem(ACTIVE_VIEW_KEY, view);
    const next = new URL(location.href);
    next.searchParams.set("updated", Date.now().toString());
    location.assign(next.toString());
  }
  function rememberQueueUndo(message: string) {
    setQueueUndo({ items: data.priorityQueue, message });
  }
  function queueActivity(type: NonNullable<PriorityQueueItem["activity"]>[number]["type"], message: string, at: string, by = queueUser || "Shared team") {
    return { id: `${type.toLowerCase()}:${at}:${Math.random().toString(36).slice(2, 8)}`, type, at, by, message };
  }
  async function autoSyncCleanup(nextData: AppData, message: string) {
    if (!teamConnected) { setToast(`${message} · saved locally; use Team Sync to share it`); return; }
    try {
      const rows = ubqSource ? [...ubqSource.byId.values()] : [];
      const snapshot: SharedWorkspaceSnapshot = { schemaVersion: "brandmaster.workspace.v1", exportedAt: new Date().toISOString(), data: nextData, ubq: ubqSource ? { filename: ubqSource.filename, rows } : null };
      await saveTeamSnapshot(snapshot); setToast(`${message} · shared with the team`);
    } catch (cause) {
      setToast(cause instanceof GitHubWorkspaceError && cause.status === 409 ? `${message} locally. Pull the latest team update, then sync.` : `${message} locally. Open Team Sync to publish it.`);
    }
  }
  function updateCleanupConfirmations(source: CleanupSource, rows: { brandId: string; name: string; fingerprint: string }[], status: "CONFIRMED" | "REOPENED") {
    const now = new Date().toISOString();
    const confirmations = new Map(data.cleanupConfirmations.map((item) => [item.id, item]));
    rows.forEach((row) => {
      const id = `cleanup:${source}:${row.brandId}`;
      const existing = confirmations.get(id);
      confirmations.set(id, status === "CONFIRMED"
        ? { ...existing, id, source, brandId: row.brandId, name: row.name, fingerprint: row.fingerprint, status, confirmedAt: now, confirmedBy: currentUser, reopenedAt: undefined, reopenedBy: undefined }
        : { ...existing!, id, source, brandId: row.brandId, name: row.name, fingerprint: row.fingerprint, status, confirmedAt: existing?.confirmedAt || now, confirmedBy: existing?.confirmedBy || currentUser, reopenedAt: now, reopenedBy: currentUser });
    });
    const next = { ...data, cleanupConfirmations: [...confirmations.values()] };
    setData(next);
    void autoSyncCleanup(next, status === "CONFIRMED" ? `${rows.length} brand${rows.length === 1 ? "" : "s"} confirmed clean` : `${rows.length} brand${rows.length === 1 ? "" : "s"} reopened for cleanup`);
  }
  function addPriorityRows(source: PriorityQueueSource, rows: ReturnType<typeof parseCsv>) {
    if (!rows.length) { setToast("Add at least one brand"); return; }
    if (workflowView === "clean" && rows.length > MAX_WORKLIST_SIZE) {
      setToast(`Add no more than ${MAX_WORKLIST_SIZE} brands in Clean View, or switch to Advanced View.`);
      return;
    }
    const completedRows = findCompletedBrandDetailsNotInUbq(dataRef.current, rows, activeUbqSource(ubqSourceRef.current, dataRef.current));
    if (completedRows.length) { showCompletedBrandNotice(completedRows); return; }
    const now = new Date().toISOString();
    const existing = new Map(normalizePriorityQueueItems(data.priorityQueue).map((item) => [item.taskKey || priorityTaskKey(item.source, item.brandId, item.name), item]));
    let added = 0;
    let alreadyActive = 0;
    let alreadyCompleted = 0;
    rows.forEach((row) => {
      const taskKey = priorityTaskKey(source, row.id, row.name);
      const id = `priority:${encodeURIComponent(taskKey)}`;
      const current = existing.get(taskKey);
      if (current) {
        if (current.status === "COMPLETED" || current.externalStatus === "VERIFIED") alreadyCompleted += 1;
        else alreadyActive += 1;
        existing.set(taskKey, normalizePriorityQueueItems([current, { ...current, id, taskKey, source, brandId: row.id, name: row.name, listingCount: row.listingCount, skuCount: row.skuCount, updatedAt: now }])[0]);
        return;
      }
      added += 1;
      existing.set(taskKey, { id, taskKey, brandId: row.id, name: row.name, source, listingCount: row.listingCount, skuCount: row.skuCount, status: "UNASSIGNED", externalStatus: "NOT_STARTED", createdAt: now, createdBy: currentUser, updatedAt: now, activity: [queueActivity("CREATED", "Added to the High Priority Queue", now, currentUser)] });
    });
    const next = added ? withTeamActivity({ ...data, priorityQueue: normalizePriorityQueueItems([...existing.values()]) }, "QUEUE_ADDED", `${currentUser} added ${added} high-priority brand${added === 1 ? "" : "s"}`, added) : { ...data, priorityQueue: normalizePriorityQueueItems([...existing.values()]) };
    rememberQueueUndo("Queue addition undone");
    setData(next); markPriorityPending();
    setToast(added
      ? `${added} urgent brand${added === 1 ? "" : "s"} added${alreadyActive ? ` · ${alreadyActive} already being worked` : ""}${alreadyCompleted ? ` · ${alreadyCompleted} already completed and protected` : ""}`
      : alreadyCompleted ? `${alreadyCompleted} brand${alreadyCompleted === 1 ? " was" : "s were"} already completed—nothing was reopened or overwritten`
        : `${alreadyActive} brand${alreadyActive === 1 ? " is" : "s are"} already assigned or in progress`);
  }
  function updatePriorityItems(ids: string[], status: PriorityQueueStatus, assignee?: string, force = false) {
    if (status === "ASSIGNED" && assignee === "__UNASSIGNED__") { updatePriorityItems(ids, "UNASSIGNED", undefined, force); return; }
    const now = new Date().toISOString();
    const assignmentOwner = assignee || queueUser;
    if (status === "ASSIGNED" && !assignmentOwner) { setToast("Choose your name before assigning team work"); return; }
    if (status === "ASSIGNED") {
      const selected = dataRef.current.priorityQueue.filter((item) => ids.includes(item.id));
      const completed = selected.filter((item) => item.status === "COMPLETED" || item.externalStatus === "VERIFIED");
      if (completed.length) { setToast(`${completed.length} selected brand${completed.length === 1 ? " is" : "s are"} already completed or verified. Start over explicitly if the source data proves the issue returned.`); return; }
      const ownedByOthers = selected.filter((item) => item.assignedTo && item.assignedTo !== assignmentOwner && item.status !== "UNASSIGNED");
      if (ownedByOthers.length && !force) { setToast(`${ownedByOthers[0].name} is already being worked by ${ownedByOthers[0].assignedTo}. It was not reassigned or overwritten.`); return; }
    }
    rememberQueueUndo("Assignment or status change undone");
    setData((prev) => ({ ...prev, priorityQueue: prev.priorityQueue.map((item) => {
      if (!ids.includes(item.id)) return item;
      const release = status === "UNASSIGNED";
      const message = status === "ASSIGNED" ? `Assigned to ${assignmentOwner}` : status === "UNASSIGNED" ? "Released to the available queue" : status === "IN_REVIEW" ? "Review started" : status === "BLOCKED" ? "Marked blocked" : "Marked ready for export";
      const type = status === "ASSIGNED" ? "ASSIGNED" : status === "COMPLETED" ? "READY" : status === "UNASSIGNED" ? "REOPENED" : "STATUS";
      return { ...item, status, assignedTo: release ? undefined : status === "ASSIGNED" ? assignmentOwner : item.assignedTo || assignmentOwner, assignedAt: release ? undefined : status === "ASSIGNED" ? now : item.assignedAt || now, completedAt: status === "COMPLETED" ? now : undefined, finalAction: status === "ASSIGNED" ? undefined : item.finalAction, finalTargetId: status === "ASSIGNED" ? undefined : item.finalTargetId, finalTargetName: status === "ASSIGNED" ? undefined : item.finalTargetName, finalReason: status === "ASSIGNED" ? undefined : item.finalReason, exportedAt: status === "ASSIGNED" ? undefined : item.exportedAt, exportedBy: status === "ASSIGNED" ? undefined : item.exportedBy, exportFilename: status === "ASSIGNED" ? undefined : item.exportFilename, activity: [queueActivity(type, message, now), ...(item.activity || [])].slice(0, 30), updatedAt: now };
    }) }));
    setData((prev) => withTeamActivity(prev, status === "ASSIGNED" ? "ASSIGNED" : "STATUS", status === "ASSIGNED" ? `${currentUser} assigned ${ids.length} brand${ids.length === 1 ? "" : "s"} to ${assignmentOwner}` : `${currentUser} updated ${ids.length} queue item${ids.length === 1 ? "" : "s"} to ${status.toLowerCase().replace("_", " ")}`, ids.length));
    markPriorityPending();
    setToast(status === "ASSIGNED" ? `${ids.length} brand${ids.length === 1 ? "" : "s"} assigned to ${assignmentOwner}` : "Queue status updated");
  }
  function resetPriorityItems(ids: string[]) {
    const next = { ...data, priorityQueue: resetPriorityQueueItems(data.priorityQueue, ids) };
    rememberQueueUndo("Queue reset undone");
    setData(next); markPriorityPending();
    setToast(`${ids.length} high-priority item${ids.length === 1 ? "" : "s"} reset and available to claim`);
  }
  function removePriorityItems(ids: string[]) {
    const next = { ...data, priorityQueue: removePriorityQueueItems(data.priorityQueue, ids) };
    rememberQueueUndo("Removed queue items restored");
    setData(next); markPriorityPending();
    setToast(`${ids.length} item${ids.length === 1 ? "" : "s"} removed from the high-priority queue`);
  }
  async function startPriorityWorklist(ids: string[]) {
    if (!queueUser) { setToast("Choose your name in the High Priority Queue first"); return; }
    if (workflowView === "clean" && ids.length > MAX_WORKLIST_SIZE) { setToast(`Choose no more than ${MAX_WORKLIST_SIZE} brands in Clean View, or switch to Advanced View.`); return; }
    const latest = dataRef.current;
    const openBatch = activeTriageForUser(latest, queueUser);
    if (openBatch) {
      setView(resolveWorkflowCheckpoint(undefined, openBatch) || "review");
      setToast(`Finish the current ${openBatch.records.filter(isActiveTriageRecord).length}-brand run before claiming more work.`);
      return;
    }
    const conflicts = latest.priorityQueue.filter((item) => ids.includes(item.id) && isActivePriorityTask(item) && item.assignedTo && item.assignedTo !== queueUser && item.status !== "UNASSIGNED");
    if (conflicts.length) { setToast(`${conflicts[0].name} is already assigned to ${conflicts[0].assignedTo}. Choose only available work or your own work.`); return; }
    const items = latest.priorityQueue.filter((item) => ids.includes(item.id) && isActivePriorityTask(item) && (!item.assignedTo || item.assignedTo === queueUser) && item.status !== "COMPLETED");
    if (!items.length) { setToast("Select at least one available brand or one already assigned to you"); return; }
    const unassignedIds = items.filter((item) => !item.assignedTo || item.status === "UNASSIGNED").map((item) => item.id);
    if (unassignedIds.length) updatePriorityItems(unassignedIds, "ASSIGNED", queueUser);
    const rootItems = items.filter((item) => item.source === "ROOT");
    const mappingItems = items.filter((item) => item.source !== "ROOT");
    const activeItems = mappingItems.length ? mappingItems : rootItems;
    const deferredItems = items.filter((item) => !activeItems.some((active) => active.id === item.id));
    updatePriorityItems(activeItems.map((item) => item.id), "IN_REVIEW", queueUser);
    if (!mappingItems.length) startSourceWorklist("ROOT", rootItems.map((item) => item.brandId), rootItems);
    else importRows(`High priority · ${queueUser} · ${mappingItems.length} brands`, mappingItems.map((item) => ({ id: item.brandId, name: item.name, listingCount: item.listingCount, skuCount: item.skuCount })), mappingItems);
    if (deferredItems.length) setToast(`${activeItems.length} UBQ brand${activeItems.length === 1 ? "" : "s"} started. ${deferredItems.length} Root cleanup item${deferredItems.length === 1 ? " remains" : "s remain"} assigned to you for the next pass.`);
  }
  function applyAdminUploadResults(batchId: string | undefined, attemptedIds: string[], rows: AdminUploadResultRow[], exportFilename: string, resultFilename: string, moveFailuresToReview: boolean, markNotFoundDone = false) {
    if (!batchId) return;
    const now = new Date().toISOString();
    const owner = queueUser || "Shared team";
    const batchBefore = dataRef.current.batches.find((item) => item.id === batchId);
    const triageFinished = Boolean(batchBefore && !applyAdminUploadResultsToRecords(batchBefore.records, attemptedIds, rows, resultFilename, now, moveFailuresToReview, markNotFoundDone, owner).records.some(isActiveTriageRecord));
    setData((prev) => {
      let successful: BrandRecord[] = [];
      let failed: BrandRecord[] = [];
      let resolved: BrandRecord[] = [];
      const batches = prev.batches.map((item) => {
        if (item.id !== batchId) return item;
        const applied = applyAdminUploadResultsToRecords(item.records, attemptedIds, rows, resultFilename, now, moveFailuresToReview, markNotFoundDone, queueUser || "Shared team");
        successful = applied.successful.filter((record) => item.records.find((before) => before.id === record.id)?.adminUploadStatus !== "SUCCESS");
        failed = applied.failed;
        resolved = applied.resolved;
        const active = applied.records.filter(isActiveTriageRecord);
        const adminSuccessCount = applied.records.filter((record) => record.adminUploadStatus === "SUCCESS").length;
        const adminFailureCount = applied.records.filter((record) => record.adminUploadStatus === "FAILED").length;
        const batchFinished = active.length === 0;
        return { ...item, records: applied.records, adminSuccessCount, adminFailureCount, adminResultFilename: resultFilename, adminCompletedAt: batchFinished ? now : undefined };
      });
      const successQueueIds = successful.map((record) => record.priorityQueueId).filter((id): id is string => Boolean(id));
      const failedQueueIds = new Set(failed.map((record) => record.priorityQueueId).filter((id): id is string => Boolean(id)));
      const resolvedQueueIds = new Set(resolved.map((record) => record.priorityQueueId).filter((id): id is string => Boolean(id)));
      let priorityQueue = completePriorityQueueFromBatch(prev.priorityQueue, successful, now, queueUser || "Shared team");
      priorityQueue = markPriorityQueueExported(priorityQueue, successQueueIds, queueUser || "Shared team", exportFilename, now);
      if (resolvedQueueIds.size) priorityQueue = priorityQueue.map((item) => resolvedQueueIds.has(item.id) ? { ...item, status: "COMPLETED" as const, assignedTo: undefined, assignedAt: undefined, completedAt: now, resolvedWithoutMappingAt: now, resolvedWithoutMappingBy: queueUser || "Shared team", triageResolution: resolved.find((record) => record.priorityQueueId === item.id)?.triageResolution, triageResolutionNote: resolved.find((record) => record.priorityQueueId === item.id)?.triageResolutionNote, updatedAt: now, activity: [queueActivity("VERIFIED", "Closed from Admin result: already completed or no longer in UBQ", now), ...(item.activity || [])].slice(0, 30) } : item);
      if (moveFailuresToReview && failedQueueIds.size) priorityQueue = priorityQueue.map((item) => failedQueueIds.has(item.id) ? { ...item, status: "IN_REVIEW" as const, completedAt: undefined, exportedAt: undefined, exportedBy: undefined, exportFilename: undefined, externalStatus: "NOT_STARTED" as const, updatedAt: now, activity: [queueActivity("REOPENED", `Admin upload failed: ${item.name} returned to Step 2`, now), ...(item.activity || [])].slice(0, 30) } : item);
      const run = successful.length ? adminRunFromRecords(exportFilename, owner, successful, batchId, now) : undefined;
      const adminUpdateRuns = run ? [run, ...prev.adminUpdateRuns] : prev.adminUpdateRuns;
      const workspace = prev.userWorkspaces[owner] || { pinnedQueueIds: [], uploads: [], updatedAt: now };
      const userWorkspaces = run ? { ...prev.userWorkspaces, [owner]: { ...workspace, uploads: [{ id: run.id, filename: resultFilename, at: now, rows: successful.length }, ...(workspace.uploads || [])].slice(0, 30), updatedAt: now } } : prev.userWorkspaces;
      const updated = { ...prev, batches, priorityQueue, adminUpdateRuns, userWorkspaces };
      return triageFinished ? archiveFinishedTriage(updated, batchId, owner, now) : updated;
    });
    markPriorityPending();
    const successfulCount = rows.filter((row) => attemptedIds.includes(row.unmappedBrandId) && row.status === "SUCCESS").length;
    const failedCount = rows.filter((row) => attemptedIds.includes(row.unmappedBrandId) && row.status === "FAILED").length;
    const missingDoneCount = markNotFoundDone ? rows.filter((row) => attemptedIds.includes(row.unmappedBrandId) && row.status === "NOT_FOUND").length : 0;
    const alreadyDoneCount = markNotFoundDone ? rows.filter((row) => attemptedIds.includes(row.unmappedBrandId) && row.status === "ALREADY_EXISTS").length : 0;
    setToast(`${successfulCount} mapped${alreadyDoneCount ? ` · ${alreadyDoneCount} already done` : ""}${missingDoneCount ? ` · ${missingDoneCount} no longer in UBQ` : ""} · ${failedCount} failed${moveFailuresToReview && failedCount ? " · failures returned to Step 2" : ""}`);
    if (triageFinished) {
      setSyncProtectionReleasedBatchId(batchId);
      setReviewFocusIds([]);
      setSelected(null);
      setToast(`Triage finished and cleared · ${successfulCount + alreadyDoneCount + missingDoneCount} completed`);
    }
  }
  function recordRootExport(changes: AppData["rootChanges"][string][], filename: string) {
    if (!changes.length) return;
    const run = adminRunFromRootChanges(filename, queueUser || "Shared team", changes);
    setData((prev) => ({ ...prev, adminUpdateRuns: [run, ...prev.adminUpdateRuns] }));
    markPriorityPending();
  }
  function markPriorityAdminComplete(ids: string[]) {
    const next = { ...data, priorityQueue: markPriorityQueueAdminDone(data.priorityQueue, ids, queueUser || "Shared team") };
    rememberQueueUndo("Admin completion marker undone");
    setData(next); markPriorityPending();
    setToast(`${ids.length} task${ids.length === 1 ? "" : "s"} marked done in Admin; the next UBQ/Root import will verify the change`);
  }
  function returnReconciliationItems(ids: string[], destination: "HIGH_PRIORITY" | "REVIEW") {
    if (destination === "REVIEW" && !queueUser) { setToast("Choose who is working before returning decisions to Step 2"); return; }
    const selectedIds = new Set(ids);
    const now = new Date().toISOString();
    let newBatchId: string | undefined;
    setData((prev) => {
      const selectedItems = prev.adminUpdateRuns.flatMap((run) => run.items).filter((item) => selectedIds.has(item.id));
      const queue = new Map(normalizePriorityQueueItems(prev.priorityQueue).map((item) => [item.taskKey || priorityTaskKey(item.source, item.brandId, item.name), item]));
      const records: BrandRecord[] = selectedItems.map((item) => {
        const source: PriorityQueueSource = item.source;
        const taskKey = priorityTaskKey(source, item.sourceId, item.originalName);
        const existing = queue.get(taskKey);
        const queueItem: PriorityQueueItem = {
          ...(existing || { id: `priority:${encodeURIComponent(taskKey)}`, taskKey, brandId: item.sourceId, name: item.originalName, source, status: "UNASSIGNED", createdAt: now, createdBy: queueUser || currentUser, updatedAt: now }),
          taskKey, status: destination === "REVIEW" ? "IN_REVIEW" : "UNASSIGNED", assignedTo: destination === "REVIEW" ? queueUser : undefined, assignedAt: destination === "REVIEW" ? now : undefined,
          completedAt: undefined, exportedAt: undefined, exportedBy: undefined, exportFilename: undefined, externalStatus: "NOT_STARTED", updatedAt: now,
          activity: [queueActivity("REOPENED", destination === "REVIEW" ? `Returned from source reconciliation to ${queueUser}` : "Returned from source reconciliation to High Priority", now), ...(existing?.activity || [])].slice(0, 30),
        };
        queue.set(taskKey, queueItem);
        const classified = classifyBrand({ id: item.sourceId, name: item.originalName }, prev);
        return { ...classified, id: item.sourceId, name: item.originalName, action: item.action, targetId: item.targetId, targetName: item.targetName, status: "needs-review", workflowSource: item.source === "ROOT" ? "ROOT" : "IMPORT", sourceBrandId: item.source === "ROOT" ? item.sourceId : undefined, priorityQueueId: queueItem.id, confidence: Math.min(classified.confidence, 70), decisionSource: "External reconciliation retry", reason: `${item.status}: ${item.detail}`, evidence: [`Returned from ${item.checkedAgainst || "source report"}`, ...classified.evidence] };
      });
      const adminUpdateRuns = prev.adminUpdateRuns.map((run) => ({ ...run, items: run.items.map((item) => selectedIds.has(item.id) ? { ...item, returnedAt: now, returnedBy: queueUser || currentUser, returnDestination: destination } : item) }));
      if (destination !== "REVIEW" || !records.length) return { ...prev, priorityQueue: normalizePriorityQueueItems([...queue.values()]), adminUpdateRuns };
      newBatchId = uid();
      const batch: ImportBatch = { id: newBatchId, filename: `Reconciliation retry · ${records.length} decisions`, createdAt: now, rows: records.length, records, workflowSource: records.every((record) => record.workflowSource === "ROOT") ? "ROOT" : "IMPORT", owner: queueUser };
      const workspace = prev.userWorkspaces[queueUser] || { pinnedQueueIds: [], uploads: [], updatedAt: now };
      return { ...prev, priorityQueue: normalizePriorityQueueItems([...queue.values()]), adminUpdateRuns, batches: [batch, ...prev.batches], userWorkspaces: { ...prev.userWorkspaces, [queueUser]: { ...workspace, activeBatchId: batch.id, updatedAt: now } } };
    });
    markPriorityPending();
    if (destination === "REVIEW") { setView("review"); setSelected(null); setSidebar(false); setToast(`${ids.length} external-tool issue${ids.length === 1 ? "" : "s"} returned to your Step 2 review`); }
    else setToast(`${ids.length} external-tool issue${ids.length === 1 ? "" : "s"} returned to the shared High Priority Queue`);
    void newBatchId;
  }
  function setRecordExportExcluded(recordId: string, excluded: boolean) {
    setData((prev) => ({ ...prev, batches: prev.batches.map((batch) => batch.id === current?.id ? ({ ...batch, records: batch.records.map((record) => record.id === recordId ? { ...record, excludedFromExport: excluded } : record) }) : batch) }));
    setToast(excluded ? "Brand excluded from this bulk download" : "Brand restored to the bulk download");
  }
  function resolveWithoutMapping(recordIds: string[], resolution: NonNullable<BrandRecord["triageResolution"]>, note?: string) {
    const ids = new Set(recordIds);
    if (!ids.size || !current?.id) return;
    const now = new Date().toISOString();
    const label = resolution === "ALREADY_DONE" ? "Already done" : resolution === "NOT_FOUND_IN_UBQ" ? "Not found in UBQ" : note?.trim() || "Removed for another reason";
    setData((prev) => {
      const batch = prev.batches.find((item) => item.id === current.id);
      const queueIds = new Set(batch?.records.filter((record) => ids.has(record.id)).map((record) => record.priorityQueueId).filter((id): id is string => Boolean(id)) || []);
      const resolvedBy = queueUser || currentUser;
      const batches = prev.batches.map((item) => item.id !== current.id ? item : ({ ...item, records: item.records.map((record) => ids.has(record.id) ? { ...record, excludedFromExport: true, triageResolution: resolution, triageResolutionNote: note?.trim() || undefined, triageResolvedAt: now, triageResolvedBy: resolvedBy, status: "reviewed" as const, reviewer: resolvedBy, reviewedAt: now, reason: `Closed without mapping: ${label}` } : record) }));
      // Keep a shared closure marker instead of deleting the queue task. A deleted
      // array item can be restored by a teammate's older GitHub snapshot; this
      // tombstone wins by updatedAt and remains excluded from active work/counts.
      const priorityQueue = prev.priorityQueue.map((item) => queueIds.has(item.id) ? {
        ...item,
        status: "COMPLETED" as const,
        assignedTo: undefined,
        assignedAt: undefined,
        completedAt: now,
        resolvedWithoutMappingAt: now,
        resolvedWithoutMappingBy: resolvedBy,
        triageResolution: resolution,
        triageResolutionNote: note?.trim() || undefined,
        updatedAt: now,
        activity: [queueActivity("STATUS", `Closed without mapping · ${label}`, now, resolvedBy), ...(item.activity || [])].slice(0, 30),
      } : item);
      return withTeamActivity({ ...prev, batches, priorityQueue }, "STATUS", `${queueUser || currentUser} closed ${ids.size} triage item${ids.size === 1 ? "" : "s"} without mapping · ${label}`, ids.size, current.id);
    });
    markPriorityPending();
    setToast(`${ids.size} item${ids.size === 1 ? "" : "s"} removed from triage and the High Priority Queue`);
  }
  function reopenRecordsForReview(recordIds: string[]) {
    const uniqueIds = [...new Set(recordIds)];
    if (!uniqueIds.length) return;
    const selectedIds = new Set(uniqueIds);
    setData((prev) => {
      const queueIds = new Set(prev.batches.find((batch) => batch.id === current?.id)?.records.filter((record) => selectedIds.has(record.id)).map((record) => record.priorityQueueId).filter((id): id is string => Boolean(id)) || []);
      const now = new Date().toISOString();
      const batches = prev.batches.map((batch) => batch.id === current?.id ? ({ ...batch, adminCompletedAt: undefined, records: batch.records.map((record) => selectedIds.has(record.id) ? { ...record, status: "needs-review" as const, excludedFromExport: false, reason: `Returned from Step 3 for another review: ${record.reason}` } : record) }) : batch);
      const priorityQueue = prev.priorityQueue.map((item) => queueIds.has(item.id) ? { ...item, status: "IN_REVIEW" as const, completedAt: undefined, exportedAt: undefined, exportedBy: undefined, exportFilename: undefined, externalStatus: "NOT_STARTED" as const, updatedAt: now, activity: [queueActivity("REOPENED", "Returned from Step 3 to review the decision again", now), ...(item.activity || [])].slice(0, 30) } : item);
      return { ...prev, batches, priorityQueue };
    });
    setReviewFocusIds(uniqueIds);
    setView("review");
    setSidebar(false);
    setSelected(null);
    setToast(`${uniqueIds.length} brand${uniqueIds.length === 1 ? "" : "s"} returned to a focused Step 2 review`);
  }

  const cleanTriage = workflowView === "clean" && isWorkflowView(view);
  if (!loaded) return <div className="app-loading" role="status" aria-live="polite"><div className="app-loading-mark"><Image unoptimized src={`${APP_BASE_PATH}/brandmaster-logo.jpeg`} width={52} height={52} alt="" /></div><b>Restoring Brandmaster</b><span>Your saved brands and current step are loading…</span></div>;
  return <div className={`app-shell ebay-theme unified-mode ${cleanTriage ? "clean-workflow" : "advanced-workflow"}`}>
    <aside className={`sidebar ${sidebar ? "open" : ""}`}>
      <div className="brand"><div className="brand-mark"><Image unoptimized src={`${APP_BASE_PATH}/brandmaster-logo.jpeg`} width={42} height={42} alt="Brandmaster" /></div><div><b>brandmaster</b><span>Brand validation</span></div><button className="icon-button close-sidebar" onClick={() => setSidebar(false)}><PanelLeftClose size={18} /></button></div>
      <nav>
        {UNIFIED_NAV.map((group) => <div className="nav-group" key={group.section || "workflow"}>{group.section && <label>{group.section}</label>}{group.items.map((item) => <button className={view === item.id ? "active" : ""} onClick={() => navigate(item.id)} key={item.id}><item.icon size={17} /><span>{item.label}</span></button>)}</div>)}
      </nav>
      <div className="sidebar-bottom">
        <button className="user-card" onClick={() => navigate("imports")}><span>{identityInitials}</span><div><b>{identityDisplay}</b><small>{identityVerified ? "Team work profile" : "Select a team member"}</small></div><MoreHorizontal size={17} /></button>
      </div>
    </aside>
    {sidebar && <div className="scrim" onClick={() => setSidebar(false)} />}
    <main>
      <header className="topbar">
        <button className="icon-button menu-button" onClick={() => setSidebar(true)}><Menu size={20} /></button>
        <div className="global-search"><Search size={16} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search brands, IDs, or decisions…" /><kbd>⌘ K</kbd></div>
        <button className={`top-weekly-target ${topWeeklyTarget.completed >= topWeeklyTarget.weeklyTarget ? "achieved" : ""}`} onClick={() => navigate("analytics")} title={`Team: ${topWeeklyTarget.completed.toLocaleString()} of ${topWeeklyTarget.weeklyTarget.toLocaleString()} · ${activeTeamMember || "You"}: ${topPersonalWeeklyTarget.completed.toLocaleString()} this week`}><span>{topWeeklyTarget.completed >= topWeeklyTarget.weeklyTarget ? <Check size={16} /> : <Gauge size={16} />}</span><span><small>TEAM TARGET · YOU {topPersonalWeeklyTarget.completed.toLocaleString()}</small><b>{topWeeklyTarget.completed.toLocaleString()} / {topWeeklyTarget.weeklyTarget.toLocaleString()}</b></span><i><em style={{ width: `${topWeeklyTarget.progressPercent}%` }} /></i>{topWeeklyTarget.completed >= topWeeklyTarget.weeklyTarget && <strong>GOAL</strong>}</button>
        <div className={`network ${online ? "" : "offline"}`}>{online ? <Cloud size={15} /> : <CloudOff size={15} />}{online ? "Online" : "Offline mode"}</div>
        <button className={`top-sync-state ${syncBusy ? "syncing" : teamSyncPause ? "team-paused" : protectedTriage ? "protected" : savePending ? "pending" : githubRemoteUpdate ? "update" : teamConnected ? "connected" : "offline"}`} disabled={syncBusy} onClick={() => void syncAndPullNow()} title={teamSyncPause ? `Team Sync paused by ${teamSyncPause.pausedBy}` : githubSession ? "Save local changes and pull team changes now" : "Connect Team Sync in settings"}>{teamSyncPause ? <Pause size={14} /> : <RefreshCw className={syncBusy ? "spinning" : ""} size={14} />}<span aria-live="polite">{syncBusy ? "Saving & pulling…" : teamSyncPause ? `Paused by ${teamSyncPause.pausedBy}` : savePending ? "Unsaved changes · Save & pull" : githubRemoteUpdate ? "Team update available · Save & pull" : teamConnected ? "Manual sync · Save & pull" : "Connect Team Sync"}</span></button>
        <button className={`workflow-view-toggle ${workflowView === "clean" ? "active" : ""}`} aria-pressed={workflowView === "clean"} onClick={() => setWorkflowView((current) => current === "clean" ? "advanced" : "clean")} title={workflowView === "clean" ? "Turn Clean view off and show every advanced control" : "Turn Clean view on and show only the controls needed for the current step"}><WandSparkles size={15} /><span>Clean view</span><small>{workflowView === "clean" ? "On" : "Off"}</small></button>
        {githubSession && !USE_SYNC_SERVICE && <button className={`team-pause-control ${teamSyncPause ? "resume" : ""}`} disabled={syncBusy || !online} onClick={() => void setTeamSyncPaused(!teamSyncPause)} title={teamSyncPause ? "Resume automatic team saving and pulling" : "Pause automatic saving and pulling for the whole team"}>{teamSyncPause ? <Play size={15} /> : <Pause size={15} />}<span>{teamSyncPause ? "Resume sync" : "Pause sync"}</span></button>}
        <button className="walkthrough-launch" onClick={() => setTourOpen(true)} title="Show the step-by-step walkthrough"><i className="walkthrough-hand" aria-hidden="true">☝️</i><span>Guided help</span></button>
        <button className="icon-button" onClick={() => setDark(!dark)} aria-label="Toggle theme">{dark ? <Sun size={18} /> : <Moon size={18} />}</button>
        <button className="icon-button" onClick={() => githubRemoteUpdate && navigate("settings")} title={githubRemoteUpdate ? "A team workspace update is available" : "No new team updates"}><Bell size={18} />{githubRemoteUpdate && <i className="notification-dot" />}</button>
        <label className={`top-team-select ${identityVerified ? "ready" : ""}`} title={technicalLogin ? `Shared repository connection: ${technicalLogin}` : "Choose who is using Brandmaster"}><span className="avatar">{identityInitials}</span><span><small>WORKING AS</small><select value={activeTeamMember} onChange={(event) => chooseTeamMember(event.target.value)}><option value="" disabled>Choose team member</option>{TEAM_MEMBERS.map((member) => <option key={member} value={member}>{member}</option>)}</select></span></label>
      </header>
      <div className="page">
        {workflowView === "clean" && ["imports", "review", "output"].includes(view) && <div className="clean-view-guide"><button onClick={() => setWorkflowView("advanced")}><Settings size={14} />Advanced view</button></div>}
        {!editingAllowed && view !== "settings" && <div className="team-connection-gate" role="alert"><span><Github size={24} /></span><div><small>TEAM WORKSPACE · READ ONLY</small><h2>Connect Team Sync to make changes</h2><p>Brandmaster has locked imports, assignments, reviews, reference-table changes, and exports so work cannot remain invisible to teammates.</p></div><div><button className="primary" onClick={() => navigate("settings")}><Github size={16} />Connect Corporate GitHub</button><button className="secondary" onClick={() => setWorkspaceMode("offline")}><CloudOff size={16} />Use isolated offline workspace</button></div></div>}
        {workspaceMode === "offline" && !teamConnected && <div className="offline-workspace-banner" role="status"><CloudOff size={19} /><span><b>Isolated offline workspace</b><small>Changes stay only on this device and are not visible to the team.</small></span><button onClick={() => { setWorkspaceMode("team"); navigate("settings"); }}>Return to Team Workspace</button></div>}
        {teamConnected && <details className="team-collaboration-banner"><summary><span className="team-live-icon"><Users size={19} /></span><span><b>{activeTeammates.length ? `${activeTeammates.length} teammate${activeTeammates.length === 1 ? "" : "s"} active` : "Team workspace connected"}</b><small>{activeTeammates.length ? activeTeammates.map((entry) => `${entry.user} · ${entry.area.replace("STEP_", "Step ").toLowerCase().replace(/^./, (letter) => letter.toUpperCase())}`).join("   •   ") : "Activity appears here as teammates work"}</small></span>{recentTeamActivity[0] && <em>{recentTeamActivity[0].message}</em>}<ChevronDown size={17} /></summary><div className="team-collaboration-details"><div><h3>Who is working</h3>{activeTeammates.length ? activeTeammates.map((entry) => <p key={entry.user}><span>{entry.user.slice(0, 2).toUpperCase()}</span><b>{entry.user}</b><small>{entry.area.replace("STEP_", "Step ").replace("ADMIN", "Admin tools")} · seen {fmtTime(entry.lastSeenAt)}</small></p>) : <p className="team-empty">No teammate has synced activity in the last 6 minutes.</p>}</div><div><h3>Recent team activity</h3>{recentTeamActivity.length ? recentTeamActivity.map((entry) => <p key={entry.id}><Activity size={15} /><b>{entry.message}</b><small>{fmtDate(entry.at)} at {fmtTime(entry.at)}</small></p>) : <p className="team-empty">No shared activity has been recorded yet.</p>}</div></div></details>}
        {teamSyncPause && <div className="team-sync-paused-banner" role="alert"><span><Pause size={23} /></span><div><b>Team Sync is paused by {teamSyncPause.pausedBy}</b><p>Manual saving and pulling is paused for everyone since {fmtDate(teamSyncPause.pausedAt)} at {fmtTime(teamSyncPause.pausedAt)}. Your local work stays on this device until the team resumes.</p></div><button className="primary" disabled={syncBusy || !online} onClick={() => void setTeamSyncPaused(false)}><Play size={15} />Resume team sync</button></div>}
        {protectedTriage && <div className="protected-triage-banner" role="status"><span><ShieldCheck size={22} /></span><div><b>Manual sync while triaging</b><p>There is no background refresh. Your Step {view === "review" ? "2 decisions" : "3 download"} stays here until you click Save &amp; pull.</p></div><strong>{savePending ? "Changes need saving" : githubRemoteUpdate ? "Team update available" : "Manual only"}</strong></div>}
        {githubRemoteUpdate && view !== "settings" && <button className="global-sync-notice" onClick={() => navigate("settings")}><Bell size={16} /><span><b>New Brandmaster team update</b><small>{githubRemoteUpdate.sync?.lastSyncedBy ? `@${githubRemoteUpdate.sync.lastSyncedBy} saved a newer workspace.` : "A collaborator saved a newer workspace."} Pull and merge it safely.</small></span><ChevronRight size={17} /></button>}
        {appUpdateReady && <section className="app-update-ready" role="alert"><span><RefreshCw size={20} /></span><div><small>NEW BRANDMASTER VERSION READY</small><b>Update without losing this triage</b><p>Your current step and decisions are saved locally. Update now to load the latest workflow and display fixes.</p></div><button className="primary" onClick={installReadyUpdate}><RefreshCw size={15} />Save and update now</button></section>}
        {cleanTriage && <CleanWorkflowHeader view={view as "imports" | "review" | "output"} batch={current} owner={current?.owner || currentUser} checkpointAt={queueUser ? data.userWorkspaces[queueUser]?.checkpointAt : undefined} savePending={savePending} saveBusy={syncBusy} connected={teamConnected || workspaceMode === "offline"} onNavigate={navigate} onSave={() => void saveProcessProgress()} onRestart={requestFreshTriage} />}
        <fieldset className="workspace-stage" disabled={!editingAllowed && view !== "settings"} aria-label={!editingAllowed ? "Workspace editing is locked until Team Sync connects" : undefined}>
        {view === "dashboard" && <Dashboard data={data} records={activeUserRecords} avg={avg} pending={pending.length} currentUser={queueUser} displayName={identityDisplay} simpleMode onNavigate={navigate} onImport={importRows} />}
        {view === "imports" && <Imports cleanMode={workflowView === "clean"} batches={data.batches} activeBatchId={queueUser ? data.userWorkspaces[queueUser]?.activeBatchId : undefined} priorityQueue={data.priorityQueue} currentUser={queueUser} pinnedQueueIds={queueUser ? data.userWorkspaces[queueUser]?.pinnedQueueIds || [] : []} teamMembers={[...TEAM_MEMBERS]} onChooseTeamMember={chooseTeamMember} onTogglePin={togglePinnedTask} syncConnected={teamConnected} savePending={savePending} saveBusy={syncBusy} saveCountdown={0} lastSavedAt={githubTeamSync?.lastSyncedAt} onSave={() => void syncAndPullNow()} onImport={importRows} onAddPriority={addPriorityRows} onUpdatePriority={updatePriorityItems} onResetPriority={resetPriorityItems} onRemovePriority={removePriorityItems} onAdminDone={markPriorityAdminComplete} onStartPriority={startPriorityWorklist} onNavigate={navigate} onRestart={requestFreshTriage} ubqSource={workflowUbqSource} />}
        {view === "review" && (processing ? <ProcessingView run={processing} /> : <ReviewQueue cleanMode={workflowView === "clean"} records={(current?.records || []).filter((record) => record.adminUploadStatus !== "SUCCESS")} batch={current} brands={catalogBrands} ubqRows={workflowUbqSource ? [...workflowUbqSource.byId.values()] : []} knownBrandIds={knownBrandIds} focusIds={reviewFocusIds} onClearFocus={() => setReviewFocusIds([])} onUpdate={updateRecord} onResolveUbqId={resolveMissingUbqId} onResolveWithoutMapping={resolveWithoutMapping} onSelect={setSelected} query={query} onNavigate={navigate} onRestart={requestFreshTriage} />)}
        {view === "output" && <BulkOutput cleanMode={workflowView === "clean"} records={current?.records || []} batch={current} data={data} currentUser={queueUser || "team"} onUpdate={updateRecord} onSetExcluded={setRecordExportExcluded} onReopen={reopenRecordsForReview} onApplyAdminUploadResults={applyAdminUploadResults} onRecordRootExport={recordRootExport} onBeforeExport={prepareProtectedExport} onNavigate={navigate} onRestart={requestFreshTriage} />}
        {view === "cleanup" && <SmartCleanup data={data} ubqSource={currentUbqSource} onSaveRoot={saveCatalogBrand} onValidate={startSourceWorklist} onAddPriority={addPriorityRows} onSetConfirmation={updateCleanupConfirmations} onNavigate={navigate} />}
        {view === "quality" && <DataQualityAnalytics data={data} ubqSource={currentUbqSource} onAddPriority={addPriorityRows} onNavigate={navigate} />}
        {view === "brands" && <BrandDatabase data={data} ubqSource={currentUbqSource} query={query} onSave={saveCatalogBrand} onUndoRootChange={undoRootChange} onUpdateRootTask={updateRootTaskAdminStatus} onValidate={startSourceWorklist} onAddPriority={addPriorityRows} />}
        {view === "aliases" && <Aliases data={data} onSave={saveCatalogBrand} />}
        {view === "ledger" && <Ledger entries={data.ledger} records={allRecords} />}
        {view === "analytics" && <Analytics records={allRecords} ledger={data.ledger} historicalMappings={data.historicalMappings} priorityQueue={data.priorityQueue} completionActivity={teamWeeklyCompletionActivity} currentUser={queueUser || "team"} />}
        {view === "artifacts" && <ArtifactsView data={{ ...data, batches: userBatches }} onNavigate={navigate} />}
        {view === "settings" && <SettingsView editingAllowed={editingAllowed} data={data} currentUser={queueUser || "team"} ubqSource={ubqSource} onLoadUbq={loadUbqSource} onReturnReconciliation={returnReconciliationItems} onClear={clearWorkspace} onUpdateSettings={updateValidationSettings} onSetReference={setReferenceTable} onAddDecisions={addDecisionHistory} onAddHistoricalMappings={addHistoricalMappingHistory} onBackup={downloadWorkspaceBackup} onRestore={restoreWorkspaceBackup} createSnapshot={createWorkspaceSnapshot} applySnapshot={applyWorkspaceSnapshot} githubSession={githubSession} onGitHubSession={setGitHubSession} onGitHubSync={() => runGitHubLiveSync("manual")} online={online} serviceSession={serviceSession} onServiceSession={setServiceSession} githubRemoteUpdate={githubRemoteUpdate} onGitHubRemoteUpdate={setGitHubRemoteUpdate} githubTeamSync={githubTeamSync} onGitHubTeamSync={setGitHubTeamSync} />}
        </fieldset>
      </div>
    </main>
    {tourOpen && <GuidedWalkthrough view={view} hasTeamWork={data.priorityQueue.some((item) => isActivePriorityTask(item) && item.status !== "COMPLETED")} onNavigate={navigate} onClose={closeWalkthrough} />}
    {selected && <DecisionDrawer record={selected} records={current?.records || []} brands={catalogBrands} ubqRows={workflowUbqSource ? [...workflowUbqSource.byId.values()] : []} onClose={() => setSelected(null)} onSave={updateRecord} onApplyRelated={(ids, targetId, targetName) => ids.forEach((id) => updateRecord(id, { action: "MERGE", targetId, targetName, status: "reviewed", confidence: 100, reason: `Confirmed UBQ family merge to ${targetName}`, blockedByTargetCreation: false }, true))} />}
    {restartOpen && <FreshTriageDialog count={(activeBatch?.records || []).filter(isActiveTriageRecord).length} imports={activeBatch ? 1 : 0} onCancel={() => setRestartOpen(false)} onConfirm={startFreshTriage} />}
    {importPreflight && <ImportPreflightDialog decisions={importPreflight.decisions} onCancel={() => { localStorage.removeItem(IMPORT_PREFLIGHT_KEY); setImportPreflight(null); }} onReviewAgain={(keys) => {
      localStorage.removeItem(IMPORT_PREFLIGHT_KEY);
      importRows(importPreflight.filename, importPreflight.rows, [], true, new Set(keys));
    }} onConfirm={() => {
      const accepted = importPreflight.decisions.filter((item) => item.outcome === "IMPORTED").length;
      localStorage.removeItem(IMPORT_PREFLIGHT_KEY);
      if (!accepted) { setImportPreflight(null); setToast("Process ended. No submitted brands were imported."); return; }
      importRows(importPreflight.filename, importPreflight.rows, [], true);
    }} />}
    {completedBrandNotice && <CompletedBrandDialog details={completedBrandNotice} onConfirm={confirmCompletedBrandNotice} />}
    {profileOpen && <IdentityDialog profile={localProfile} githubUser={githubSession?.user || (serviceSession?.authenticated && serviceSession.user ? { login: serviceSession.user.login, name: serviceSession.user.name, avatar_url: serviceSession.user.avatarUrl } : null)} authenticatedIdentity={authenticatedIdentity} onAuthenticatedSignOut={onAuthenticatedSignOut} onSave={saveLocalProfile} onClose={localProfile ? () => setProfileOpen(false) : undefined} onOpenSettings={() => { setProfileOpen(false); navigate("settings"); }} />}
    {sourceVerification && <SourceVerificationDialog summary={summarizeImportedSource(data.adminUpdateRuns, sourceVerification.source, sourceVerification.filename, sourceVerification.importedAt)} rowCount={sourceVerification.rowCount} onClose={() => setSourceVerification(null)} onViewReport={() => { setSourceVerification(null); setView("settings"); setTimeout(() => document.getElementById("source-reconciliation-report")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80); }} />}
    {resettingTriage && <FreshTriageTransition />}
    {toast && <div className="toast"><Check size={16} /><span>{toast}</span>{queueUndo && <button onClick={() => { setData((prev) => ({ ...prev, priorityQueue: queueUndo.items })); markPriorityPending(); setToast(queueUndo.message); setQueueUndo(null); }}>Undo</button>}</div>}
  </div>;
}

function PageHead({ eyebrow, title, body, actions }: { eyebrow?: string; title: string; body: string; actions?: React.ReactNode }) {
  return <div className="page-head"><div>{eyebrow && <span>{eyebrow}</span>}<h1>{title}</h1><p>{body}</p></div>{actions && <div className="page-actions">{actions}</div>}</div>;
}

function IdentityDialog({ profile, githubUser, authenticatedIdentity, onAuthenticatedSignOut, onSave, onClose, onOpenSettings }: { profile: LocalProfile | null; githubUser: GitHubUser | null; authenticatedIdentity?: AuthenticatedBrandmasterUser | null; onAuthenticatedSignOut?: () => Promise<void>; onSave: (username: string) => void; onClose?: () => void; onOpenSettings: () => void }) {
  const [username, setUsername] = useState(profile?.username || "");
  const normalized = normalizeLocalUsername(username);
  const valid = validLocalUsername(normalized);
  const verifiedLogin = authenticatedIdentity?.login || githubUser?.login;
  const initials = (verifiedLogin || normalized || "Local user").split(/[\s._-]+/).filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  return <><div className="identity-scrim" onClick={onClose} /><section className="identity-dialog" role="dialog" aria-modal="true" aria-labelledby="identity-title">
    {onClose && <button className="icon-button identity-close" onClick={onClose} aria-label="Close identity"><X size={17} /></button>}
    <div className={`identity-dialog-mark ${verifiedLogin ? "verified" : ""}`}>{verifiedLogin ? <Github size={25} /> : initials}</div>
    <span>{verifiedLogin ? "VERIFIED IDENTITY" : profile ? "LOCAL PROFILE" : "WELCOME TO BRANDMASTER"}</span>
    <h2 id="identity-title">{verifiedLogin ? `Signed in as @${verifiedLogin}` : profile ? "Your Brandmaster identity" : "Who is doing this work?"}</h2>
    <p>{verifiedLogin ? "Corporate GitHub verified this account. New assignments, reviews, Admin tasks and analytics use this identity." : "Enter your eBay username so assignments and review history show who completed the work. This profile stays in this browser until GitHub verifies you."}</p>
    {verifiedLogin ? <><div className="identity-verified-card"><ShieldCheck size={20} /><span><b>@{verifiedLogin}</b><small>{authenticatedIdentity ? `${authenticatedIdentity.role} access` : "Team Sync access"} · Device {profile?.deviceId || "registered"}</small></span></div>{authenticatedIdentity && onAuthenticatedSignOut && <button className="secondary identity-sign-out" onClick={() => void onAuthenticatedSignOut()}><LogOut size={15} />Sign out of Brandmaster</button>}</> : <form onSubmit={(event) => { event.preventDefault(); if (valid) onSave(normalized); }}><label><span>eBay username</span><div><b>@</b><input autoFocus value={username} onChange={(event) => setUsername(event.target.value)} placeholder="bmeshesha" autoComplete="username" spellCheck={false} /></div><small className={username && !valid ? "invalid" : ""}>{username && !valid ? "Use 2–40 letters, numbers, dots, underscores, or hyphens." : "Use the same username teammates recognize."}</small></label><div className="identity-device"><ShieldCheck size={15} /><span><b>Private device code</b><small>{profile?.deviceId || "Created when you continue"} · helps distinguish browser profiles</small></span></div><button className="primary" disabled={!valid} type="submit">{profile ? "Save local profile" : "Continue to Brandmaster"}<ChevronRight size={15} /></button></form>}
    {(verifiedLogin || profile) && <div className="identity-dialog-footer"><span>{verifiedLogin ? "Team data and shared sources" : "Want a verified identity and collaboration?"}</span><button className="text-button" onClick={onOpenSettings}>Open Team Sync →</button></div>}
  </section></>;
}

function FreshTriageDialog({ count, imports, onCancel, onConfirm }: { count: number; imports: number; onCancel: () => void; onConfirm: () => void }) {
  return <><div className="fresh-dialog-scrim" onClick={onCancel} /><section className="fresh-dialog" role="dialog" aria-modal="true" aria-labelledby="fresh-triage-title"><div className="fresh-dialog-icon"><RotateCcw size={25} /></div><span>START A CLEAN TRIAGE</span><h2 id="fresh-triage-title">Restart at Step 1?</h2><p>This removes the current {imports} import{imports === 1 ? "" : "s"} and {count.toLocaleString()} Process & Review row{count === 1 ? "" : "s"} so old work cannot linger in the next triage.</p><div className="fresh-preserved"><ShieldCheck size={17} /><div><b>Your team queue and validation knowledge stay safe</b><small>High-priority assignments, UBQ, Root table, ACA, FPA, aliases, previous decisions, settings, review history, and Root changes are preserved.</small></div></div><div className="fresh-dialog-actions"><button className="secondary" onClick={onCancel}>Keep current triage</button><button className="primary" onClick={onConfirm}><RotateCcw size={15} />Start fresh at Step 1</button></div></section></>;
}

function ImportPreflightDialog({ decisions, onCancel, onConfirm, onReviewAgain }: { decisions: ImportIntakeDecision[]; onCancel: () => void; onConfirm: () => void; onReviewAgain: (keys: string[]) => void }) {
  const [reviewAgainKeys, setReviewAgainKeys] = useState<string[]>([]);
  const imported = decisions.filter((item) => item.outcome === "IMPORTED").length;
  const notImported = decisions.length - imported;
  const canReviewAgain = (item: ImportIntakeDecision) => item.outcome === "NOT_IMPORTED"
    && (item.reviewAgainAllowed ?? !/(another teammate|being worked by)/i.test(item.reason));
  const eligible = decisions.filter(canReviewAgain);
  const selectedCount = reviewAgainKeys.length;
  function toggleReviewAgain(item: ImportIntakeDecision) {
    const key = intakeDecisionKey(item);
    setReviewAgainKeys((current) => current.includes(key) ? current.filter((candidate) => candidate !== key) : [...current, key]);
  }
  return <div className="modal-backdrop import-preflight-backdrop" role="presentation"><section className="import-preflight-dialog" role="dialog" aria-modal="true" aria-labelledby="import-preflight-title">
    <div className="import-preflight-head"><span><ShieldCheck size={25} /></span><div><small>STEP 1 CHECK · CONFIRM BEFORE PROCESSING</small><h2 id="import-preflight-title">You submitted {decisions.length} brands</h2><p>Brandmaster found previous or active work. Nothing has been imported yet. Review every outcome below and decide whether to continue.</p></div></div>
    <div className="import-preflight-counts"><span className="will-import"><b>{imported + selectedCount}</b><small>Will import</small></span><span className="will-not-import"><b>{notImported - selectedCount}</b><small>Will not import</small></span><span><b>{decisions.length}</b><small>Total submitted</small></span></div>
    <div className="import-preflight-table">
      <div><b>Brand</b><b>Outcome</b><b>Reason</b></div>
      {decisions.map((item, index) => { const key = intakeDecisionKey(item); const selected = reviewAgainKeys.includes(key); return <div className={selected ? "review-again-selected" : ""} key={`${item.id}:${item.brand}:${index}`}><strong>{canReviewAgain(item) ? <label><input type="checkbox" checked={selected} onChange={() => toggleReviewAgain(item)} /><span>{item.brand}<small>Select to review again</small></span></label> : item.brand}</strong><span className={selected ? "review-again" : item.outcome === "IMPORTED" ? "imported" : "not-imported"}>{selected ? "Review again" : item.outcome === "IMPORTED" ? "Will import" : "Not imported"}</span><p>{selected ? "Will be reopened and assigned to this new review" : item.reason}{item.action && !selected ? <small>{item.action}{item.date ? ` · ${fmtDate(item.date)}` : ""}</small> : null}</p></div>; })}
    </div>
    {eligible.length > 0 && <div className="review-again-help"><RotateCcw size={18} /><span><b>Need to run a protected brand again?</b><small>Select only the brands you want to reopen. Unselected work remains unchanged.</small></span><button onClick={() => setReviewAgainKeys(selectedCount === eligible.length ? [] : eligible.map(intakeDecisionKey))}>{selectedCount === eligible.length ? "Clear selection" : `Select all ${eligible.length}`}</button></div>}
    <div className="import-preflight-actions"><button className="secondary" onClick={onCancel}><ChevronLeft size={15} />Back to edit brands</button><button className="secondary end-process" onClick={onConfirm}>{imported ? <><Check size={15} />Continue with {imported}</> : <><X size={15} />Confirm and end</>}</button>{eligible.length > 0 && <button className="primary review-again-button" disabled={!selectedCount} onClick={() => onReviewAgain(reviewAgainKeys)}><RotateCcw size={15} />Review again selected{selectedCount ? ` (${selectedCount})` : ""}</button>}</div>
  </section></div>;
}

function CompletedBrandDialog({ details, onConfirm }: { details: CompletedBrandDetail[]; onConfirm: () => void }) {
  return <><div className="modal-backdrop completed-brand-backdrop" role="presentation"><section className="completed-brand-dialog" role="dialog" aria-modal="true" aria-labelledby="completed-brand-title">
    <div className="completed-brand-icon"><ShieldCheck size={26} /></div>
    <small>PROCESS STOPPED · ALREADY COMPLETED</small>
    <h2 id="completed-brand-title">{details.length === 1 ? "This brand is already done" : `${details.length} brands are already done`}</h2>
    <p>Brandmaster did not add or process any submitted rows. This notice stays open, including after a refresh, until you confirm the completed work and end this attempt.</p>
    <div className="completed-brand-table">
      <div><b>Brand</b><b>Action</b><b>Date</b></div>
      {details.map((detail) => <div key={`${detail.brand}:${detail.action}:${detail.date}`}><strong>{detail.brand}</strong><span className={`completed-action ${detail.action.toLowerCase()}`}>{detail.action}</span><time>{fmtDate(detail.date)}<small>{fmtTime(detail.date)}</small></time></div>)}
    </div>
    <div className="completed-brand-actions"><button className="primary" autoFocus onClick={onConfirm}><Check size={15} />Confirm and end process</button></div>
  </section></div></>;
}

function SourceVerificationDialog({ summary, rowCount, onClose, onViewReport }: { summary: ImportReconciliationSummary; rowCount: number; onClose: () => void; onViewReport: () => void }) {
  const hasChecks = summary.checked > 0;
  const allVerified = hasChecks && summary.unresolved === 0;
  const title = !summary.tracked ? "Source loaded — nothing tracked yet" : !hasChecks ? "Source loaded — no matching checks" : allVerified ? "All checked changes are verified" : `${summary.unresolved} change${summary.unresolved === 1 ? " needs" : "s need"} attention`;
  const body = !summary.tracked
    ? "Brandmaster loaded the table successfully, but no Bulk CSV uploads or completed Root Admin tasks are recorded in this workspace yet."
    : !hasChecks
      ? `Brandmaster has ${summary.tracked} tracked Admin change${summary.tracked === 1 ? "" : "s"}, but this ${summary.source} table could not verify them. A newer matching source may still be required.`
      : `Brandmaster compared this ${summary.source} upload with ${summary.checked} tracked Admin change${summary.checked === 1 ? "" : "s"}.`;
  return <><div className="fresh-dialog-scrim" onClick={onClose} /><section className={`source-verification-dialog ${allVerified ? "verified" : summary.unresolved ? "attention" : "empty"}`} role="dialog" aria-modal="true" aria-labelledby="source-verification-title">
    <button className="icon-button source-verification-close" onClick={onClose} aria-label="Close verification results"><X size={18} /></button>
    <div className="source-verification-mark">{allVerified ? <ShieldCheck size={27} /> : hasChecks ? <FileClock size={27} /> : <Database size={27} />}</div>
    <small>{summary.source} IMPORT VERIFICATION</small><h2 id="source-verification-title">{title}</h2><p>{body}</p>
    <div className="source-verification-file"><FileUp size={17} /><span><b>{summary.filename}</b><small>{rowCount.toLocaleString()} rows loaded · {fmtDate(summary.importedAt)} at {fmtTime(summary.importedAt)}</small></span></div>
    <div className="source-verification-stats"><span><b>{summary.checked}</b><small>Compared now</small></span><span className="verified"><b>{summary.verified}</b><small>Verified</small></span><span className={summary.unresolved ? "attention" : ""}><b>{summary.unresolved}</b><small>Need attention</small></span><span><b>{summary.awaiting}</b><small>Awaiting source</small></span></div>
    {!summary.tracked && <div className="source-verification-help"><CircleHelp size={16} /><span><b>How verification starts</b><small>Confirm a Step 3 file as uploaded, or mark a Root cleanup task completed in Admin. Then replace the newer UBQ or Root export.</small></span></div>}
    <div className="source-verification-actions"><button className="secondary" onClick={onClose}>Close</button><button className="primary" onClick={onViewReport}><ShieldCheck size={15} />View full reconciliation report</button></div>
  </section></>;
}

const WALKTHROUGH_STEPS: { title: string; body: string; selector: string; view?: View; path?: "TEAM" | "NEW" }[] = [
  { title: "Choose who is working", body: "Open Working as and select your real name. Assignments, reviews, exports, and analytics will use this name.", selector: ".top-team-select", view: "imports" },
  { title: "Team work comes first", body: "The shared High Priority Queue has active brands. Open it and claim team work before adding another list. This prevents duplicate effort and keeps urgent work moving.", selector: ".team-queue-launcher", view: "imports", path: "TEAM" },
  { title: "Open the Team Queue", body: "Open the shared queue to see available work and assignments from the whole team.", selector: ".team-queue-launcher > button", view: "imports", path: "TEAM" },
  { title: "Show available work", body: "Under Assigned to, choose Available / unassigned so you only see brands nobody has claimed.", selector: ".queue-owner-filter", view: "imports", path: "TEAM" },
  { title: "Select brands", body: "Use the checkboxes to select the brands you want to work on. You can select one row or several rows.", selector: ".priority-table > div:nth-child(2) input", view: "imports", path: "TEAM" },
  { title: "Choose the assignee", body: "In Assign to, select your name. To release claimed work back to the shared queue, select Unassigned / everyone instead.", selector: ".priority-assign-control select", view: "imports", path: "TEAM" },
  { title: "Assign the selected brands", body: "Click Assign. The ownership change remains unsaved until you use Save team changes.", selector: ".priority-assign-control button", view: "imports", path: "TEAM" },
  { title: "Set the work status", body: "Choose In progress and click Apply status when you begin. Use Blocked if you cannot continue.", selector: ".priority-status-control", view: "imports", path: "TEAM" },
  { title: "Start review", body: "Click Start review to move your selected brands into Step 2. Only brands assigned to you can be started.", selector: ".priority-actions > button.primary", view: "imports", path: "TEAM" },
  { title: "Add a new list", body: "There is no active team work waiting. Upload a CSV or paste brand names to begin a new Step 1 triage. New urgent work can also be added to the High Priority Queue for the team.", selector: ".input-mode-tabs", view: "imports", path: "NEW" },
  { title: "Optional AI review", body: "Generate the validator prompt, then paste or import the returned JSON. You can always override its suggestions.", selector: ".ai-review-head button", view: "review" },
  { title: "Review each decision", body: "Open a row to confirm or edit CREATE, MERGE, SKIP, or DELETE. Resolve every warning before continuing.", selector: ".review-table .table-row:not(.table-head-row)", view: "review" },
  { title: "Continue to Step 3", body: "When every decision is valid, the next-step button directly below the review table becomes available.", selector: ".review-table-next .primary", view: "review" },
  { title: "Download the bulk CSV", body: "Download the exact five-column file for the Admin bulk-upload tool.", selector: ".output-download", view: "output" },
  { title: "Report the Admin result", body: "Import the Admin result CSV or confirm all rows succeeded. Failed rows can return to Step 2.", selector: ".export-confirm-dialog .primary", view: "output" },
  { title: "Finish and start again", body: "The completed run is archived for history and analytics. Start a new triage opens an empty personal basket.", selector: ".admin-upload-complete .primary", view: "output" },
];

function GuidedWalkthrough({ view, hasTeamWork, onNavigate, onClose }: { view: View; hasTeamWork: boolean; onNavigate: (view: View) => void; onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [cardPosition, setCardPosition] = useState<{ left: number; top: number } | null>(null);
  const dragRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);
  const steps = useMemo(() => WALKTHROUGH_STEPS.filter((item) => !item.path || item.path === (hasTeamWork ? "TEAM" : "NEW")), [hasTeamWork]);
  const current = steps[Math.min(step, steps.length - 1)];
  useEffect(() => { if (current.view && view !== current.view) onNavigate(current.view); }, [current.view, onNavigate, view]);
  useEffect(() => {
    let target: Element | null = null;
    const update = () => { target = document.querySelector(current.selector); setRect(target?.getBoundingClientRect() || null); };
    update(); document.querySelector<HTMLElement>(current.selector)?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    const observer = new MutationObserver(update); observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    window.addEventListener("resize", update); window.addEventListener("scroll", update, true);
    return () => { observer.disconnect(); window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); };
  }, [current.selector, view]);
  const go = (next: number) => { setCardPosition(null); setStep(Math.max(0, Math.min(steps.length - 1, next))); };
  const autoPosition = rect ? (() => {
    const width = Math.min(370, window.innerWidth - 36); const height = 270; const gap = 30; const margin = 18;
    const centeredLeft = rect.left + rect.width / 2 - width / 2;
    const candidates = [
      { left: centeredLeft, top: rect.bottom + gap, fits: rect.bottom + gap + height <= window.innerHeight - margin },
      { left: centeredLeft, top: rect.top - height - gap, fits: rect.top - height - gap >= margin },
      { left: rect.right + gap, top: rect.top + rect.height / 2 - height / 2, fits: rect.right + gap + width <= window.innerWidth - margin },
      { left: rect.left - width - gap, top: rect.top + rect.height / 2 - height / 2, fits: rect.left - width - gap >= margin },
    ];
    const chosen = candidates.find((candidate) => candidate.fits) || candidates[0];
    return { left: Math.max(margin, Math.min(window.innerWidth - width - margin, chosen.left)), top: Math.max(margin, Math.min(window.innerHeight - height - margin, chosen.top)) };
  })() : undefined;
  const tooltipStyle = rect ? (cardPosition || autoPosition) : undefined;
  function startDrag(event: React.PointerEvent<HTMLDivElement>) {
    const card = event.currentTarget.closest<HTMLElement>(".guided-tour-card"); if (!card) return;
    const cardRect = card.getBoundingClientRect();
    dragRef.current = { pointerId: event.pointerId, offsetX: event.clientX - cardRect.left, offsetY: event.clientY - cardRect.top };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function drag(event: React.PointerEvent<HTMLDivElement>) {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return;
    const width = Math.min(370, window.innerWidth - 36); const margin = 12;
    setCardPosition({ left: Math.max(margin, Math.min(window.innerWidth - width - margin, event.clientX - dragRef.current.offsetX)), top: Math.max(margin, Math.min(window.innerHeight - 190, event.clientY - dragRef.current.offsetY)) });
  }
  function stopDrag(event: React.PointerEvent<HTMLDivElement>) { if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null; }
  return <div className="guided-tour" role="dialog" aria-modal="true" aria-label="Brandmaster walkthrough"><div className="guided-tour-shade" />{rect && <><div className="guided-tour-focus" style={{ top: rect.top - 7, left: rect.left - 7, width: rect.width + 14, height: rect.height + 14 }} /><div className="guided-tour-hand" style={{ top: Math.max(4, rect.top - 61), left: Math.max(8, Math.min(window.innerWidth - 63, rect.left + rect.width / 2 - 29)) }}>👇</div></>}<section className={`guided-tour-card ${rect ? "targeted" : "waiting"}`} style={tooltipStyle}><div className="guided-tour-progress" onPointerDown={startDrag} onPointerMove={drag} onPointerUp={stopDrag} onPointerCancel={stopDrag}><span><i aria-hidden="true">✥</i> STEP {step + 1} OF {steps.length}<small>Drag this window</small></span><button onPointerDown={(event) => event.stopPropagation()} onClick={onClose} aria-label="Close walkthrough"><X size={17} /></button></div><h2>{current.title}</h2><p>{current.body}</p>{!rect && <div className="guided-tour-wait"><CircleHelp size={16} /><span>Complete the previous action to reveal this control, then continue.</span></div>}<div className="guided-tour-actions"><button className="secondary" disabled={step === 0} onClick={() => go(step - 1)}>Back</button>{step === steps.length - 1 ? <button className="primary" onClick={onClose}><Check size={15} />Finish tour</button> : <button className="primary" onClick={() => go(step + 1)}>Next <ChevronRight size={15} /></button>}</div></section></div>;
}

function FreshTriageTransition() {
  return <div className="fresh-transition"><div className="fresh-funnel"><span><FileUp size={20} /></span><i /><span><WandSparkles size={20} /></span><i /><span><ArrowDownToLine size={20} /></span></div><b>Preparing a fresh triage</b><p>Clearing the active worklist and returning to Step 1…</p></div>;
}

function WorkflowStepper({ stage, onNavigate, onRestart, hasImport = false, outputReady = false, rootMode = false, owner, counts = { inBasket: 0, inReview: 0, ready: 0 }, basketRecords = [] }: { stage: 1 | 2 | 3; onNavigate: (view: View) => void; onRestart?: () => void; hasImport?: boolean; outputReady?: boolean; rootMode?: boolean; owner?: string; counts?: TriageCounts; basketRecords?: BrandRecord[] }) {
  const [basketOpen, setBasketOpen] = useState(false);
  const basketDestination: View = counts.inReview > 0 ? "review" : outputReady && counts.ready > 0 ? "output" : hasImport ? "review" : "imports";
  const steps: { number: 1 | 2 | 3; label: string; detail: string; count: number; countLabel: string; view: View; available: boolean }[] = rootMode ? [
    { number: 1, label: "Select Root records", detail: "Build a cleanup worklist", count: counts.inBasket, countLabel: "selected", view: "brands", available: true },
    { number: 2, label: "Review & save", detail: "Persistent Admin recommendations", count: counts.inReview, countLabel: "to review", view: "review", available: hasImport },
  ] : [
    { number: 1, label: "Add brands", detail: "Upload, paste, or claim work", count: Math.max(0, counts.inBasket - counts.inReview - counts.ready), countLabel: owner ? `${owner} · added` : "added", view: "imports", available: true },
    { number: 2, label: "Review decisions", detail: "Confirm what should happen", count: counts.inReview, countLabel: owner ? `${owner} · reviewing` : "to review", view: "review", available: hasImport },
    { number: 3, label: "Download file", detail: outputReady ? "Ready for the Admin tool" : counts.ready ? "Ready rows are waiting" : "Finish Step 2 to unlock", count: counts.ready, countLabel: owner ? `${owner} · ready` : "ready", view: "output", available: outputReady },
  ];
  return <section className={`workflow-funnel ${rootMode ? "root-workflow" : "ubq-workflow"}`}>
    <div className="workflow-funnel-head"><div className="workflow-title"><span>{rootMode ? "ROOT CLEANUP WORKFLOW" : `${(owner || "SHARED TEAM").toUpperCase()} · PERSONAL TRIAGE BASKET`}</span><b>{rootMode ? "Review recommendations, then complete the work in Admin" : `These records belong to ${owner || "the shared team"}'s current 1–2–3 worklist—not the entire High Priority Queue.`}</b></div>{!rootMode && <button className="triage-basket" aria-expanded={basketOpen} aria-label={`Show ${counts.inBasket} brands in ${owner || "team"} basket`} disabled={!hasImport} onClick={() => setBasketOpen((open) => !open)} title="Show exactly which brands are in this basket"><ShoppingBag size={18} /><span><b>{counts.inBasket}</b><small>{owner ? `${owner}'s basket` : "Team basket"}</small></span><span className={counts.inReview ? "attention" : ""}><b>{counts.inReview}</b><small>Need review</small></span><span className={counts.ready ? "ready" : ""}><b>{counts.ready}</b><small>Ready</small></span>{basketOpen ? <ChevronUp size={17} /> : <ChevronDown size={17} />}</button>}{hasImport && onRestart && <button className="restart-triage" onClick={onRestart} title="Clear only this personal batch; shared High Priority items remain in the team queue"><RotateCcw size={14} />Start fresh</button>}</div>
    {basketOpen && !rootMode && <div className="triage-basket-details"><div className="triage-basket-details-head"><div><b>{counts.inBasket} brands in {owner || "the team"}&apos;s basket</b><small>This is the complete active personal worklist. Resolved non-mapping items are removed.</small></div><button className="icon-button" onClick={() => setBasketOpen(false)} aria-label="Close basket details"><X size={17} /></button></div><div className="triage-basket-list">{basketRecords.filter((record) => !record.excludedFromExport && !record.triageResolution).map((record) => { const label = triageRecordLabel(record, basketRecords); const ready = label === "Ready for Step 3"; return <div key={`${record.id}-${record.name}`}><span><b>{record.name}</b><small>{record.id}</small></span><em className={ready ? "ready" : "attention"}>{label}</em></div>; })}</div><div className="triage-basket-details-actions"><span>{counts.inReview ? `${counts.inReview} brand${counts.inReview === 1 ? " needs" : "s need"} attention before download.` : `${counts.ready} brand${counts.ready === 1 ? " is" : "s are"} ready to download.`}</span><button className="secondary" onClick={() => onNavigate(basketDestination)}>{counts.inReview ? "Fix in Step 2" : "Open ready brands"}<ChevronRight size={15} /></button></div></div>}
    <div className="workflow-stepper">{steps.map((step, index) => <div className={`workflow-step ${stage === step.number ? "active" : ""} ${stage > step.number || (step.number === 3 && outputReady) ? "done" : ""}`} key={step.number}><button disabled={!step.available} aria-current={stage === step.number ? "step" : undefined} onClick={() => onNavigate(step.view)}><span>{stage > step.number || (step.number === 3 && outputReady) ? <Check size={15} /> : step.number}</span><div><b>{step.label}</b><small>{step.detail}</small></div><em className="workflow-count"><strong>{step.count}</strong><small>{step.countLabel}</small></em></button>{index < steps.length - 1 && <i><span /></i>}</div>)}</div>
  </section>;
}

function CleanWorkflowHeader({ view, batch, owner, checkpointAt, savePending, saveBusy, connected, onNavigate, onSave, onRestart }: { view: "imports" | "review" | "output"; batch?: ImportBatch; owner: string; checkpointAt?: string; savePending: boolean; saveBusy: boolean; connected: boolean; onNavigate: (view: View) => void; onSave: () => void; onRestart: () => void }) {
  const records = batch?.records || [];
  const counts = getTriageCounts(records, batch?.workflowSource === "ROOT");
  const active = records.filter(isActiveTriageRecord);
  const ready = Boolean(batch && batch.workflowSource !== "ROOT" && getBulkExportReadiness(active).ready && !active.some((record) => record.blockedByTargetCreation));
  const workflowComplete = Boolean(batch && !active.length);
  const stage = workflowComplete ? 3 : view === "imports" ? 1 : view === "review" ? 2 : 3;
  const resumeTarget = resolveWorkflowCheckpoint(undefined, batch) || "imports";
  const previousTarget: View = stage === 3 ? "review" : "imports";
  const checkpointLabel = checkpointAt ? `${fmtDate(checkpointAt)} at ${fmtTime(checkpointAt)}` : "Not saved yet";
  const steps = [
    { number: 1, title: "Select work", detail: batch ? `${counts.inBasket} in ${owner}'s worklist` : "Choose team brands", target: "imports" as View, enabled: true },
    { number: 2, title: "Review", detail: batch ? `${counts.inReview} need attention · ${counts.ready} ready` : "Confirm every decision", target: "review" as View, enabled: Boolean(batch) },
    { number: 3, title: workflowComplete ? "Complete" : "Finish", detail: workflowComplete ? "Triage cleared" : `${counts.ready} ready`, target: "output" as View, enabled: ready || workflowComplete },
  ];
  return <section className="clean-progress" aria-label="Triage progress">
    <div className="clean-progress-top"><div className="clean-process-identity"><span><Activity size={18} /></span><div><small>ACTIVE PROCESS · {owner.toUpperCase()}</small><b>{batch ? `${records.length} brand${records.length === 1 ? "" : "s"} · Step ${stage} of 3` : "Ready to start a new triage"}</b></div></div><div className="clean-process-checkpoint"><small>LAST CHECKPOINT</small><b>{checkpointLabel}</b><span className={savePending ? "pending" : "saved"}>{savePending ? "Changes need saving" : "All progress saved"}</span></div></div>
    <div className="clean-progress-body"><div className="clean-progress-steps">{steps.map((step) => <button key={step.number} className={stage === step.number ? "active" : stage > step.number ? "done" : ""} disabled={!step.enabled} onClick={() => onNavigate(step.target)}><span>{stage > step.number ? <Check size={16} /> : step.number}</span><div><b>{step.title}</b><small>{step.detail}</small></div></button>)}</div><div className="clean-process-controls">
      <button className={`clean-save ${savePending ? "pending" : "saved"}`} disabled={!connected || saveBusy} onClick={onSave}>{saveBusy ? <RefreshCw className="spinning" size={16} /> : savePending ? <UploadCloud size={16} /> : <Check size={16} />}<span>{saveBusy ? "Saving…" : savePending ? "Save progress" : "Progress saved"}</span></button>
    </div></div>
    <div className="process-actions-bar" aria-label="Process actions"><span><Settings size={15} /><b>Process actions</b></span><button disabled={!batch} onClick={() => onNavigate(resumeTarget)}><Play size={15} />Resume current step</button><button disabled={!batch || stage === 1} onClick={() => onNavigate(previousTarget)}><ChevronLeft size={15} />Previous step</button><button className="reset" disabled={!batch} onClick={onRestart}><RotateCcw size={15} />Start over</button></div>
  </section>;
}

function ProcessingView({ run }: { run: ProcessingRun }) {
  const progress = Math.round(((run.current + 1) / run.steps.length) * 100);
  const mode = run.source === "ROOT" ? "root" : "ubq";
  return <div className={`processing-page ${mode}`}><span className="processing-mode">{run.source === "ROOT" ? "ROOT TABLE CLEANUP" : "UBQ BRAND CLEANUP"}</span><div className="processing-orbit"><span className="orbit-ring ring-one" /><span className="orbit-ring ring-two" /><div><WandSparkles size={30} /><b>{progress}%</b></div></div><span className="processing-eyebrow">VALIDATION ENGINE RUNNING</span><h1>Checking {run.count.toLocaleString()} brand{run.count === 1 ? "" : "s"}</h1><p>{run.filename}</p><div className="process-progress"><i style={{ width: `${progress}%` }} /></div><div className="process-modules">{run.steps.map((step, index) => <div className={index < run.current ? "done" : index === run.current ? "active" : ""} key={step}><span>{index < run.current ? <Check size={14} /> : index === run.current ? <Activity size={14} /> : index + 1}</span><div><b>{step}</b><small>{index < run.current ? "Checked" : index === run.current ? "Searching now…" : "Waiting"}</small></div>{index === run.current && <em><i /><i /><i /></em>}</div>)}</div><small className="processing-note"><ShieldCheck size={13} />All local checks run on this Mac. Your data is not uploaded.</small></div>;
}

function Dashboard({ data, records, avg, pending, currentUser, displayName, simpleMode, onNavigate, onImport }: { data: AppData; records: BrandRecord[]; avg: number; pending: number; currentUser: string; displayName: string; simpleMode: boolean; onNavigate: (v: View) => void; onImport: (name: string, rows: ReturnType<typeof parseCsv>) => void }) {
  if (simpleMode) return <DailyWorkHome data={data} records={records} pending={pending} currentUser={currentUser} displayName={displayName} onNavigate={onNavigate} onImport={onImport} />;
  const today = new Date().toDateString();
  const todayLabel = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric" }).format(new Date()).toUpperCase();
  const todayCount = data.batches.filter((b) => b.owner === currentUser && new Date(b.createdAt).toDateString() === today).length;
  const counts = (action: Action) => records.filter((r) => r.action === action).length;
  const recent = data.ledger.filter((entry) => entry.reviewer === currentUser).slice(0, 5);
  return <>
    <PageHead eyebrow={todayLabel} title={`Welcome, ${displayName}`} body="Here’s what’s happening across your brand validation workspace." actions={<button className="primary" onClick={() => onNavigate("imports")}><Plus size={16} />Start a new list</button>} />
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

function DailyWorkHome({ data, records, pending, currentUser, displayName, onNavigate, onImport }: { data: AppData; records: BrandRecord[]; pending: number; currentUser: string; displayName: string; onNavigate: (v: View) => void; onImport: (name: string, rows: ReturnType<typeof parseCsv>) => void }) {
  const activeRecords = records.filter(isActiveTriageRecord);
  const readiness = getBulkExportReadiness(activeRecords);
  const reviewed = activeRecords.filter((record) => record.status !== "needs-review").length;
  const mine = data.priorityQueue.filter((item) => isActivePriorityTask(item) && item.assignedTo === currentUser && item.status !== "COMPLETED").length;
  const available = data.priorityQueue.filter((item) => isActivePriorityTask(item) && item.status === "UNASSIGNED").length;
  const personal = data.userWorkspaces[currentUser];
  const pinned = personal?.pinnedQueueIds.length || 0;
  const recentFiles = personal?.uploads.length || 0;
  const attentionCount = pending || readiness.invalidIds.length + readiness.incompleteMerges.length + readiness.incompleteCreates.length;
  const next = !records.length ? { step: 1, label: "Add brands to validate", detail: "Upload a CSV, paste brand names, or claim team work.", view: "imports" as View, icon: FileUp }
    : pending || !readiness.ready ? { step: 2, label: "Continue reviewing decisions", detail: `${attentionCount} brand${attentionCount === 1 ? "" : "s"} need attention before download.`, view: "review" as View, icon: FileClock }
    : { step: 3, label: "Download the finished file", detail: `${activeRecords.length.toLocaleString()} decisions are ready for the Admin upload tool.`, view: "output" as View, icon: ArrowDownToLine };
  const NextIcon = next.icon;
  const progressLabel = next.step === 1 ? "Ready to start" : next.step === 2 ? "Review in progress" : "Ready to download";
  return <div className="daily-workspace">
    <header className="daily-hero">
      <div className="daily-brand-symbol"><Image unoptimized src={`${APP_BASE_PATH}/brandmaster-logo.jpeg`} width={150} height={150} alt="Brandmaster" /></div>
      <div className="daily-hero-copy"><span>BRANDMASTER WORKSPACE</span><h1>Welcome back, {displayName}</h1><p>Validate brands and prepare the exact CSV required by the Admin upload tool.</p></div>
      <div className="daily-hero-summary"><small>CURRENT STATUS</small><strong>{progressLabel}</strong><span>{records.length ? `${records.length.toLocaleString()} brands in this run` : "No active brand list"}</span></div>
    </header>

    <section className="daily-focus">
      <span className="daily-focus-icon"><NextIcon size={24} /></span>
      <div><small>YOUR NEXT STEP · STEP {next.step} OF 3</small><h2>{next.label}</h2><p>{next.detail}</p></div>
      <button onClick={() => onNavigate(next.view)}>Continue <ChevronRight size={18} /></button>
    </section>

    <section className="daily-flow-card">
      <div className="daily-flow-head"><div><span>THE THREE-STEP PROCESS</span><h2>Your validation run</h2></div><strong>{next.step - 1} of 3 complete</strong></div>
      <div className="daily-three-bases" aria-label="Brand validation progress">
        <button className={next.step === 1 ? "active" : records.length ? "done" : ""} onClick={() => onNavigate("imports")}><span>{records.length ? <Check size={19} /> : "1"}</span><div><small>FIRST STEP</small><b>Add brands</b><p>{records.length ? `${records.length.toLocaleString()} in current list` : "Upload, paste, or claim"}</p></div></button>
        <i />
        <button className={next.step === 2 ? "active" : readiness.ready && records.length ? "done" : ""} disabled={!records.length} onClick={() => onNavigate("review")}><span>{readiness.ready && records.length ? <Check size={19} /> : "2"}</span><div><small>SECOND STEP</small><b>Review decisions</b><p>{records.length ? `${reviewed.toLocaleString()} checked · ${pending.toLocaleString()} left` : "Confirm each recommendation"}</p></div></button>
        <i />
        <button className={next.step === 3 ? "active" : ""} disabled={!readiness.ready} onClick={() => onNavigate("output")}><span>3</span><div><small>THIRD STEP</small><b>Download file</b><p>{readiness.ready ? "CSV is ready" : "Unlocks after review"}</p></div></button>
      </div>
      <p className="daily-flow-note"><ShieldCheck size={16} />The downloaded file always keeps the five required Admin upload columns.</p>
    </section>

    <section className="daily-secondary-grid">
      <article className="daily-team-card"><span><Users size={22} /></span><div><small>YOUR SAVED WORKSPACE</small><h2>{mine ? `${mine} assigned · ${pinned} pinned` : available ? `${available} available · ${pinned} pinned` : "You are all caught up"}</h2><p>{recentFiles} recent input or output file{recentFiles === 1 ? "" : "s"}. Your active triage, pins, assignments, and files switch with your profile.</p></div><button className="secondary" onClick={() => onNavigate("imports")}>Open my work <ChevronRight size={16} /></button></article>
      <article className="daily-quick-card"><div><small>QUICK ACTIONS</small><h2>Start somewhere else</h2></div><button onClick={() => onNavigate("imports")}><Plus size={18} /><span><b>Start a new list</b><small>Upload or paste brands</small></span><ChevronRight size={16} /></button><button onClick={() => onNavigate("analytics")}><TrendingUp size={18} /><span><b>Team progress</b><small>Daily and weekly results</small></span><ChevronRight size={16} /></button></article>
    </section>
    {!records.length && <button className="daily-sample" onClick={() => onImport("brandmaster-sample.csv", parseCsv(SAMPLE))}><Sparkles size={15} />New here? Try a safe example</button>}
  </div>;
}

function WelcomePanel({ onImport, onNavigate }: { onImport: (name: string, rows: ReturnType<typeof parseCsv>) => void; onNavigate: (v: View) => void }) {
  return <div className="welcome-panel"><div className="welcome-art"><div className="orbit o1" /><div className="orbit o2" /><WandSparkles size={34} /><span className="mini-card c1">BMW OE <b>MERGE</b></span><span className="mini-card c2">Motrio <b>CREATE</b></span></div><div><span className="eyebrow">YOUR VALIDATION WORKSPACE</span><h2>Turn unmapped brands into clean catalog decisions</h2><p>Upload a CSV and Brandmaster will normalize names, check your knowledge base, recommend actions, and route uncertain matches to review—all locally on your Mac.</p><div className="button-row"><button className="primary" onClick={() => onNavigate("imports")}><UploadCloud size={17} />Upload CSV</button><button className="secondary" onClick={() => onImport("brandmaster-sample.csv", parseCsv(SAMPLE))}><Sparkles size={17} />Try sample data</button></div><div className="feature-row"><span><Check size={14} />Works offline</span><span><Check size={14} />No API key required</span><span><Check size={14} />Export ready</span></div></div></div>;
}

function ActionChart({ records }: { records: BrandRecord[] }) {
  const values = (["MERGE", "CREATE", "SKIP", "DELETE"] as Action[]).map((action) => ({ action, count: records.filter((r) => r.action === action).length }));
  const max = Math.max(1, ...values.map((v) => v.count));
  return <div className="bar-chart"><div className="axis"><span>{max}</span><span>{Math.ceil(max / 2)}</span><span>0</span></div><div className="bars">{values.map((v) => <div key={v.action}><div className={`bar ${v.action.toLowerCase()}`} style={{ height: `${Math.max(5, v.count / max * 100)}%` }}><em>{v.count}</em></div><span>{v.action}</span></div>)}</div></div>;
}

function DonutChart({ records }: { records: { action: Action }[] }) {
  const total = records.length || 1; let offset = 0;
  const colors: Record<Action, string> = { MERGE: "#287a5b", CREATE: "#7766c6", SKIP: "#dd9b38", DELETE: "#d65c5c" };
  return <div className="donut-wrap"><svg viewBox="0 0 42 42" className="donut"><circle cx="21" cy="21" r="15.9" fill="none" stroke="var(--surface-3)" strokeWidth="5" />{(["MERGE", "CREATE", "SKIP", "DELETE"] as Action[]).map((a) => { const value = records.filter((r) => r.action === a).length; const size = value / total * 100; const node = <circle key={a} cx="21" cy="21" r="15.9" fill="none" stroke={colors[a]} strokeWidth="5" strokeDasharray={`${size} ${100-size}`} strokeDashoffset={-offset} />; offset += size; return node; })}</svg><div className="donut-label"><b>{records.length}</b><span>Total</span></div><div className="legend">{(["MERGE", "CREATE", "SKIP", "DELETE"] as Action[]).map((a) => <div key={a}><i style={{ background: colors[a] }} />{a}<b>{records.filter((r) => r.action === a).length}</b></div>)}</div></div>;
}

function SmartTargetPicker({ brands, query, selectedId, onQuery, onSelect }: { brands: CatalogBrand[]; query: string; selectedId: string; onQuery: (query: string) => void; onSelect: (brand: CatalogBrand) => void }) {
  const results = useMemo(() => brands.map((brand) => ({ brand, match: matchCatalogBrand(query, brand) })).filter((item) => item.match.score >= 42).sort((left, right) => right.match.score - left.match.score || left.brand.name.localeCompare(right.brand.name)).slice(0, 10), [brands, query]);
  const selected = brands.find((brand) => brand.id === selectedId);
  return <div className="smart-target-picker"><label className="field"><span>Search existing brands</span><div className="smart-target-search"><Search size={15} /><input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Type a brand name, alias, or exact brand_ ID…" /></div><small>Short text searches names and aliases—not random characters inside BrandIDs. Results remain suggestions until selected.</small></label>{selected && <div className="smart-target-selected"><Check size={15} /><span><b>Associated with {selected.name}</b><code>{selected.id}</code></span></div>}{query.trim() && <div className="smart-target-results">{results.length ? results.map(({ brand, match }) => <button type="button" className={brand.id === selectedId ? "selected" : ""} key={brand.id} onClick={() => onSelect(brand)}><span><b>{brand.name}</b><small>{brand.aliases?.slice(0, 2).join(" · ") || brand.source}</small></span><code>{brand.id}</code><em>{brandMatchLabel(match)}</em></button>) : <p>No matching existing brand name or alias. Try the exact BrandID, a known alias, or a different spelling.</p>}</div>}</div>;
}

function PriorityQueue({ items, currentUser, pinnedQueueIds, teamMembers, maxSelection, onChooseTeamMember, onTogglePin, syncConnected, savePending, saveBusy, saveCountdown, lastSavedAt, onSave, onUpdate, onReset, onRemove, onAdminDone, onStart, onNavigate }: { items: PriorityQueueItem[]; currentUser: string; pinnedQueueIds: string[]; teamMembers: string[]; maxSelection?: number; onChooseTeamMember: (member: string) => void; onTogglePin: (id: string) => void; syncConnected: boolean; savePending: boolean; saveBusy: boolean; saveCountdown: number; lastSavedAt?: string; onSave: () => void; onUpdate: (ids: string[], status: PriorityQueueStatus, assignee?: string, force?: boolean) => void; onReset: (ids: string[]) => void; onRemove: (ids: string[]) => void; onAdminDone: (ids: string[]) => void; onStart: (ids: string[]) => void; onNavigate: (view: View) => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  const [queueQuery, setQueueQuery] = useState("");
  const [queueSource, setQueueSource] = useState<"ALL" | PriorityQueueSource>("ALL");
  const [queueStatus, setQueueStatus] = useState<"ALL" | PriorityQueueStatus>("ALL");
  const [queueOwner, setQueueOwner] = useState("UNASSIGNED");
  const [assignmentTarget, setAssignmentTarget] = useState(currentUser || "");
  const [bulkStatus, setBulkStatus] = useState<PriorityQueueStatus>("IN_REVIEW");
  const [removeArmed, setRemoveArmed] = useState(false);
  const [removeAllArmed, setRemoveAllArmed] = useState(false);
  // Keep exported tasks in shared history and analytics, but out of active triage.
  const archived = items.filter((item) => Boolean(item.exportedAt));
  const withinSelectionLimit = <T,>(values: T[]) => maxSelection ? values.slice(0, maxSelection) : values;
  const activeItems = items.filter(isActivePriorityTask);
  const queueCounts = getPriorityQueueCounts(items, currentUser);
  const open = activeItems.filter((item) => item.status !== "COMPLETED");
  const available = open.filter((item) => item.status === "UNASSIGNED");
  const assigned = queueCounts.assigned;
  const readyForExport = activeItems.filter((item) => item.status === "COMPLETED").length;
  const completed = readyForExport;
  const blocked = activeItems.filter((item) => item.status === "BLOCKED").length;
  const staleCutoff = Date.now() - 3 * 24 * 60 * 60 * 1000;
  const stale = open.filter((item) => item.assignedAt && new Date(item.updatedAt).getTime() < staleCutoff);
  const oldestOpen = open.reduce((oldest, item) => Math.min(oldest, new Date(item.updatedAt).getTime()), Date.now());
  const oldestDays = open.length ? Math.max(0, Math.floor((Date.now() - oldestOpen) / 86_400_000)) : 0;
  const queueSources = [...new Set(activeItems.map((item) => item.source))].sort();
  const visible = activeItems.filter((item) => {
    const text = `${item.name} ${item.brandId} ${item.assignedTo || ""} ${item.finalTargetName || ""} ${item.finalTargetId || ""}`.toLowerCase();
    return (!queueQuery.trim() || text.includes(queueQuery.trim().toLowerCase()))
      && (queueSource === "ALL" || item.source === queueSource)
      && (queueStatus === "ALL" || item.status === queueStatus)
      && (queueOwner === "ALL" || (queueOwner === "UNASSIGNED" ? item.status === "UNASSIGNED" : item.assignedTo === queueOwner));
  }).sort((left, right) => priorityQueueScore(right) - priorityQueueScore(left) || right.updatedAt.localeCompare(left.updatedAt));
  const selectedItems = activeItems.filter((item) => selected.includes(item.id));
  const assignable = selectedItems.map((item) => item.id);
  const mineSelected = selectedItems.filter((item) => item.assignedTo === currentUser && item.status !== "COMPLETED").map((item) => item.id);
  const reviewableSelected = selectedItems.filter((item) => item.status !== "COMPLETED" && (!item.assignedTo || item.assignedTo === currentUser)).map((item) => item.id);
  useEffect(() => { if (currentUser) { setAssignmentTarget(currentUser); setQueueOwner(getPriorityQueueCounts(items, currentUser).mineTotal ? currentUser : "UNASSIGNED"); } }, [currentUser, items]);
  useEffect(() => {
    const requested = sessionStorage.getItem("brandmaster.queue.filter");
    if (!requested) return;
    sessionStorage.removeItem("brandmaster.queue.filter");
    if (requested.startsWith("OWNER:")) setQueueOwner(requested.slice(6));
    else if (["UNASSIGNED", "ASSIGNED", "IN_REVIEW", "BLOCKED", "COMPLETED"].includes(requested)) { setQueueOwner("ALL"); setQueueStatus(requested as PriorityQueueStatus); }
  }, []);
  useEffect(() => setRemoveArmed(false), [selected]);
  const progress = activeItems.length ? Math.round(completed / activeItems.length * 100) : 0;
  return <section className="priority-queue"><div className="priority-hero"><span><Activity size={23} /></span><div><small>TEAM TRIAGE</small><h2>High Priority Brand Queue</h2><p>Only active work appears here. Successfully exported brands move automatically to shared history.</p></div><div className="priority-progress"><b>{activeItems.length}</b><small>active task{activeItems.length === 1 ? "" : "s"}{archived.length ? ` · ${archived.length} exported` : ""}</small><i><em style={{ width: `${progress}%` }} /></i></div></div>
    {!syncConnected && <button className="priority-sync-warning" onClick={() => onNavigate("settings")}><CloudOff size={16} /><span><b>You can claim work now—connect Team Sync to share it</b><small>Until you reconnect, assignments are saved on this device and are not yet visible to teammates.</small></span><ChevronRight size={16} /></button>}
    <div className={`priority-identity ${currentUser ? "ready" : ""}`}><span><Users size={18} /></span><div><b>Who is working on this device?</b><small>The GitHub token only connects the workspace. Choose your real name for task ownership.</small></div><label><span>Working as</span><select value={currentUser} onChange={(event) => onChooseTeamMember(event.target.value)}><option value="" disabled>Choose your name</option>{teamMembers.map((member) => <option key={member} value={member}>{member}</option>)}</select></label></div>
    <div className="priority-stats"><div><b>{available.length}</b><span>Available</span></div><div><b>{assigned}</b><span>Assigned</span></div><div><b>{open.filter((item) => item.status === "IN_REVIEW").length}</b><span>In progress</span></div><div><b>{readyForExport}</b><span>Ready for export</span></div><div className={blocked ? "attention" : ""}><b>{blocked}</b><span>Blocked</span></div><div className={stale.length ? "attention" : ""}><b>{stale.length}</b><span>Stale · {oldestDays}d oldest</span></div></div>
    {activeItems.length > 0 && <div className={`priority-remove-all ${removeAllArmed ? "armed" : ""}`}><span><Trash2 size={16} /><div><b>{removeAllArmed ? `Remove all ${activeItems.length.toLocaleString()} active queue items?` : "Need to intentionally empty the shared queue?"}</b><small>{removeAllArmed ? "This removes available, assigned, in-review, blocked, and Step 3-ready tasks for everyone. Exported history remains." : "Start fresh never removes High Priority work. Only this separate action can empty the active team queue."}</small></div></span><button className={removeAllArmed ? "priority" : "secondary"} onClick={() => { if (!removeAllArmed) { setRemoveAllArmed(true); return; } onRemove(activeItems.map((item) => item.id)); setSelected([]); setRemoveAllArmed(false); }}>{removeAllArmed ? "Confirm remove all" : "Remove all from queue"}</button>{removeAllArmed && <button className="text-button" onClick={() => setRemoveAllArmed(false)}>Cancel</button>}</div>}
    {currentUser && available.length > 0 && !selected.length && <div className="priority-quick-start"><span><WandSparkles size={18} /><span><b>Ready to validate?</b><small>Brandmaster will claim the next available brands for {currentUser} and open Step 2.</small></span></span><button className="primary" onClick={() => onStart(withinSelectionLimit(available).map((item) => item.id))}>Claim {maxSelection ? `next ${Math.min(maxSelection, available.length)}` : `all ${available.length}`} &amp; review</button></div>}
    {pinnedQueueIds.length > 0 && !selected.length && <div className="priority-pin-bar"><span><Pin size={15} />{pinnedQueueIds.length} task{pinnedQueueIds.length === 1 ? "" : "s"} pinned in {currentUser}&apos;s workspace</span><button className="secondary" onClick={() => { setSelected(withinSelectionLimit(items.filter((item) => pinnedQueueIds.includes(item.id))).map((item) => item.id)); setQueueOwner("ALL"); }}>{maxSelection ? `Show up to ${maxSelection}` : "Show all"} pinned tasks</button></div>}
    {selected.length > 0 && <div className="priority-pin-bar"><span><Pin size={15} />Keep important tasks in your personal workspace</span><button className="secondary" onClick={() => selected.forEach(onTogglePin)}>{selected.every((id) => pinnedQueueIds.includes(id)) ? "Unpin selected" : "Pin selected for me"}</button></div>}
    {!items.length ? <div className="priority-empty"><Users size={25} /><div><b>No urgent team work yet</b><p>Use the High Priority Queue tab below, or send selected Root/UBQ records here from Brand management.</p></div></div> : <><div className={`priority-save-bar ${savePending ? "pending" : "saved"}`}><span>{saveBusy ? <RefreshCw className="spinning" size={19} /> : savePending ? <CircleHelp size={19} /> : <Check size={19} />}</span><div><b>{saveBusy ? "Saving team changes…" : savePending ? "Unsaved team changes" : "Team queue saved"}</b><small>{saveBusy ? "Merging your work with the latest shared workspace." : savePending ? `Click Save now, or Brandmaster will auto-save in ${saveCountdown} seconds.` : `${lastSavedAt ? `Saved ${fmtDate(lastSavedAt)} at ${fmtTime(lastSavedAt)}` : "Saved locally"} · checking again in ${saveCountdown} seconds.`}</small></div><button className="primary" disabled={saveBusy || !syncConnected} onClick={onSave}>{saveBusy ? "Saving…" : savePending ? "Save team changes" : "Save & pull now"}</button></div><div className="priority-toolbar"><div><b>Team assignments</b><small>Continue your work or filter the full team queue.</small></div><div className="priority-toolbar-actions">{currentUser && <button className="primary" onClick={() => { setQueueOwner(currentUser); setQueueStatus("ALL"); setSelected([]); }}><Users size={14} />My work ({items.filter((item) => item.assignedTo === currentUser && item.status !== "COMPLETED").length})</button>}{stale.length > 0 && <button className="secondary" onClick={() => { setQueueOwner("ALL"); setQueueStatus("ALL"); setSelected(withinSelectionLimit(stale).map((item) => item.id)); }}><FileClock size={14} />Review {maxSelection ? `next ${Math.min(maxSelection, stale.length)}` : `all ${stale.length}`} stale</button>}{completed > 0 && <button className="secondary" title="Select ready and exported work" onClick={() => { setQueueOwner("ALL"); setQueueStatus("COMPLETED"); setSelected(items.filter((item) => item.status === "COMPLETED").map((item) => item.id)); }}><Check size={14} />Finished ({completed})</button>}</div></div>
      <div className="record-filters queue-filters"><label className="filter-search"><Search size={14} /><input value={queueQuery} onChange={(event) => setQueueQuery(event.target.value)} placeholder="Find brand, ID, owner, or target…" /></label><label className="queue-owner-filter"><span>Assigned to</span><select value={queueOwner} onChange={(event) => { setQueueOwner(event.target.value); setSelected([]); }}><option value="ALL">Everyone</option><option value="UNASSIGNED">Available / unassigned</option>{teamMembers.map((member) => <option key={member} value={member}>{member}{member === currentUser ? " (you)" : ""}</option>)}</select></label><label><span>Source</span><select value={queueSource} onChange={(event) => setQueueSource(event.target.value as "ALL" | PriorityQueueSource)}><option value="ALL">All sources</option>{queueSources.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label><span>Status</span><select value={queueStatus} onChange={(event) => setQueueStatus(event.target.value as "ALL" | PriorityQueueStatus)}><option value="ALL">All statuses</option><option value="UNASSIGNED">Available</option><option value="ASSIGNED">Assigned</option><option value="IN_REVIEW">In progress</option><option value="BLOCKED">Blocked</option><option value="COMPLETED">Ready / exported</option></select></label><strong>{visible.length.toLocaleString()} shown</strong>{(queueQuery || queueOwner !== "ALL" || queueSource !== "ALL" || queueStatus !== "ALL") && <button className="text-button" onClick={() => { setQueueQuery(""); setQueueOwner("ALL"); setQueueSource("ALL"); setQueueStatus("ALL"); }}>Clear filters</button>}</div>
      {selected.length > 0 && <div className="priority-actions"><b>{selected.length} selected</b>{reviewableSelected.length > 0 && <button className="primary priority-start-now" onClick={() => onStart(reviewableSelected)}><WandSparkles size={14} />Claim &amp; review {reviewableSelected.length}</button>}<details className="priority-more"><summary><MoreHorizontal size={16} />Assignment &amp; status</summary><div>{assignable.length > 0 && <div className="priority-assign-control"><label>Assign to<select value={assignmentTarget} onChange={(event) => setAssignmentTarget(event.target.value)}><option value="" disabled>Choose teammate</option><option value="__UNASSIGNED__">Unassigned / everyone</option>{teamMembers.map((member) => <option key={member} value={member}>{member}</option>)}</select></label><button className={assignmentTarget === "__UNASSIGNED__" ? "secondary" : "primary"} disabled={!assignmentTarget} onClick={() => { const release = assignmentTarget === "__UNASSIGNED__"; onUpdate(assignable, release ? "UNASSIGNED" : "ASSIGNED", release ? undefined : assignmentTarget); setSelected(assignable); setQueueOwner(release ? "UNASSIGNED" : assignmentTarget); setQueueStatus("ALL"); }}>{assignmentTarget === "__UNASSIGNED__" ? <RotateCcw size={14} /> : <Users size={14} />}{assignmentTarget === "__UNASSIGNED__" ? "Unassign" : "Assign"}</button></div>}<div className="priority-status-control"><select value={bulkStatus} onChange={(event) => setBulkStatus(event.target.value as PriorityQueueStatus)}><option value="UNASSIGNED">Available</option><option value="ASSIGNED">Assigned</option><option value="IN_REVIEW">In progress</option><option value="BLOCKED">Blocked</option><option value="COMPLETED">Ready for export</option></select><button className="secondary" onClick={() => onUpdate(selected, bulkStatus, bulkStatus === "ASSIGNED" ? assignmentTarget : undefined)}>Apply status</button></div>{mineSelected.length > 0 && <button className="secondary" onClick={() => onStart(mineSelected)}><WandSparkles size={14} />Review my selection</button>}{selectedItems.some((item) => item.status === "COMPLETED") && <button className="secondary" onClick={() => onAdminDone(selected)}><ShieldCheck size={14} />Done in Admin · verify later</button>}<button className="secondary priority-restart" title="Clear owner, progress, completion, and final result" onClick={() => { onReset(selected); setSelected([]); setQueueOwner("UNASSIGNED"); setQueueStatus("ALL"); }}><RotateCcw size={14} />Release / start over</button><button className={`secondary priority-remove ${removeArmed ? "armed" : ""}`} title="Permanently remove these items from the High Priority Queue" onClick={() => { if (!removeArmed) { setRemoveArmed(true); return; } onRemove(selected); setSelected([]); }}><Trash2 size={14} />{removeArmed ? "Confirm remove" : "Remove from queue"}</button></div></details><button className="icon-button" onClick={() => setSelected([])}><X size={14} /></button></div>}
      <div className="priority-table"><div><input type="checkbox" checked={visible.length > 0 && withinSelectionLimit(visible).every((item) => selected.includes(item.id))} onChange={(event) => setSelected(event.target.checked ? withinSelectionLimit(visible).map((item) => item.id) : [])} /><b>Brand</b><b>Source</b><b>Owner</b><b>Status</b><b>Final result & history</b></div>{visible.slice(0, 100).map((item) => { const staleItem = item.status !== "COMPLETED" && Boolean(item.assignedAt) && new Date(item.updatedAt).getTime() < staleCutoff; const statusLabel = item.exportedAt ? "EXPORTED" : item.status === "COMPLETED" ? "READY FOR EXPORT" : item.status === "UNASSIGNED" ? "AVAILABLE" : item.status.replace("_", " "); return <div key={item.id}><input type="checkbox" disabled={!selected.includes(item.id) && Boolean(maxSelection && selected.length >= maxSelection)} checked={selected.includes(item.id)} onChange={(event) => setSelected(event.target.checked ? withinSelectionLimit([...new Set([...selected, item.id])]) : selected.filter((id) => id !== item.id))} /><span><b>{item.name}</b><small>{item.brandId}</small>{staleItem && <small className="queue-stale"><FileClock size={10} />No activity for 3+ days</small>}</span><em>{item.source}</em><span>{item.assignedTo || (item.status === "COMPLETED" ? "Unassigned" : "Available to claim")}</span>{item.assignedTo === currentUser && item.status !== "COMPLETED" ? <select value={item.status} onChange={(event) => onUpdate([item.id], event.target.value as PriorityQueueStatus)}><option value="ASSIGNED">Assigned</option><option value="IN_REVIEW">In progress</option><option value="BLOCKED">Blocked</option><option value="COMPLETED">Ready for export</option></select> : <strong className={`queue-status ${item.exportedAt ? "exported" : item.status.toLowerCase()}`}>{statusLabel}</strong>}<span className="queue-result">{item.finalAction ? <><ActionPill action={item.finalAction} /><small>{item.finalAction === "MERGE" ? `${item.finalTargetName || "Target"} · ${item.finalTargetId || "Missing ID"}` : item.finalAction === "CREATE" ? item.finalTargetName || item.name : "No target brand"}</small></> : <small>{item.status === "COMPLETED" ? "Reviewed result recorded" : "Not yet ready for Step 3"}</small>}{item.exportedAt && <small className="queue-export-meta">Uploaded by {item.exportedBy} · {fmtDate(item.exportedAt)}</small>}{item.activity?.length ? <details className="queue-history"><summary><History size={11} />Activity ({item.activity.length})</summary><div>{item.activity.slice(0, 8).map((event) => <p key={event.id}><b>{event.message}</b><small>{event.by} · {fmtDate(event.at)} {fmtTime(event.at)}</small></p>)}</div></details> : null}</span></div>; })}</div>{visible.length > 100 && <p className="preview-more">Showing the first 100 of {visible.length.toLocaleString()} rows</p>}</>}
  </section>;
}

function Imports({ cleanMode, batches, activeBatchId, priorityQueue, currentUser, pinnedQueueIds, teamMembers, onChooseTeamMember, onTogglePin, syncConnected, savePending, saveBusy, saveCountdown, lastSavedAt, onSave, onImport, onAddPriority, onUpdatePriority, onResetPriority, onRemovePriority, onAdminDone, onStartPriority, onNavigate, onRestart, ubqSource }: { cleanMode?: boolean; batches: ImportBatch[]; activeBatchId?: string; priorityQueue: PriorityQueueItem[]; currentUser: string; pinnedQueueIds: string[]; teamMembers: string[]; onChooseTeamMember: (member: string) => void; onTogglePin: (id: string) => void; syncConnected: boolean; savePending: boolean; saveBusy: boolean; saveCountdown: number; lastSavedAt?: string; onSave: () => void; onImport: (name: string, rows: ReturnType<typeof parseCsv>) => void; onAddPriority: (source: PriorityQueueSource, rows: ReturnType<typeof parseCsv>) => void; onUpdatePriority: (ids: string[], status: PriorityQueueStatus, assignee?: string) => void; onResetPriority: (ids: string[]) => void; onRemovePriority: (ids: string[]) => void; onAdminDone: (ids: string[]) => void; onStartPriority: (ids: string[]) => void; onNavigate: (v: View) => void; onRestart: () => void; ubqSource: UbqSource | null }) {
  const input = useRef<HTMLInputElement>(null); const priorityInput = useRef<HTMLInputElement>(null); const destination = useRef<"validate" | "queue">("validate"); const [drag, setDrag] = useState(false); const [error, setError] = useState(""); const [brandNames, setBrandNames] = useState(""); const [priorityNames, setPriorityNames] = useState(""); const [pasteFormat, setPasteFormat] = useState<"names" | "spreadsheet">("names"); const [priorityPasteFormat, setPriorityPasteFormat] = useState<"names" | "spreadsheet">("names"); const [inputMode, setInputMode] = useState<"csv" | "paste" | "priority">("csv"); const [queueOpen, setQueueOpen] = useState(false); const [cleanChoice, setCleanChoice] = useState<"add" | "queue" | null>(null);
  const overLimit = (count: number) => Boolean(cleanMode && count > MAX_WORKLIST_SIZE);
  function accept(file?: File, target = destination.current) { if (!file) return; if (!file.name.toLowerCase().endsWith(".csv")) { setError("Please choose a CSV file."); return; } const reader = new FileReader(); reader.onload = () => { const rows = parseCsv(String(reader.result)); if (!rows.length) setError("No brand rows found. Include UnmappedBrandID and UnmappedBrandName columns."); else if (overLimit(rows.length)) setError(`Add no more than ${MAX_WORKLIST_SIZE} brands in Clean View, or switch to Advanced View.`); else { setError(""); if (target === "queue") onAddPriority("CSV", rows); else onImport(file.name, rows); } }; reader.readAsText(file); }
  function drop(e: DragEvent) { e.preventDefault(); setDrag(false); accept(e.dataTransfer.files[0], "validate"); }
  const pastedRows = useMemo(() => parsePastedBrands(brandNames, pasteFormat), [brandNames, pasteFormat]);
  const pastedNames = pastedRows.map((row) => row.name);
  const pastedIdCount = pastedRows.filter((row) => row.id.startsWith("draft_brand_")).length;
  const priorityPastedRows = useMemo(() => parsePastedBrands(priorityNames, priorityPasteFormat), [priorityNames, priorityPasteFormat]);
  const queueCounts = getPriorityQueueCounts(priorityQueue, currentUser);
  const queueTotal = queueCounts.active;
  const queueAvailable = queueCounts.available;
  const queueMine = queueCounts.mineOpen;
  const queueExported = queueCounts.exported;
  const ownerCounts = [...priorityQueue.filter((item) => isActivePriorityTask(item) && item.assignedTo && item.status !== "COMPLETED").reduce((counts, item) => counts.set(item.assignedTo!, (counts.get(item.assignedTo!) || 0) + 1), new Map<string, number>()).entries()].sort((left, right) => right[1] - left[1]);
  const ownerSummary = ownerCounts.length ? ownerCounts.map(([owner, count]) => `${owner}: ${count}`).join(" · ") : "No brands are currently assigned";
  function validatePasted() { onImport("pasted-brand-list.csv", pastedRows); }
  const storedBatch = activeBatchId ? batches.find((batch) => batch.id === activeBatchId && !batch.archivedAt && batch.owner === currentUser) : undefined;
  const currentBatch = storedBatch ? triageWorklistForMode(storedBatch, Boolean(cleanMode), MAX_WORKLIST_SIZE) : undefined;
  const waitingCount = storedBatch ? Math.max(0, storedBatch.records.filter(isActiveTriageRecord).length - (currentBatch?.records.length || 0)) : 0;
  const currentCounts = getTriageCounts(currentBatch?.records || []);
  const currentReadiness = currentBatch ? getBulkExportReadiness(currentBatch.records.filter((record) => record.adminUploadStatus !== "SUCCESS" && !record.excludedFromExport && !record.triageResolution)) : undefined;
  const currentOutputReady = Boolean(currentBatch && currentBatch.workflowSource !== "ROOT" && currentReadiness?.ready && !currentBatch.records.some((record) => record.blockedByTargetCreation));
  const resumeDestination = currentBatch ? resolveWorkflowCheckpoint(undefined, currentBatch) : undefined;
  return <>{!cleanMode && <WorkflowStepper stage={1} onNavigate={onNavigate} onRestart={onRestart} hasImport={Boolean(currentBatch)} outputReady={currentOutputReady} owner={currentBatch?.owner || currentUser || "Shared team"} counts={currentCounts} basketRecords={currentBatch?.records || []} />}
    <PageHead eyebrow={cleanMode ? "STEP 1 OF 3" : "FIRST STEP · TEAM VIEW"} title={cleanMode ? "Start by adding or picking brands" : "What would you like to review?"} body={cleanMode ? `Choose one clear path below. Every worklist is limited to ${MAX_WORKLIST_SIZE} brands.` : "Advanced View has no batch limit. Upload, paste, or claim the complete worklist you need."} />
    {cleanMode && <section className="step1-choice-grid" aria-label="Choose how to start Step 1">
      <section className="step1-choice-card add step1-add-tile">
        <div className="step1-add-tile-head"><span className="step1-choice-number">1</span><span><small>ADD NEW WORK</small><b>Add 1–{MAX_WORKLIST_SIZE} brands</b><p>Choose names only, spreadsheet rows, or a CSV file.</p></span><strong className={pastedNames.length > MAX_WORKLIST_SIZE ? "limit-exceeded" : ""}>{pastedNames.length} / {MAX_WORKLIST_SIZE}</strong></div>
        <div className="paste-format-choice" aria-label="Choose paste format"><button className={pasteFormat === "names" ? "active" : ""} onClick={() => setPasteFormat("names")}><Tags size={13} />Names only</button><button className={pasteFormat === "spreadsheet" ? "active" : ""} onClick={() => setPasteFormat("spreadsheet")}><Boxes size={13} />Spreadsheet rows</button></div>
        <textarea aria-label="Brands to add" disabled={Boolean(currentBatch)} value={brandNames} onChange={(event) => setBrandNames(event.target.value)} placeholder={pasteFormat === "names" ? "One brand per line…\n\nservice\nacoustic audio\nmcfortywiner" : "Paste spreadsheet rows…\n\noriginal audi\t314\t16\t\t\t\t\t\tYes\tdraft_brand_FkeBqmfmiEmpEUxPWvbmD1"} />
        <div className="step1-add-tile-meta"><span className={currentUser ? "ready" : "missing"}><Users size={13} />{currentUser ? <>Assigned to <b>{currentUser}</b></> : "Choose Working as first"}</span>{pastedRows.length > 0 && <span className={pasteFormat === "names" || pastedIdCount === pastedRows.length ? "ready" : "missing"}>{pasteFormat === "names" ? <Tags size={13} /> : pastedIdCount === pastedRows.length ? <Check size={13} /> : <CircleHelp size={13} />}{pasteFormat === "names" ? `${pastedRows.length} names ready · IDs optional` : `${pastedIdCount} of ${pastedRows.length} Brand IDs detected`}</span>}</div>
        <div className="step1-add-tile-actions">
          <input ref={input} type="file" accept=".csv,text/csv" hidden onChange={(event: ChangeEvent<HTMLInputElement>) => { accept(event.target.files?.[0]); event.target.value = ""; }} />
          {currentBatch ? <button className="primary" onClick={onRestart}><RotateCcw size={15} />Start over to add brands</button> : <><button className="secondary" onClick={() => { destination.current = "validate"; input.current?.click(); }}><FileUp size={15} />Add CSV</button><button className="primary" disabled={!currentUser || !pastedNames.length || pastedNames.length > MAX_WORKLIST_SIZE} onClick={validatePasted}><WandSparkles size={15} />Add &amp; review{pastedNames.length ? ` ${pastedNames.length}` : ""}</button></>}
        </div>
      </section>
      <button className={`step1-choice-card queue ${cleanChoice === "queue" ? "selected" : ""}`} aria-pressed={cleanChoice === "queue"} onClick={() => { setCleanChoice("queue"); setQueueOpen(true); }}>
        <span className="step1-choice-number">2</span><span className="step1-choice-icon"><Users size={30} /></span>
        <span className="step1-choice-copy"><small>SHARED TEAM WORK</small><b>Check Team Queue</b><p>Select brands already added by the team.</p><em>{queueTotal ? `${queueTotal} brand${queueTotal === 1 ? "" : "s"} in the queue · ${queueAvailable} available` : "The Team Queue is empty"}</em></span>
        <span className="step1-queue-count"><b>{queueTotal}</b><small>IN QUEUE</small></span>
        <span className="step1-choice-action">Open Team Queue <ChevronRight size={18} /></span>
      </button>
    </section>}
    {cleanMode && currentBatch && resumeDestination && resumeDestination !== "imports" && <section className="clean-resume"><span><FileClock size={23} /></span><div><small>SAVED CHECKPOINT · MAXIMUM {MAX_WORKLIST_SIZE}</small><h2>Continue where you stopped</h2><p>{currentCounts.inReview ? `${currentCounts.inReview} decision${currentCounts.inReview === 1 ? " needs" : "s need"} review` : `${currentCounts.ready} brand${currentCounts.ready === 1 ? " is" : "s are"} ready to finish`}{waitingCount ? ` · ${waitingCount} more waiting for the next worklist` : ""}.</p></div><button className="primary" onClick={() => onNavigate(resumeDestination)}>Resume {resumeDestination === "output" ? "Finish" : "Review"}<ChevronRight size={16} /></button></section>}
    {!cleanMode && <section className={`team-queue-launcher ${queueOpen ? "open" : ""}`}><div className="team-queue-launcher-icon"><Activity size={22} /></div><div className="team-queue-launcher-copy"><small>SHARED TEAM WORK</small><h2>High Priority Brand Queue</h2><p>{!currentUser ? "Open the queue and choose your name before claiming work." : queueCounts.mineTotal ? `${queueCounts.mineOpen} to review and ${queueCounts.mineReady} ready for ${currentUser}.` : `No active tasks belong to ${currentUser}; ${queueAvailable} are available to claim.`}</p><em>{ownerSummary}</em></div><div className="team-queue-launcher-stats"><span><b>{queueAvailable}</b><small>Available</small></span><span><b>{queueMine}</b><small>{currentUser ? `${currentUser} reviewing` : "Choose your name"}</small></span><span><b>{queueCounts.mineReady}</b><small>{currentUser ? `${currentUser} ready` : "Ready"}</small></span><span><b>{queueExported}</b><small>Exported</small></span></div><button className={queueOpen ? "secondary" : "primary"} onClick={() => setQueueOpen((open) => !open)}>{queueOpen ? <ChevronUp size={15} /> : <ChevronDown size={15} />}{queueOpen ? "Hide team queue" : "Open team queue"}</button></section>}
    {queueOpen && (!cleanMode || cleanChoice === "queue") && <div className="team-queue-expanded">{cleanMode && <div className="step1-expanded-head"><span><Users size={20} /></span><div><small>OPTION 2 · TEAM QUEUE</small><b>{queueTotal} brand{queueTotal === 1 ? "" : "s"} in the queue</b><p>{queueAvailable} available · select up to {MAX_WORKLIST_SIZE}, then claim and review.</p></div><button className="secondary" onClick={() => { setQueueOpen(false); setCleanChoice(null); }}><X size={15} />Close</button></div>}<PriorityQueue items={priorityQueue} currentUser={currentUser} pinnedQueueIds={pinnedQueueIds} teamMembers={teamMembers} maxSelection={cleanMode ? MAX_WORKLIST_SIZE : undefined} onChooseTeamMember={onChooseTeamMember} onTogglePin={onTogglePin} syncConnected={syncConnected} savePending={savePending} saveBusy={saveBusy} saveCountdown={saveCountdown} lastSavedAt={lastSavedAt} onSave={onSave} onUpdate={onUpdatePriority} onReset={onResetPriority} onRemove={onRemovePriority} onAdminDone={onAdminDone} onStart={onStartPriority} onNavigate={onNavigate} /></div>}
    <div className={`input-divider ${cleanMode ? "clean-choice-hidden" : ""}`}><span>ADD A NEW LIST</span></div>
    <section className={`compact-import ${inputMode === "priority" ? "priority-intake-open" : ""} ${cleanMode && cleanChoice === "add" ? "clean-add-open" : ""} ${cleanMode && cleanChoice !== "add" ? "clean-choice-hidden" : ""}`}>{cleanMode && <div className="step1-expanded-head"><span><FileUp size={20} /></span><div><small>OPTION 1 · ADD BRANDS</small><b>Add 1–{MAX_WORKLIST_SIZE} brands</b><p>Paste names directly or add a CSV file.</p></div><button className="secondary" onClick={() => setCleanChoice(null)}><X size={15} />Close</button></div>}
      {cleanMode ? <div className="clean-add-composer">
        <div className="clean-add-label">
          <div><b>{pasteFormat === "names" ? "Paste brand names" : "Paste spreadsheet rows"}</b><small>{pasteFormat === "names" ? "One name per line. Brand IDs are optional and can be found from UBQ later." : "Brandmaster keeps the brand name and Unmapped Brand ID. Other columns are ignored."}</small></div>
          <strong className={pastedNames.length > MAX_WORKLIST_SIZE ? "limit-exceeded" : ""}>{pastedNames.length} / {MAX_WORKLIST_SIZE}</strong>
        </div>
        <div className="paste-format-choice" aria-label="Choose paste format"><button className={pasteFormat === "names" ? "active" : ""} onClick={() => setPasteFormat("names")}><Tags size={13} />Names only</button><button className={pasteFormat === "spreadsheet" ? "active" : ""} onClick={() => setPasteFormat("spreadsheet")}><Boxes size={13} />Spreadsheet rows</button></div>
        <textarea autoFocus value={brandNames} onChange={(e) => setBrandNames(e.target.value)} placeholder={pasteFormat === "names" ? `Paste up to ${MAX_WORKLIST_SIZE} brands, one per line…\n\nservice\nacoustic audio\nmcfortywiner` : `Paste up to ${MAX_WORKLIST_SIZE} spreadsheet rows…\n\noriginal audi\t314\t16\t\t\t\t\t\tYes\tdraft_brand_FkeBqmfmiEmpEUxPWvbmD1`} />
        <div className="clean-add-guidance">
          <span className={currentUser ? "ready" : "missing"}><Users size={14} />{currentUser ? <>Will be assigned to <b>{currentUser}</b></> : <>Choose a user in <b>Working as</b> before continuing</>}</span>
          <span className={pasteFormat === "names" || pastedRows.length && pastedIdCount === pastedRows.length ? "ready" : ubqSource ? "ready" : "missing"}>{pasteFormat === "names" ? <Tags size={14} /> : pastedRows.length && pastedIdCount === pastedRows.length ? <Check size={14} /> : ubqSource ? <Check size={14} /> : <CircleHelp size={14} />}{pasteFormat === "names" ? `${pastedRows.length} names ready · IDs will be found later when available` : pastedRows.length ? `${pastedIdCount} of ${pastedRows.length} IDs detected; extra columns ignored` : ubqSource ? "Brand IDs will be matched automatically" : "Paste IDs or configure UBQ matching"}</span>
        </div>
        <div className="clean-add-actions">
          <input ref={input} type="file" accept=".csv,text/csv" hidden onChange={(e: ChangeEvent<HTMLInputElement>) => { accept(e.target.files?.[0]); e.target.value = ""; }} />
          <button className="secondary clean-csv-button" onClick={() => { destination.current = "validate"; input.current?.click(); }}><FileUp size={16} />Add CSV file</button>
          <button className="text-button" onClick={() => download("brandmaster-template.csv", "UnmappedBrandID,UnmappedBrandName,Seller Count\n")}><ArrowDownToLine size={14} />Download CSV template</button>
          <button className="primary clean-add-review" disabled={!currentUser || !pastedNames.length || pastedNames.length > MAX_WORKLIST_SIZE} onClick={validatePasted}><WandSparkles size={16} />Add &amp; review{pastedNames.length ? ` ${pastedNames.length}` : ""}</button>
        </div>
      </div> : <>
        <div className="input-mode-tabs"><div><button className={inputMode === "csv" ? "active" : ""} onClick={() => setInputMode("csv")}><FileUp size={15} />Upload CSV</button><button className={inputMode === "paste" ? "active" : ""} onClick={() => setInputMode("paste")}><WandSparkles size={15} />Paste brands</button><button className={`priority-input-tab ${inputMode === "priority" ? "active" : ""}`} onClick={() => setInputMode("priority")}><Activity size={15} /><span>High Priority Queue<small>TEAM INTAKE</small></span></button></div><button className="text-button" onClick={() => download("brandmaster-template.csv", "UnmappedBrandID,UnmappedBrandName,Seller Count\n")}><ArrowDownToLine size={13} />Template</button></div>
        {inputMode === "csv" ? <div className={`dropzone compact ${drag ? "drag" : ""}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={drop} onClick={() => { destination.current = "validate"; input.current?.click(); }}><input ref={input} type="file" accept=".csv,text/csv" hidden onChange={(e: ChangeEvent<HTMLInputElement>) => { accept(e.target.files?.[0]); e.target.value = ""; }} /><div className="drop-icon"><UploadCloud size={23} /></div><div><h2>Drop CSV or click to browse</h2><p>Brand ID + Brand Name · no batch limit in Advanced View</p></div><button className="primary" onClick={(event) => { event.stopPropagation(); destination.current = "validate"; input.current?.click(); }}>Choose & validate</button></div> : inputMode === "paste" ? <div className="compact-paste"><div className="paste-format-choice" aria-label="Choose paste format"><button className={pasteFormat === "names" ? "active" : ""} onClick={() => setPasteFormat("names")}><Tags size={13} />Names only</button><button className={pasteFormat === "spreadsheet" ? "active" : ""} onClick={() => setPasteFormat("spreadsheet")}><Boxes size={13} />Spreadsheet rows</button></div><textarea value={brandNames} onChange={(e) => setBrandNames(e.target.value)} placeholder={pasteFormat === "names" ? "One brand per line…\nservice\nacoustic audio\nmcfortywiner" : "Paste spreadsheet rows…\noriginal audi\t314\t16\t\t\t\t\t\tYes\tdraft_brand_FkeBqmfmiEmpEUxPWvbmD1"} /><div className="compact-paste-footer"><div className={`id-mini ${pastedRows.length && pastedIdCount === pastedRows.length ? "ready" : ubqSource ? "ready" : ""}`}>{pasteFormat === "names" ? <Tags size={12} /> : pastedRows.length && pastedIdCount === pastedRows.length ? <Check size={12} /> : ubqSource ? <Check size={12} /> : <CircleHelp size={12} />}{pasteFormat === "names" ? "Names only · IDs optional" : pastedRows.length ? `${pastedIdCount} IDs detected` : ubqSource ? "UBQ IDs ready" : "Paste IDs or configure UBQ"}</div>{pasteFormat === "spreadsheet" && !ubqSource && !pastedIdCount && <button className="text-button" onClick={() => onNavigate("settings")}>Configure in Validation modules →</button>}<span>{pastedNames.length.toLocaleString()} brands{pasteFormat === "spreadsheet" ? " · extra columns ignored" : ""}</span><button className="primary" disabled={!pastedNames.length} onClick={validatePasted}><WandSparkles size={15} />Validate now</button></div></div> : <div className="priority-intake"><div className="priority-intake-head"><span><Activity size={20} /></span><div><small>SHARED TEAM INTAKE</small><h2>Add urgent brands for the team</h2><p>Add any number of brands. They enter the Available queue without starting validation or assigning an owner.</p></div></div><div className="priority-intake-grid"><button className="priority-upload-card" onClick={() => priorityInput.current?.click()}><input ref={priorityInput} type="file" accept=".csv,text/csv" hidden onChange={(event) => { accept(event.target.files?.[0], "queue"); event.target.value = ""; }} /><span><FileUp size={22} /></span><b>Upload urgent-brand CSV</b><small>No batch limit</small><em>Choose CSV</em></button><div className="priority-paste-card"><label><b>Paste urgent brands</b><small>Choose names only or spreadsheet rows · no batch limit</small></label><div className="paste-format-choice" aria-label="Choose priority paste format"><button className={priorityPasteFormat === "names" ? "active" : ""} onClick={() => setPriorityPasteFormat("names")}><Tags size={13} />Names only</button><button className={priorityPasteFormat === "spreadsheet" ? "active" : ""} onClick={() => setPriorityPasteFormat("spreadsheet")}><Boxes size={13} />Spreadsheet rows</button></div><textarea value={priorityNames} onChange={(event) => setPriorityNames(event.target.value)} placeholder={priorityPasteFormat === "names" ? "service\nacoustic audio\nmcfortywiner" : "original audi\t314\t16\t\t\t\t\t\tYes\tdraft_brand_FkeBqmfmiEmpEUxPWvbmD1"} /><div><span>{priorityPastedRows.length.toLocaleString()} brands · {priorityPastedRows.filter((row) => row.id.startsWith("draft_brand_")).length} IDs</span><button className="priority" disabled={!priorityPastedRows.length} onClick={() => { onAddPriority("PASTE", priorityPastedRows); setPriorityNames(""); }}><Activity size={14} />Add to High Priority Queue</button></div></div></div></div>}
      </>}
    </section>{error && <div className="error-banner"><CircleHelp size={17} />{error}</div>}
    {batches.length > 0 && <div className="imports-page-history-link"><button className="text-button" onClick={() => onNavigate("artifacts")}><Archive size={14} />View import history in Data & artifacts →</button></div>}
  </>;
}

function AiReviewAssist({ records, knownBrandIds, onUpdate, initiallyOpen = false, selectionMode = false, onClose }: { records: BrandRecord[]; knownBrandIds: Set<string>; onUpdate: (id: string, changes: Partial<BrandRecord>, learn?: boolean) => void; initiallyOpen?: boolean; selectionMode?: boolean; onClose?: () => void }) {
  const [open, setOpen] = useState(initiallyOpen); const [copied, setCopied] = useState(false); const [response, setResponse] = useState(""); const [result, setResult] = useState<ReturnType<typeof parseAiReviewJson> | null>(null); const jsonInput = useRef<HTMLInputElement>(null);
  const reviewableRecords = useMemo(() => records.filter((record) => record.workflowSource === "ROOT" || record.id.startsWith("draft_brand_")), [records]);
  const excludedMissingIds = records.length - reviewableRecords.length;
  const requestId = useMemo(() => aiReviewRequestId(reviewableRecords), [reviewableRecords]);
  const prompt = useMemo(() => buildAiReviewPrompt(reviewableRecords), [reviewableRecords]);
  useEffect(() => { setResponse(""); setResult(null); }, [requestId]);
  async function copyPrompt() { await navigator.clipboard.writeText(prompt); setCopied(true); setTimeout(() => setCopied(false), 1800); }
  function setJson(value: string) { setResponse(value); setResult(null); }
  async function importJson(file?: File) { if (!file) return; if (file.size > 5_000_000) { setResult({ changes: [], errors: ["JSON files must be 5 MB or smaller."] }); return; } setJson(await file.text()); }
  function validate() { setResult(parseAiReviewJson(response, reviewableRecords, knownBrandIds)); }
  function apply() {
    if (!result || result.errors.length) return;
    result.changes.forEach((change) => onUpdate(change.recordId, {
      action: change.action, targetId: change.targetId, targetName: change.targetName, confidence: change.confidence,
      reason: change.reason, evidence: ["Imported external AI suggestion — human confirmation required", ...change.evidence], decisionSource: "AI suggestion", blockedByTargetCreation: false, mergeOverride: false, status: "needs-review",
    }, false));
    setResponse(""); setResult(null); setOpen(false);
    onClose?.();
  }
  return <section className={`ai-review ${open ? "open" : ""}`}>
    <div className="ai-review-head"><div className="gpt-icon"><Sparkles size={18} /></div><div><span>OPTIONAL EXTERNAL AI REVIEW</span><b>{selectionMode ? `Review ${reviewableRecords.length} selected decision${reviewableRecords.length === 1 ? "" : "s"} with your validation GPT` : `Check ${reviewableRecords.length} decision${reviewableRecords.length === 1 ? "" : "s"} with your validation GPT`}</b><p>Brandmaster generates a batch-locked prompt and safely imports only its matching JSON. No API key is stored here.</p></div><button className={open ? "secondary" : "primary"} disabled={!reviewableRecords.length} onClick={() => { if (open && onClose) onClose(); else setOpen(!open); }}>{open ? <X size={15} /> : <Sparkles size={15} />}{open ? "Close" : "Check with AI validator"}</button></div>
    {open && <div className="ai-review-body">
      {excludedMissingIds > 0 && <div className="ai-review-id-warning"><CircleHelp size={16} /><span><b>{excludedMissingIds} row{excludedMissingIds === 1 ? " is" : "s are"} excluded from AI review</b><small>Resolve each missing UBQ ID in the table first. Placeholder missing_id values can never be imported.</small></span></div>}
      <div className="ai-review-step"><div className="step-number">1</div><div className="ai-review-content"><div className="ai-review-title"><div><h3>Generate the validator prompt</h3><p>Request <code>{requestId}</code> locks the response to these {reviewableRecords.length} brands.</p></div><div><button className="secondary" onClick={() => download("brandmaster-ai-review-prompt.txt", prompt)}><ArrowDownToLine size={14} />Download</button><button className="primary" onClick={copyPrompt}>{copied ? <Check size={14} /> : <BookOpen size={14} />}{copied ? "Copied" : "Copy prompt"}</button></div></div><textarea className="prompt-preview" value={prompt} readOnly /></div></div>
      <div className="ai-review-step"><div className="step-number">2</div><div className="ai-review-content"><div className="ai-review-title"><div><h3>Paste or import the returned JSON</h3><p>Paste the raw response or select the JSON file created by your validator.</p></div><div><input ref={jsonInput} type="file" accept=".json,application/json" hidden onChange={(event) => { void importJson(event.target.files?.[0]); event.target.value = ""; }} /><button className="secondary" onClick={() => jsonInput.current?.click()}><FileUp size={14} />Import JSON</button></div></div><textarea className="json-response" value={response} onChange={(event) => setJson(event.target.value)} placeholder={'{"schemaVersion":"brandmaster.ai-review.v1","decisions":[...]}'}/><div className="json-actions"><span>{response ? `${response.length.toLocaleString()} characters ready` : "Waiting for validator JSON"}</span><button className="primary" disabled={!response.trim()} onClick={validate}><ShieldCheck size={14} />Validate AI response</button></div></div></div>
      {result && <div className={`ai-review-result ${result.errors.length ? "invalid" : "valid"}`}><div className="step-number">3</div><div className="ai-review-content"><div className="result-summary">{result.errors.length ? <X size={18} /> : <Check size={18} />}<div><h3>{result.errors.length ? (result.errors[0]?.startsWith("This JSON") ? "Wrong AI review response" : "JSON needs correction") : `${result.changes.length} suggestions passed safety checks`}</h3><p>{result.errors.length ? "Nothing will be applied. Copy the current prompt again when the response belongs to another batch or selection." : "Apply these as suggestions. Every row will remain in Needs review until a person confirms it."}</p></div></div>{result.errors.length > 0 ? <ul className="json-errors">{result.errors.slice(0, 10).map((error) => <li key={error}>{error}</li>)}{result.errors.length > 10 && <li>And {result.errors.length - 10} more errors…</li>}</ul> : <><div className="ai-result-table"><div><b>Brand</b><b>Suggested action</b><b>Confidence</b><b>Target / reason</b></div>{result.changes.slice(0, 20).map((change) => { const record = reviewableRecords.find((item) => item.id === change.recordId)!; return <div key={change.recordId}><span>{record.name}</span><ActionPill action={change.action} /><b>{change.confidence}%</b><span>{change.targetName ? `${change.targetName}${change.targetId ? ` · ${change.targetId}` : ""}` : change.reason}</span></div>; })}</div>{result.changes.length > 20 && <p className="preview-more">Plus {result.changes.length - 20} additional validated suggestions</p>}<button className="primary apply-ai" onClick={apply}><Check size={15} />Apply {result.changes.length} as suggestions</button></>}</div></div>}
    </div>}
  </section>;
}

function InlineReviewEditor({ record, brands, rootMode = false, onCancel, onFullReview, onSave }: { record: BrandRecord; brands: CatalogBrand[]; rootMode?: boolean; onCancel: () => void; onFullReview: () => void; onSave: (id: string, changes: Partial<BrandRecord>, learn?: boolean) => void }) {
  const [unmappedId, setUnmappedId] = useState(record.id.startsWith("missing_id_") ? "" : record.id);
  const [action, setAction] = useState<Action>(record.action);
  const [targetId, setTargetId] = useState(record.targetId || "");
  const [targetName, setTargetName] = useState(record.targetName || record.normalized);
  const [targetQuery, setTargetQuery] = useState(record.targetId || record.targetName || record.normalized);
  const [createOverride, setCreateOverride] = useState(false);
  const validId = rootMode ? unmappedId.startsWith("brand_") : unmappedId.startsWith("draft_brand_");
  const existingCreateBrand = action === "CREATE" && !rootMode ? findExistingBrandByName(targetName, brands) : undefined;
  const valid = validId && (!existingCreateBrand || createOverride) && (action !== "MERGE" || (targetId.startsWith("brand_") && targetId !== unmappedId && Boolean(targetName.trim()))) && (action !== "CREATE" || Boolean(targetName.trim()));
  function changeAction(next: Action) {
    setAction(next);
    setCreateOverride(false);
    if (next === "CREATE") { setTargetId(""); setTargetName(record.normalized); }
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
    {action === "MERGE" && <SmartTargetPicker brands={brands} query={targetQuery} selectedId={targetId} onQuery={setTargetQuery} onSelect={(brand) => { setAction("MERGE"); setTargetId(brand.id); setTargetName(brand.name); setTargetQuery(brand.id); }} />}
    <label><span>{rootMode ? "Root BrandID" : "UnmappedBrandID"}</span><input value={unmappedId} readOnly={rootMode} onChange={(event) => setUnmappedId(event.target.value.trim())} placeholder={rootMode ? "brand_..." : "draft_brand_..."} /><small className={validId ? "valid" : "invalid"}>{validId ? (rootMode ? "Existing Root record" : "Valid ID") : `Required: ${rootMode ? "brand_" : "draft_brand_"}…`}</small></label>
    <label><span>{rootMode ? "Root recommendation" : "Action"}</span><select value={action} onChange={(event) => changeAction(event.target.value as Action)}>{(["MERGE", "CREATE", "SKIP", "DELETE"] as Action[]).map((item) => <option key={item} value={item}>{rootMode ? (item === "MERGE" ? "CONSOLIDATE" : item === "CREATE" ? "EDIT / KEEP" : item) : item}</option>)}</select></label>
    {action === "MERGE" && <label><span>TargetBrandID</span><input value={targetId} onChange={(event) => setTargetId(event.target.value.trim())} placeholder="brand_..." /></label>}
    {(action === "MERGE" || action === "CREATE") && <label><span>TargetBrandName</span><input value={targetName} onChange={(event) => { setTargetName(event.target.value); setCreateOverride(false); }} placeholder="Canonical brand name" /></label>}
  </div>{existingCreateBrand && <div className={`create-collision-warning ${createOverride ? "overridden" : ""}`}><CircleHelp size={16} /><span><b>{createOverride ? "Reviewer override: CREATE will be kept" : `Possible existing-brand conflict with ${existingCreateBrand.name}`}</b><small>{createOverride ? `You confirmed that ${targetName} is distinct from ${existingCreateBrand.name}. This override will be saved in review history.` : <>The catalog name or alias matched <code>{existingCreateBrand.id}</code>. Review the brands, then MERGE or explicitly keep CREATE.</>}</small></span><div className="create-collision-actions"><button onClick={() => { setAction("MERGE"); setTargetId(existingCreateBrand.id); setTargetName(existingCreateBrand.name); setCreateOverride(false); }}>Use MERGE</button><button onClick={() => setCreateOverride(!createOverride)}>{createOverride ? "Undo override" : "CREATE anyway"}</button></div></div>}<div className="inline-editor-actions"><span>{rootMode ? (action === "MERGE" ? "Choose the different canonical BrandID that should own this alias." : action === "CREATE" ? "Correct the canonical name, then perform the edit in Admin." : action === "DELETE" ? "This saves a persistent delete/block recommendation." : "No Root change will be recommended.") : action === "SKIP" || action === "DELETE" ? "Target fields will remain blank." : action === "CREATE" ? "TargetBrandID will remain blank. Brandmaster checks this name against existing brands." : "MERGE requires both target fields."}</span><button className="secondary" onClick={onCancel}>Cancel</button><button className="primary" disabled={!valid} onClick={save}><Check size={14} />{rootMode ? "Save task" : "Save row"}</button></div></div>;
}

function MissingIdFinder({ record, records, ubqRows, onSelect, onClose, onOpenSettings }: { record: BrandRecord; records: BrandRecord[]; ubqRows: ParsedRow[]; onSelect: (row: ParsedRow) => void; onClose: () => void; onOpenSettings: () => void }) {
  const [query, setQuery] = useState(record.name);
  const normalizedQuery = normalizeBrand(query).toLowerCase();
  const matches = useMemo(() => {
    const usedIds = new Set(records.filter((item) => item.id !== record.id && item.id.startsWith("draft_brand_")).map((item) => item.id));
    return ubqRows.map((row) => {
      const normalizedName = normalizeBrand(row.name).toLowerCase();
      const exact = normalizedName === normalizedQuery;
      const contains = normalizedName.includes(normalizedQuery) || normalizedQuery.includes(normalizedName);
      const score = exact ? 120 : contains ? 105 : matchCatalogBrand(query, { ...row, aliases: [], category: "Automotive", source: "Manual" }).score;
      return { row, score, exact, used: usedIds.has(row.id) };
    }).filter((item) => item.score >= 42).sort((left, right) => Number(right.exact) - Number(left.exact) || right.score - left.score).slice(0, 12);
  }, [normalizedQuery, query, record.id, records, ubqRows]);
  return <div className="modal-backdrop missing-id-backdrop" role="presentation" onMouseDown={onClose}><section className="missing-id-dialog" role="dialog" aria-modal="true" aria-labelledby="missing-id-title" onMouseDown={(event) => event.stopPropagation()}>
    <div className="missing-id-dialog-head"><span><Search size={22} /></span><div><small>UBQ ID LOOKUP</small><h2 id="missing-id-title">Find the ID for {record.name}</h2><p>Select the matching row from the latest uploaded UBQ. The current review decision will stay unchanged.</p></div><button className="icon-button" onClick={onClose} aria-label="Close ID finder"><X size={18} /></button></div>
    {ubqRows.length ? <><label className="missing-id-search"><Search size={16} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search brand name or draft_brand_ ID…" /></label><div className="missing-id-results">{matches.length ? matches.map(({ row, exact, score, used }) => <button key={row.id} disabled={used} onClick={() => onSelect(row)}><span><b>{row.name}</b><small>{used ? "Already used by another row" : exact ? "Exact normalized match" : score >= 92 ? "Strong match" : "Possible match"}</small></span><code>{row.id}</code><em>{used ? "Used" : "Use this ID"}</em></button>) : <div className="missing-id-empty"><CircleHelp size={22} /><b>No matching UBQ row found</b><p>Try fewer words. If the brand truly is absent from the latest UBQ, resolve it without mapping instead of inventing an ID.</p></div>}</div></> : <div className="missing-id-empty"><Database size={24} /><b>No UBQ file is loaded</b><p>Upload the latest full UBQ export before resolving missing IDs.</p><button className="primary" onClick={onOpenSettings}><FileUp size={15} />Open data sources</button></div>}
    <div className="missing-id-dialog-actions"><button className="secondary" onClick={onClose}>Cancel</button></div>
  </section></div>;
}

function ReviewQueue({ cleanMode, records, batch, brands, ubqRows, knownBrandIds, focusIds, onClearFocus, onUpdate, onResolveUbqId, onResolveWithoutMapping, onSelect, query, onNavigate, onRestart }: { cleanMode?: boolean; records: BrandRecord[]; batch?: ImportBatch; brands: CatalogBrand[]; ubqRows: ParsedRow[]; knownBrandIds: Set<string>; focusIds: string[]; onClearFocus: () => void; onUpdate: (id: string, changes: Partial<BrandRecord>, learn?: boolean) => void; onResolveUbqId: (id: string, row: ParsedRow) => void; onResolveWithoutMapping: (ids: string[], resolution: NonNullable<BrandRecord["triageResolution"]>, note?: string) => void; onSelect: (r: BrandRecord) => void; query: string; onNavigate: (view: View) => void; onRestart: () => void }) {
  const [filter, setFilter] = useState<"all" | "needs-review" | "ready">("all");
  const [actionFilter, setActionFilter] = useState<"ALL" | Action>("ALL");
  const [checked, setChecked] = useState<string[]>([]);
  const [aiReviewIds, setAiReviewIds] = useState<string[]>([]);
  const [inlineEditId, setInlineEditId] = useState<string | null>(null);
  const [idFinderRecord, setIdFinderRecord] = useState<BrandRecord | null>(null);
  const [resolutionDialog, setResolutionDialog] = useState<string[] | null>(null);
  const [resolutionReason, setResolutionReason] = useState<NonNullable<BrandRecord["triageResolution"]>>("NOT_FOUND_IN_UBQ");
  const [resolutionNote, setResolutionNote] = useState("");
  const activeRecords = records.filter(isActiveTriageRecord);
  const focusSet = new Set(focusIds);
  const focusedRecords = focusIds.length ? activeRecords.filter((record) => focusSet.has(record.id)) : activeRecords;
  const focusedReview = focusIds.length > 0;
  const visible = focusedRecords.filter((record) => {
    const statusVisible = filter === "all" || (filter === "needs-review" ? record.status === "needs-review" : record.status !== "needs-review");
    return statusVisible && (actionFilter === "ALL" || record.action === actionFilter) && `${record.name} ${record.normalized} ${record.action}`.toLowerCase().includes(query.toLowerCase());
  });
  const firstNeedsReviewId = visible.find((record) => record.status === "needs-review")?.id;
  const rootMode = batch?.workflowSource === "ROOT";
  const readiness = getBulkExportReadiness(activeRecords);
  const needs = readiness.needsReview.length;
  const unverified = rootMode ? 0 : readiness.invalidIds.length;
  const verified = activeRecords.length - unverified;
  const invalidMerges = readiness.incompleteMerges.length;
  const duplicateMappings = readiness.duplicateSourceMappings.length;
  const rootIncomplete = rootMode ? activeRecords.filter((record) => record.action === "MERGE" && (!record.targetId?.startsWith("brand_") || record.targetId === record.id || !record.targetName?.trim())).length : 0;
  const blockedFamilies = rootMode ? 0 : activeRecords.filter((record) => record.blockedByTargetCreation).length;
  const exportReady = rootMode ? needs === 0 && rootIncomplete === 0 : readiness.ready && blockedFamilies === 0 && duplicateMappings === 0;
  const ubqFamilyRecords = rootMode ? [] : activeRecords.filter((record) => record.relatedUbq?.length);
  const ubqFamilyGroups = new Set(ubqFamilyRecords.map((record) => record.ubqFamilyCanonicalId || record.id)).size;
  const staleMergedRows = ubqFamilyRecords.filter((record) => record.previouslyMergedStillPresent).length;
  function bulk(action?: Action) {
    const selectedIds = new Set(checked);
    const projected = activeRecords.map((record) => selectedIds.has(record.id) ? { ...record, action: action || record.action, status: "reviewed" as const, blockedByTargetCreation: false } : record);
    checked.forEach((id) => { const record = activeRecords.find((item) => item.id === id); if (record) onUpdate(id, { action: action || record.action, reason: action ? `Manually set to ${action}` : record.reason, blockedByTargetCreation: false }, true); });
    setChecked([]);
    setAiReviewIds([]);
    if (!rootMode && getBulkExportReadiness(projected).ready) setTimeout(() => onNavigate("output"), 0);
  }
  const triageCounts = getTriageCounts(records, rootMode);
  const intakeDecisions = batch?.intakeDecisions || [];
  const intakeImported = intakeDecisions.filter((item) => item.outcome === "IMPORTED").length;
  const intakeNotImported = intakeDecisions.length - intakeImported;
  const reviewReady = focusedRecords.filter((record) => record.status !== "needs-review").length;
  const blockingChecks = needs + unverified + (rootMode ? rootIncomplete : invalidMerges) + blockedFamilies + duplicateMappings;
  if (!records.length) return <><WorkflowStepper stage={2} onNavigate={onNavigate} /><PageHead eyebrow="STEP 2 OF 3" title="Process and review" body="Confirm recommendations before generating a file for the real bulk-upload tool." /><div className="panel"><EmptyState icon={FileClock} title="Import a CSV first" body="Start at step 1 with a CSV containing Brand ID and Brand Name." action={<button className="primary" onClick={() => onNavigate("imports")}>Go to Import CSV</button>} /></div></>;
  if (!activeRecords.length) return <><WorkflowStepper stage={2} onNavigate={onNavigate} onRestart={onRestart} hasImport counts={{ inBasket: 0, inReview: 0, ready: 0 }} /><PageHead eyebrow="TRIAGE COMPLETE" title="No mapping file is needed" body={`${records.length} item${records.length === 1 ? " was" : "s were"} closed as already completed, absent from UBQ, or otherwise not actionable.`} /><section className="nonmapping-complete"><Check size={34} /><h2>Triage cleared</h2><p>These outcomes were removed from the High Priority Queue and were not counted as mapped work in Analytics.</p><button className="primary" onClick={onRestart}><Plus size={15} />Start a new triage</button></section></>;
  const focusedNeeds = focusedRecords.filter((record) => record.status === "needs-review").length;
  return <>{!cleanMode && <WorkflowStepper stage={2} onNavigate={onNavigate} onRestart={onRestart} hasImport outputReady={exportReady} rootMode={rootMode} counts={triageCounts} />}<PageHead eyebrow={rootMode ? "ROOT CLEANUP · SECOND STEP" : cleanMode ? undefined : focusedReview ? "SECOND STEP · FOCUSED REVIEW" : "SECOND STEP · REVIEW"} title={rootMode ? "Review Root cleanup decisions" : cleanMode ? `Review ${focusedRecords.length} brand${focusedRecords.length === 1 ? "" : "s"}` : focusedReview ? `Review ${focusedRecords.length} selected brand${focusedRecords.length === 1 ? "" : "s"}` : "Review decisions"} body={cleanMode ? `${focusedNeeds} need${focusedNeeds === 1 ? "s" : ""} a decision · ${reviewReady} ready. Review the table, then continue directly below it.` : focusedReview ? "Only the rows returned from Step 3 are shown. The rest of the batch remains ready and unchanged." : needs ? `${needs} brand${needs === 1 ? " needs" : "s need"} your decision. You can return to Step 1 at any time without losing this work.` : rootMode ? "All Root cleanup decisions are ready." : "All decisions are ready. Continue to Step 3 when you are satisfied."} actions={<><button className="secondary" onClick={() => onNavigate("imports")}><ChevronLeft size={15} />Back</button>{focusedReview && <button className="secondary" onClick={onClearFocus}>Show all Step 2 brands</button>}{!cleanMode && unverified > 0 && <button className="secondary" onClick={() => onNavigate("settings")}><Database size={15} />Fix {unverified} missing IDs</button>}{!cleanMode && (rootMode ? <button className="secondary review-top-shortcut" disabled={!exportReady} onClick={() => onNavigate("brands")}><Check size={15} />Finish</button> : <button className="secondary review-top-shortcut" disabled={!exportReady} title={!exportReady ? "Resolve the remaining checks first" : "Continue to the output file"} onClick={() => onNavigate("output")}>Step 3 <ChevronRight size={15} /></button>)}</>} />
    {intakeDecisions.length > 0 && (!cleanMode || intakeNotImported > 0) && (intakeNotImported ? <details className="intake-summary has-exclusions" open><summary><span><ShieldCheck size={18} /><b>Step 1 intake: {intakeDecisions.length} submitted · {intakeImported} imported · {intakeNotImported} not imported</b></span><small>Review why some brands are not in the Step 2 worklist</small><ChevronDown size={16} /></summary><div className="intake-summary-table"><div><b>Brand</b><b>Outcome</b><b>Reason</b></div>{intakeDecisions.map((item, index) => <div key={`${item.id}:${item.brand}:${index}`}><strong>{item.brand}</strong><span className={item.outcome === "IMPORTED" ? "imported" : "not-imported"}>{item.outcome === "IMPORTED" ? "Imported" : "Not imported"}</span><p>{item.reason}{item.action ? <small>{item.action}{item.date ? ` · ${fmtDate(item.date)}` : ""}</small> : null}</p></div>)}</div></details> : <section className="intake-confirmed"><Check size={18} /><span><b>All {intakeImported} submitted brands were imported successfully</b><small>Nothing was skipped or removed. All {intakeImported} appear in the Step 2 worklist below.</small></span></section>)}
    {focusedReview && <section className="returned-review-focus"><span><ChevronLeft size={20} /></span><div><small>RETURNED FROM STEP 3</small><b>{focusedRecords.length} selected brand{focusedRecords.length === 1 ? "" : "s"} in this review</b><p>Approve or edit these rows. Other completed brands are hidden, not moved backward.</p></div><button className="secondary" onClick={onClearFocus}>Review full batch</button></section>}
    <details className="review-disclosure"><summary><span><ShieldCheck size={17} /><b>{exportReady ? "All checks passed" : `${needs + unverified + (rootMode ? rootIncomplete : invalidMerges) + blockedFamilies} checks need attention`}</b></span><small>View status and diagnostics</small><ChevronDown size={16} /></summary><div className="review-disclosure-body"><section className={`workflow-mode-banner ${rootMode ? "root" : "ubq"}`}><span>{rootMode ? <Database size={21} /> : <FileClock size={21} />}</span><div><b>{rootMode ? "ROOT TABLE CLEANUP IS ACTIVE" : "UBQ MAPPING CLEANUP IS ACTIVE"}</b><p>{rootMode ? "CONSOLIDATE links a duplicate to a different target BrandID. EDIT / KEEP corrects the canonical name. DELETE recommends blocking the source record. Use Admin on each row to perform the real change." : "These are unknown-brand queue records. Review every action, use Search on Admin when needed, then generate the exact five-column bulk upload in Step 3."}</p></div></section>{ubqFamilyRecords.length > 0 && <section className="ubq-family-banner"><span><Boxes size={22} /></span><div><b>{ubqFamilyGroups} possible UBQ brand {ubqFamilyGroups === 1 ? "family" : "families"} detected</b><p>{ubqFamilyRecords.length} rows resemble other names in the loaded UBQ table. Brandmaster propagates an existing or previously used Root target to every remaining family variation. Without one, it recommends one canonical CREATE and holds related rows to prevent duplicate brands.{staleMergedRows ? ` ${staleMergedRows} previously merged row${staleMergedRows === 1 ? " is" : "s are"} still present and flagged for re-MERGE or verified DELETE.` : ""}</p></div><strong>{ubqFamilyRecords.length}<small>related rows</small></strong></section>}<div className={`readiness ${exportReady ? "complete" : ""}`}><div>{exportReady ? <Check size={17} /> : <ShieldCheck size={17} />}<span><b>{exportReady ? "Processing complete" : "Resolve these checks to continue"}</b><small>{rootMode ? "Root BrandIDs stay unchanged; MERGE cannot target the same record" : blockedFamilies ? `${blockedFamilies} UBQ variation${blockedFamilies === 1 ? " is" : "s are"} waiting for a canonical BrandID or an explicit reviewer decision` : unverified ? "Load a full UBQ export in Validation modules to replace missing IDs automatically" : `${verified} of ${records.length} rows have valid unmapped IDs`}</small></span></div><div><span>{unverified}<small>{rootMode ? "ID issues" : "Invalid IDs"}</small></span><span>{needs}<small>Needs review</small></span><span>{rootMode ? rootIncomplete : invalidMerges}<small>Incomplete merges</small></span>{!rootMode && <span>{blockedFamilies}<small>Waiting for target</small></span>}</div></div></div></details>
    {!cleanMode && <AiReviewAssist records={focusedRecords} knownBrandIds={knownBrandIds} onUpdate={onUpdate} />}
    <div className="review-toolbar"><div className="tabs"><button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>All brands <span>{focusedRecords.length}</span></button><button className={filter === "needs-review" ? "active" : ""} onClick={() => setFilter("needs-review")}>Needs your decision <span>{focusedNeeds}</span></button><button className={filter === "ready" ? "active" : ""} onClick={() => setFilter("ready")}>Already ready <span>{focusedRecords.length - focusedNeeds}</span></button></div><label className="action-filter">Action<select value={actionFilter} onChange={(event) => setActionFilter(event.target.value as "ALL" | Action)}><option value="ALL">All actions</option>{(["MERGE", "CREATE", "SKIP", "DELETE"] as Action[]).map((action) => <option key={action}>{action}</option>)}</select><ChevronDown size={14} /></label><span className="review-visible-count">Showing <b>{visible.length}</b> of <b>{focusedRecords.length}</b></span></div>
    {checked.length > 0 && <div className="bulk-bar"><b>{checked.length} selected</b><button onClick={() => bulk()}>Approve</button><button onClick={() => bulk("MERGE")}>Merge</button><button onClick={() => bulk("SKIP")}>Skip</button><button onClick={() => bulk("DELETE")}>Delete</button><button className="bulk-ai-review" onClick={() => setAiReviewIds([...checked])}><Sparkles size={14} />AI Review</button>{!rootMode && <button className="resolve-without-mapping" onClick={() => setResolutionDialog([...checked])}>Resolve without mapping</button>}<button className="icon-button" onClick={() => { setChecked([]); setAiReviewIds([]); }}><X size={16} /></button></div>}
    {aiReviewIds.length > 0 && <AiReviewAssist records={focusedRecords.filter((record) => aiReviewIds.includes(record.id))} knownBrandIds={knownBrandIds} onUpdate={onUpdate} initiallyOpen selectionMode onClose={() => setAiReviewIds([])} />}
    <div className="table-panel"><div className="data-table review-table research-enabled"><div className="table-row table-head-row"><div><input type="checkbox" checked={visible.length > 0 && visible.every((r) => checked.includes(r.id))} onChange={(e) => setChecked(e.target.checked ? visible.map((r) => r.id) : [])} /></div><div>{rootMode ? "Root brand" : "Unmapped brand"}</div><div>Normalized</div><div>Action</div><div>Source</div><div>Confidence</div><div>Status</div><div>Manual research</div><div>Edit</div></div>
      {visible.map((r) => <Fragment key={r.id}>
        <div className={`table-row ${inlineEditId === r.id ? "editing" : ""}`} onClick={() => onSelect(r)}>
          <div onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={checked.includes(r.id)} onChange={(e) => setChecked(e.target.checked ? [...checked, r.id] : checked.filter((id) => id !== r.id))} /></div>
          <div className="brand-cell"><b>{r.name}</b>{rootMode ? <><span>{r.id}</span><span className="ubq-badge"><Check size={10} />Root source</span></> : r.ubqVerified ? <><span>{r.id}</span><span className="ubq-badge"><Check size={10} />ID verified</span></> : <><span className="missing-brand-id">Missing UnmappedBrandID</span><button className="find-ubq-id-button" onClick={(event) => { event.stopPropagation(); setIdFinderRecord(r); }}><Search size={11} />{ubqRows.length ? "Find ID in UBQ" : "Load UBQ to find ID"}</button><button className="resolve-row-link" onClick={(event) => { event.stopPropagation(); setResolutionDialog([r.id]); }}>Resolve without mapping</button></>}{!rootMode && r.relatedUbq?.length ? <span className="ubq-family-badge"><Boxes size={10} />{r.relatedUbq.length} related UBQ name{r.relatedUbq.length === 1 ? "" : "s"}</span> : null}{r.previouslyMergedStillPresent ? <span className="stale-merged-badge"><History size={10} />Previously merged · still in UBQ</span> : null}</div>
          <div><b>{r.normalized}</b>{r.name !== r.normalized && <span className="normalized-note">Normalized</span>}</div>
          <div className="review-decision-cell" onClick={(event) => event.stopPropagation()}>{cleanMode ? <select aria-label={`Decision for ${r.name}`} value={r.action} onChange={(event) => { const action = event.target.value as Action; onUpdate(r.id, { action, targetId: action === "MERGE" ? r.targetId : undefined, targetName: action === "CREATE" ? (r.targetName || r.normalized) : action === "MERGE" ? r.targetName : undefined, status: action === "MERGE" && !r.targetId?.startsWith("brand_") ? "needs-review" : "reviewed", reason: `Manually set to ${action} in Clean review`, blockedByTargetCreation: false }, true); if (action === "MERGE" && !r.targetId?.startsWith("brand_")) setInlineEditId(r.id); }}><option value="CREATE">CREATE</option><option value="MERGE">MERGE</option><option value="SKIP">SKIP</option><option value="DELETE">DELETE</option></select> : rootMode ? <RootActionPill action={r.action} /> : <ActionPill action={r.action} />}{r.targetName && <small>→ {r.targetName}</small>}{r.action === "MERGE" && r.suggestedAliases?.length ? <small className="alias-suggestion"><Tags size={9} />Add {r.suggestedAliases.length} alias{r.suggestedAliases.length === 1 ? "" : "es"}</small> : null}</div>
          <div><span className="source-pill">{r.decisionSource || "Legacy decision"}</span></div><div><Confidence value={r.confidence} /></div>
          <div>{r.status === "needs-review" ? <span className="status review">Needs review</span> : r.status === "reviewed" ? <span className="status done"><Check size={12} />Saved task</span> : <span className="status ready"><Sparkles size={12} />Auto-ready</span>}</div>
          <div className="row-research-actions" onClick={(event) => event.stopPropagation()}><InternalBrandSearch name={r.name} rootBrands={brands} ubqRows={ubqRows} excludeId={r.id} onMerge={(brand) => onUpdate(r.id, { action: "MERGE", targetId: brand.id, targetName: brand.name, confidence: 100, status: "reviewed", reason: `Reviewer selected ${brand.name} from internal Root search`, decisionSource: "Internal Root + UBQ search", blockedByTargetCreation: false, mergeOverride: true }, true)} /><ResearchLinks name={r.name} />{rootMode ? <AdminBrandLink id={r.id} name={r.name} /> : <AdminUnknownBrandLink name={r.name} />}</div>
          <div onClick={(event) => event.stopPropagation()}><button className={`icon-button row-edit ${cleanMode && r.id === firstNeedsReviewId ? "recommended-action" : ""}`} onClick={() => setInlineEditId(inlineEditId === r.id ? null : r.id)} title={`Edit ${r.name} in this table`}><Pencil size={14} /></button></div>
        </div>
        {inlineEditId === r.id && <InlineReviewEditor record={r} brands={brands} rootMode={rootMode} onCancel={() => setInlineEditId(null)} onFullReview={() => { setInlineEditId(null); onSelect(r); }} onSave={onUpdate} />}
      </Fragment>)}
    </div>{!visible.length && <EmptyState icon={Search} title="No matching records" body="Try another search or queue filter." />}
      <section className={`review-table-next ${exportReady ? "ready" : ""}`} aria-label={rootMode ? "Finish Root cleanup" : "Continue to Step 3"}>
        <span className="review-table-next-icon">{exportReady ? <Check size={21} /> : <ShieldCheck size={21} />}</span>
        <div><small>{rootMode ? "NEXT STEP" : "STEP 2 COMPLETE"}</small><b>{exportReady ? (rootMode ? "All Root cleanup decisions are ready" : `All ${activeRecords.length} brands are ready for Step 3`) : `${blockingChecks} check${blockingChecks === 1 ? "" : "s"} must be resolved first`}</b><p>{exportReady ? (rootMode ? "Finish this review and return to Existing brands." : "Continue now to review and download the final file.") : "Complete the highlighted decisions in this table. This button will turn on automatically."}</p></div>
        {rootMode ? <button className="primary" disabled={!exportReady} onClick={() => onNavigate("brands")}><Check size={16} />Finish review</button> : <button className="primary" disabled={!exportReady} title={!exportReady ? "Resolve the remaining checks first" : "Continue to the output file"} onClick={() => onNavigate("output")}>Continue to Step 3 <ChevronRight size={16} /></button>}
      </section>
    </div>
    <p className="table-caption">Showing {visible.length} of {focusedRecords.length} {focusedReview ? "selected" : "batch"} brands · Use the pencil for fast editing, or select the row to open the full side review.</p>
    {idFinderRecord && <MissingIdFinder record={idFinderRecord} records={activeRecords} ubqRows={ubqRows} onClose={() => setIdFinderRecord(null)} onOpenSettings={() => { setIdFinderRecord(null); onNavigate("settings"); }} onSelect={(row) => { onResolveUbqId(idFinderRecord.id, row); setIdFinderRecord(null); }} />}
    {resolutionDialog && <div className="modal-backdrop" role="presentation" onMouseDown={() => setResolutionDialog(null)}><section className="resolution-dialog" role="dialog" aria-modal="true" aria-labelledby="resolution-title" onMouseDown={(event) => event.stopPropagation()}><small>REMOVE FROM ACTIVE TRIAGE</small><h2 id="resolution-title">Resolve {resolutionDialog.length} item{resolutionDialog.length === 1 ? "" : "s"} without mapping</h2><p>Use this only when no Bulk Upload mapping should be produced. The item leaves this triage and the High Priority Queue, and does not count as mapped work.</p><div className="resolution-options"><label><input type="radio" name="resolution" checked={resolutionReason === "ALREADY_DONE"} onChange={() => setResolutionReason("ALREADY_DONE")} /><span><b>Already done</b><small>Someone already completed this work in the external tool.</small></span></label><label><input type="radio" name="resolution" checked={resolutionReason === "NOT_FOUND_IN_UBQ"} onChange={() => setResolutionReason("NOT_FOUND_IN_UBQ")} /><span><b>Not found in UBQ</b><small>The source is no longer present or has no valid unmapped ID.</small></span></label><label><input type="radio" name="resolution" checked={resolutionReason === "OTHER"} onChange={() => setResolutionReason("OTHER")} /><span><b>Another reason</b><small>Close this work without treating it as a mapping.</small></span></label></div>{resolutionReason === "OTHER" && <label className="resolution-note"><span>Reason</span><textarea value={resolutionNote} onChange={(event) => setResolutionNote(event.target.value)} placeholder="Explain why this should leave triage…" /></label>}<div className="resolution-dialog-actions"><button className="secondary" onClick={() => setResolutionDialog(null)}>Cancel</button><button className="primary" disabled={resolutionReason === "OTHER" && !resolutionNote.trim()} onClick={() => { onResolveWithoutMapping(resolutionDialog, resolutionReason, resolutionNote); setChecked([]); setResolutionDialog(null); setResolutionNote(""); }}>Remove from triage</button></div></section></div>}
  </>;
}

function BulkOutput({ cleanMode, records: allRecords, batch, data, currentUser, onUpdate, onSetExcluded, onReopen, onApplyAdminUploadResults, onRecordRootExport, onBeforeExport, onNavigate, onRestart }: { cleanMode?: boolean; records: BrandRecord[]; batch?: ImportBatch; data: AppData; currentUser: string; onUpdate: (id: string, changes: Partial<BrandRecord>, learn?: boolean) => void; onSetExcluded: (id: string, excluded: boolean) => void; onReopen: (ids: string[]) => void; onApplyAdminUploadResults: (batchId: string | undefined, attemptedIds: string[], rows: AdminUploadResultRow[], exportFilename: string, resultFilename: string, moveFailuresToReview: boolean, markNotFoundDone?: boolean) => void; onRecordRootExport: (changes: AppData["rootChanges"][string][], filename: string) => void; onBeforeExport: (onProgress?: (step: "local" | "team") => void) => Promise<boolean>; onNavigate: (view: View) => void; onRestart: () => void }) {
  const [selectedRows, setSelectedRows] = useState<string[]>([]);
  const [exportConfirmation, setExportConfirmation] = useState<{ filename: string; records: BrandRecord[] } | null>(null);
  const [uploadDecision, setUploadDecision] = useState<"NOT_YET" | null>(null);
  const [resultPreview, setResultPreview] = useState<(ReturnType<typeof summarizeAdminUploadResults> & { filename: string }) | null>(null);
  const [resultError, setResultError] = useState("");
  const [preparingExport, setPreparingExport] = useState(false);
  const [downloadedThisVisit, setDownloadedThisVisit] = useState(false);
  const [completionFlow, setCompletionFlow] = useState<{ phase: "saving" | "complete" | "pending"; count: number; progress: number; step: "confirm" | "local" | "team" } | null>(null);
  const resultInput = useRef<HTMLInputElement>(null);
  const weeklyCompletionActivity = useMemo(() => buildWeeklyCompletionActivity(data.historicalMappings, data.manualFpaIds, data.adminUpdateRuns), [data.historicalMappings, data.manualFpaIds, data.adminUpdateRuns]);
  const weeklyTarget = useMemo(() => buildWeeklyTargetProgress(weeklyCompletionActivity), [weeklyCompletionActivity]);
  const personalWeeklyTarget = useMemo(() => buildWeeklyTargetProgress(completionActivityForReviewer(weeklyCompletionActivity, currentUser)), [weeklyCompletionActivity, currentUser]);
  const rootMode = batch?.workflowSource === "ROOT";
  const completedRecords = rootMode ? [] : allRecords.filter((record) => record.adminUploadStatus === "SUCCESS");
  const records = rootMode ? allRecords : allRecords.filter((record) => record.adminUploadStatus !== "SUCCESS");
  const includedRecords = records.filter(isActiveTriageRecord);
  const readiness = getBulkExportReadiness(includedRecords);
  const needs = includedRecords.filter((record) => record.status === "needs-review").length;
  const invalidIds = readiness.invalidIds.length;
  const invalidMerges = readiness.incompleteMerges.length;
  const invalidCreates = readiness.incompleteCreates.length;
  const duplicateMappings = readiness.duplicateSourceMappings.length;
  const rootIncomplete = rootMode ? includedRecords.filter((record) => record.action === "MERGE" && (!record.targetId?.startsWith("brand_") || record.targetId === record.id || !record.targetName?.trim())).length : 0;
  const ready = rootMode ? needs === 0 && rootIncomplete === 0 : readiness.ready && duplicateMappings === 0;
  const excludedRecords = records.filter((record) => record.excludedFromExport || record.triageResolution);
  const count = (action: Action) => includedRecords.filter((record) => record.action === action).length;
  const normalizedGroups = new Map<string, BrandRecord[]>();
  includedRecords.forEach((record) => normalizedGroups.set(record.normalized.toLowerCase(), [...(normalizedGroups.get(record.normalized.toLowerCase()) || []), record]));
  const potentialDuplicateGroups = [...normalizedGroups.values()].filter((group) => group.length > 1 && group.some((record) => record.action === "CREATE")).length;
  const lowConfidenceAccepted = includedRecords.filter((record) => record.status === "reviewed" && record.confidence < 90).length;
  const deleteWithListings = includedRecords.filter((record) => record.action === "DELETE" && (record.listingCount || 0) > 0).length;
  const researched = includedRecords.filter((record) => record.researchChecks?.length).length;
  const rootIds = new Set(records.map((record) => record.sourceBrandId || record.id));
  const rootChanges = Object.values(data.rootChanges).filter((change) => rootIds.has(change.id) && change.adminStatus !== "REJECTED" && change.adminStatus !== "SUPERSEDED");
  const selectedRowSet = new Set(selectedRows);
  const defaultExportFilename = `brandmaster-${currentUser.toLowerCase()}-bulk-brand-mappings-${new Date().toISOString().slice(0, 10)}.csv`;
  const exportContext = exportConfirmation || { filename: defaultExportFilename, records: includedRecords };
  function applySelectedExclusion(excluded: boolean) {
    selectedRows.forEach((id) => onSetExcluded(id, excluded));
    setSelectedRows([]);
  }
  function setSelectedToSkip() {
    selectedRows.forEach((id) => onUpdate(id, { action: "SKIP", targetId: undefined, targetName: undefined, reason: "Set to SKIP during Step 3 export review", excludedFromExport: false }, true));
    setSelectedRows([]);
  }
  function importAdminResult(file?: File) {
    if (!file || !exportContext.records.length) return;
    setExportConfirmation(exportContext);
    setResultError("");
    const reader = new FileReader();
    reader.onload = () => {
      const parsed = parseAdminUploadResults(String(reader.result));
      if (parsed.error) { setResultError(parsed.error); return; }
      const summary = summarizeAdminUploadResults(exportContext.records.map((record) => record.id), parsed.rows);
      if (!summary.matching.length) { setResultError("None of the UnmappedBrandIDs in this report match the rows that were just downloaded."); return; }
      setResultPreview({ ...summary, filename: file.name });
    };
    reader.onerror = () => setResultError("The Admin result CSV could not be read.");
    reader.readAsText(file);
  }
  async function finishAdminResult(rows: AdminUploadResultRow[], resultFilename: string, moveFailures: boolean, markNotFoundDone = false) {
    if (!exportContext.records.length) return;
    const attemptedIds = exportContext.records.map((record) => record.id);
    const resultById = new Map(rows.map((row) => [row.unmappedBrandId, row]));
    const completedIds = attemptedIds.filter((id) => {
      const result = resultById.get(id);
      return result?.status === "SUCCESS" || (markNotFoundDone && (result?.status === "NOT_FOUND" || result?.status === "ALREADY_EXISTS"));
    });
    const finishesBatch = completedIds.length === attemptedIds.length;
    const failedIds = rows.filter((row) => row.status === "FAILED").map((row) => row.unmappedBrandId);
    setCompletionFlow({ phase: "saving", count: completedIds.length, progress: 12, step: "confirm" });
    setExportConfirmation(null); setResultPreview(null); setUploadDecision(null); setResultError("");
    await new Promise((resolve) => setTimeout(resolve, 220));
    onApplyAdminUploadResults(batch?.id, attemptedIds, rows, exportContext.filename, resultFilename, moveFailures, markNotFoundDone);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const saved = await onBeforeExport((step) => setCompletionFlow((current) => current ? {
      ...current,
      phase: "saving",
      step,
      progress: step === "local" ? 48 : 78,
    } : current));
    await new Promise((resolve) => setTimeout(resolve, 280));
    if (finishesBatch && saved) setCompletionFlow({ phase: "complete", count: completedIds.length, progress: 100, step: "team" });
    else if (finishesBatch) setCompletionFlow({ phase: "pending", count: completedIds.length, progress: 72, step: "team" });
    else {
      setCompletionFlow(null);
      if (moveFailures && failedIds.length) onReopen(failedIds);
    }
  }
  async function retryCompletionSave() {
    if (!completionFlow) return;
    const count = completionFlow.count;
    setCompletionFlow({ ...completionFlow, phase: "saving", progress: 48, step: "local" });
    const saved = await onBeforeExport((step) => setCompletionFlow((current) => current ? {
      ...current,
      phase: "saving",
      step,
      progress: step === "local" ? 48 : 78,
    } : current));
    setCompletionFlow({
      phase: saved ? "complete" : "pending",
      count,
      progress: saved ? 100 : 72,
      step: "team",
    });
  }
  if (rootMode) return <><WorkflowStepper stage={2} onNavigate={onNavigate} onRestart={onRestart} hasImport={records.length > 0} rootMode counts={getTriageCounts(records, true)} /><PageHead eyebrow="ROOT CLEANUP" title="Root cleanup does not use Bulk Step 3" body="Root recommendations are saved as persistent workspace tasks. Perform the actual edit, alias consolidation, or deletion in the Admin portal; a future Root import will verify the result." /><section className="root-no-bulk"><div><Database size={28} /><span><b>{rootChanges.filter((change) => change.status !== "APPLIED").length} Admin task{rootChanges.filter((change) => change.status !== "APPLIED").length === 1 ? "" : "s"} pending</b><p>The UBQ workflow still uses Step 3 and retains the exact required five-column bulk-upload CSV.</p></span></div><div><button className="secondary" onClick={() => onNavigate("review")}>Return to Root review</button><button className="primary" onClick={() => onNavigate("brands")}>View pending Root tasks</button></div></section></>;
  if (completedRecords.length > 0 && records.every((record) => record.excludedFromExport)) return <><WorkflowStepper stage={3} onNavigate={onNavigate} onRestart={onRestart} hasImport outputReady counts={{ inBasket: 0, inReview: 0, ready: 0 }} /><PageHead eyebrow="TRIAGE COMPLETE" title="Step 3 is complete" body="The Admin tool accepted every exported row. This triage is finished and no brands remain in the download basket." /><section className="admin-upload-complete"><div className="admin-upload-complete-mark"><Check size={34} /></div><small>SUCCESSFULLY EXPORTED</small><h2>{completedRecords.length.toLocaleString()} brand{completedRecords.length === 1 ? "" : "s"} exported successfully</h2><p>{batch?.adminResultFilename ? `Confirmed using ${batch.adminResultFilename}.` : "The successful Admin result is saved in the workspace."}{records.length ? ` ${records.length} intentionally excluded brand${records.length === 1 ? " was" : "s were"} not sent to Admin.` : ""} Mapping progress and the contributor&apos;s effort are now available in Analytics.</p><div><button className="secondary" onClick={() => onNavigate("analytics")}><BarChart3 size={15} />View analytics</button><button className="primary" onClick={onRestart}><Plus size={15} />Start a new triage</button></div></section></>;
  return <><WorkflowStepper stage={3} onNavigate={onNavigate} onRestart={onRestart} hasImport={records.length > 0} outputReady={ready} rootMode={rootMode} counts={getTriageCounts(records, rootMode)} basketRecords={records} />
    <PageHead eyebrow="THIRD STEP · EXPORT" title={rootMode ? "Root table cleanup output" : cleanMode ? "Download final file" : "Download your upload-ready file"} body={rootMode ? "Download the staged Root changes or open each source record in the admin tool. This is separate from the UBQ bulk mapping file." : cleanMode ? "Review the final worklist, download the Admin file, then confirm the result to complete this triage." : "Your final CSV keeps the exact five columns required by the Bulk Upload Brand Mappings tool."} actions={<>{records.length > 0 && <button className="secondary" onClick={() => onNavigate("review")}><ChevronLeft size={15} />Back to review</button>}</>} />
    {!records.length ? <div className="panel"><EmptyState icon={FileUp} title="No brands have reached Step 3" body="Start at Step 1 by adding brands, then confirm every required decision in Step 2." action={<button className="primary" onClick={() => onNavigate("imports")}>Go to Step 1</button>} /></div> : !ready ? <div className="output-blocked"><div className="output-status-icon"><FileClock size={24} /></div><h2>Your file needs attention</h2><p>Return to Step 2 and resolve every check before downloading the final file.</p><div className="output-checks">{!rootMode && <span className={invalidIds ? "bad" : "good"}>{invalidIds ? <X size={14} /> : <Check size={14} />}Valid unmapped IDs <b>{invalidIds ? `${invalidIds} missing` : "Complete"}</b></span>}<span className={needs ? "bad" : "good"}>{needs ? <X size={14} /> : <Check size={14} />}Review decisions <b>{needs ? `${needs} remaining` : "Complete"}</b></span><span className={(rootMode ? rootIncomplete : invalidMerges) ? "bad" : "good"}>{(rootMode ? rootIncomplete : invalidMerges) ? <X size={14} /> : <Check size={14} />}MERGE targets <b>{(rootMode ? rootIncomplete : invalidMerges) ? `${rootMode ? rootIncomplete : invalidMerges} incomplete` : "Complete"}</b></span>{!rootMode && <span className={invalidCreates ? "bad" : "good"}>{invalidCreates ? <X size={14} /> : <Check size={14} />}CREATE target names <b>{invalidCreates ? `${invalidCreates} incomplete` : "Complete"}</b></span>}</div><button className="primary" onClick={() => onNavigate("review")}>Return to Step 2 review</button></div> : rootMode ? <>
      <div className="output-success"><div className="output-status-icon"><Check size={25} /></div><div><span>ROOT CLEANUP STAGED</span><h2>{rootChanges.length.toLocaleString()} Root table changes are ready</h2><p>MERGE stages sameAs + INACTIVE, DELETE stages BLOCKED, and CREATE keeps or renames the canonical record.</p></div><button className="primary output-download" disabled={!rootChanges.length} onClick={() => { const filename = `brandmaster-${currentUser.toLowerCase()}-root-table-changes-${new Date().toISOString().slice(0, 10)}.csv`; download(filename, toRootChangesCsv(rootChanges)); onRecordRootExport(rootChanges, filename); }}><ArrowDownToLine size={17} />Download Root changes CSV</button></div>
      <section className="panel output-preview"><div className="panel-head"><div><h2>Root cleanup actions</h2><p>Open Admin for the actual source record when a direct edit or delete is required.</p></div><span className="status done"><Check size={12} />{rootChanges.length} staged changes</span></div><div className="root-output-list">{records.map((record) => <div key={record.id}><span><b>{record.name}</b><code>{record.id}</code></span><ActionPill action={record.action} /><span>{record.action === "MERGE" ? `sameAs ${record.targetName} · ${record.targetId}` : record.action === "DELETE" ? "Status → BLOCKED" : record.action === "CREATE" ? `Canonical name → ${record.targetName}` : "No Root change"}</span><AdminBrandLink id={record.id} name={record.name} compact /></div>)}</div></section>
    </> : <>
      <section className="preflight-report"><div className="preflight-head"><span><ShieldCheck size={22} /></span><div><small>PRE-EXPORT QUALITY CHECK</small><h2>Your file is structurally ready</h2><p>Required fields passed. Review the non-blocking warnings below before downloading.</p></div><strong>{potentialDuplicateGroups + lowConfidenceAccepted + deleteWithListings ? "Review warnings" : "All clear"}</strong></div><div className="preflight-grid"><span className="good"><Check size={17} /><b>Valid UBQ IDs</b><small>{includedRecords.length} of {includedRecords.length}</small></span><span className="good"><Check size={17} /><b>Complete MERGE targets</b><small>{count("MERGE")} checked</small></span><span className={potentialDuplicateGroups ? "warning" : "good"}>{potentialDuplicateGroups ? <CircleHelp size={17} /> : <Check size={17} />}<b>Possible duplicate CREATEs</b><small>{potentialDuplicateGroups || "None"}</small></span><span className={deleteWithListings ? "warning" : "good"}>{deleteWithListings ? <CircleHelp size={17} /> : <Check size={17} />}<b>DELETE rows with listings</b><small>{deleteWithListings || "None"}</small></span><span className={lowConfidenceAccepted ? "warning" : "good"}>{lowConfidenceAccepted ? <CircleHelp size={17} /> : <Check size={17} />}<b>Low-confidence approvals</b><small>{lowConfidenceAccepted || "None"}</small></span><span className="neutral"><Search size={17} /><b>Research recorded</b><small>{researched} of {includedRecords.length}</small></span></div>{potentialDuplicateGroups + lowConfidenceAccepted + deleteWithListings > 0 && <button className="secondary" onClick={() => onNavigate("review")}><ChevronLeft size={15} />Return to Step 2 and inspect warnings</button>}</section>
      <div className="output-success"><div className="output-status-icon"><Check size={25} /></div><div><span>READY FOR ADMIN</span><h2>{includedRecords.length.toLocaleString()} brand mappings are ready</h2><p>{preparingExport ? "CSV downloaded. Saving this active run without leaving Step 3…" : excludedRecords.length ? `${excludedRecords.length.toLocaleString()} brand${excludedRecords.length === 1 ? " is" : "s are"} intentionally excluded. Download, complete the Admin work, then confirm the result below.` : "Download the CSV, complete the work in Admin, then confirm the result below. The run stays protected until confirmation."}</p></div><button className={`primary output-download ${!downloadedThisVisit ? "recommended-action" : ""}`} disabled={!includedRecords.length} onClick={() => { const filename = defaultExportFilename; download(filename, toCsv(includedRecords)); setDownloadedThisVisit(true); setPreparingExport(true); setTimeout(() => { void onBeforeExport().finally(() => setPreparingExport(false)); }, 0); }}><ArrowDownToLine size={17} />{preparingExport ? "Downloaded · saving…" : `Download ${includedRecords.length.toLocaleString()} rows`}</button></div>
      <section className={`step3-outcome-panel ${downloadedThisVisit ? "recommended-choice" : ""}`}><div><small>FINAL CONFIRMATION</small><h2>How was this work completed?</h2><p>These choices remain available whenever you return to Step 3. Downloading the CSV is optional if you made the same changes manually in Admin.</p></div>{uploadDecision && <div className="step3-pending-note"><CircleHelp size={18} /><span><b>Work remains pending</b><small>Nothing was marked complete. You can download later or return rows to review.</small></span></div>}<input ref={resultInput} type="file" accept=".csv,text/csv" hidden onChange={(event) => { importAdminResult(event.target.files?.[0]); event.target.value = ""; }} />{resultError && <div className="reference-error"><CircleHelp size={14} />{resultError}</div>}<div className="step3-outcome-actions"><button className="secondary" onClick={() => setUploadDecision("NOT_YET")}><FileClock size={17} />Not completed yet</button><button className="secondary" onClick={() => resultInput.current?.click()}><FileUp size={17} />Upload failed/result CSV</button><button className="primary" onClick={() => finishAdminResult(exportContext.records.map((record, index) => ({ rowNumber: index + 1, unmappedBrandId: record.id, unmappedBrandName: record.name, status: "SUCCESS" as const, rawStatus: "SUCCESS" })), exportContext.filename, false)}><Check size={17} />All completed in Admin</button></div></section>
      <section className="output-summary"><div><b>{includedRecords.length}</b><span>Included rows</span></div><div className="merge"><b>{count("MERGE")}</b><span>MERGE</span></div><div className="create"><b>{count("CREATE")}</b><span>CREATE</span></div><div className="skip"><b>{count("SKIP")}</b><span>SKIP</span></div><div className="delete"><b>{count("DELETE")}</b><span>DELETE</span></div><div className="excluded"><b>{excludedRecords.length}</b><span>EXCLUDED</span></div></section>
      <section className="panel output-preview output-worklist">
        <div className="panel-head"><div><h2>Manage the final worklist</h2><p>Select one or several rows, then use a single bulk action. Review again opens Step 2 with only those selected brands.</p></div><span className="status done"><Check size={12} />5 export columns unchanged</span></div>
        {selectedRows.length > 0 && <div className="output-bulk-manager"><span><b>{selectedRows.length} selected</b><small>Choose one action for these rows</small></span><button className="primary" onClick={() => onReopen(selectedRows)}><ChevronLeft size={14} />Review selected in Step 2</button><button className="secondary" onClick={() => applySelectedExclusion(true)}>Exclude selected</button><button className="secondary" onClick={() => applySelectedExclusion(false)}>Include selected</button><button className="secondary" onClick={setSelectedToSkip}>Set selected to SKIP</button><button className="icon-button" onClick={() => setSelectedRows([])} title="Clear selection"><X size={16} /></button></div>}
        <div className="output-table">
          <div><span className="output-select"><input type="checkbox" aria-label="Select all rows" checked={records.length > 0 && records.every((record) => selectedRowSet.has(record.id))} onChange={(event) => setSelectedRows(event.target.checked ? records.map((record) => record.id) : [])} /></span><b>Include</b><b>UnmappedBrandID</b><b>UnmappedBrandName</b><b>Action</b><b>TargetBrandID</b><b>TargetBrandName</b><b>Row controls</b></div>
          {records.map((record) => <div className={`${record.excludedFromExport ? "excluded " : ""}${selectedRowSet.has(record.id) ? "selected" : ""}`} key={record.id}><span className="output-select"><input type="checkbox" aria-label={`Select ${record.name}`} checked={selectedRowSet.has(record.id)} onChange={(event) => setSelectedRows(event.target.checked ? [...selectedRows, record.id] : selectedRows.filter((id) => id !== record.id))} /></span><label className="output-include"><input type="checkbox" checked={!record.excludedFromExport} onChange={(event) => onSetExcluded(record.id, !event.target.checked)} /><span>{record.excludedFromExport ? "Excluded" : "Include"}</span></label><code>{record.id}</code><span>{record.name}</span><ActionPill action={record.action} /><code>{record.action === "MERGE" ? record.targetId : ""}</code><span>{record.action === "CREATE" || record.action === "MERGE" ? record.targetName : ""}</span><div className="output-row-controls"><button className="secondary" disabled={record.action === "SKIP"} onClick={() => onUpdate(record.id, { action: "SKIP", targetId: undefined, targetName: undefined, reason: "Set to SKIP during Step 3 export review", excludedFromExport: false }, true)}>Set SKIP</button><button className="secondary" onClick={() => onReopen([record.id])}><ChevronLeft size={13} />Review this row</button></div></div>)}
        </div>
      </section>
    </>}
    {exportConfirmation && <><div className="fresh-dialog-scrim" /><section className="export-confirm-dialog admin-result-dialog" role="dialog" aria-modal="true" aria-labelledby="export-confirm-title">
      <div className="export-confirm-icon">{resultPreview ? <ShieldCheck size={24} /> : uploadDecision ? <CircleHelp size={24} /> : <ArrowDownToLine size={24} />}</div><small>ADMIN UPLOAD CHECK</small>
      {resultPreview ? <>
        <h2 id="export-confirm-title">Admin processed {resultPreview.matching.length} reported rows</h2>
        <p>Successful rows leave Step 3. “Already exists” and no-longer-in-UBQ rows can be confirmed as completed elsewhere without crediting them as new mapping work.</p>
        <div className="admin-result-stats">
          <span className="success"><b>{resultPreview.successful.length}</b><small>Successful</small></span>
          <span className={resultPreview.notFound.length ? "success" : ""}><b>{resultPreview.notFound.length}</b><small>No longer in UBQ</small></span>
          <span className={resultPreview.alreadyExists.length ? "success" : ""}><b>{resultPreview.alreadyExists.length}</b><small>Already completed</small></span>
          <span className={resultPreview.failed.length ? "failed" : ""}><b>{resultPreview.failed.length}</b><small>Failed</small></span>
          <span><b>{resultPreview.missingIds.length}</b><small>Not in report</small></span>
          <span><b>{resultPreview.unrelated}</b><small>Unrelated</small></span>
        </div>
        {resultPreview.notFound.length > 0 && <div className="admin-result-errors">{resultPreview.notFound.slice(0, 5).map((row) => <p key={row.unmappedBrandId}><b>{row.unmappedBrandName || row.unmappedBrandId}</b><small>No longer found in UBQ · review and mark done</small></p>)}</div>}
        {resultPreview.alreadyExists.length > 0 && <div className="admin-result-errors already-done">{resultPreview.alreadyExists.slice(0, 5).map((row) => <p key={row.unmappedBrandId}><b>{row.unmappedBrandName || row.unmappedBrandId}</b><small>Admin says this already exists · another teammate may have completed it</small></p>)}</div>}
        {resultPreview.failed.length > 0 && <div className="admin-result-errors">{resultPreview.failed.slice(0, 5).map((row) => <p key={row.unmappedBrandId}><b>{row.unmappedBrandName || row.unmappedBrandId}</b><small>{row.errorMessage || row.rawStatus}</small></p>)}{resultPreview.failed.length > 5 && <small>+ {resultPreview.failed.length - 5} more failed rows</small>}</div>}
        <code>{resultPreview.filename}</code>
        <div>
          {(resultPreview.failed.length > 0 || resultPreview.notFound.length > 0 || resultPreview.alreadyExists.length > 0) && <button className="secondary" onClick={() => finishAdminResult(resultPreview.matching, resultPreview.filename, false)}>Keep unresolved rows in Step 3</button>}
          {resultPreview.failed.length > 0 && resultPreview.notFound.length === 0 && resultPreview.alreadyExists.length === 0 && <button className="primary" onClick={() => finishAdminResult(resultPreview.matching, resultPreview.filename, true)}><ChevronLeft size={15} />Move failures to Step 2</button>}
          {(resultPreview.notFound.length > 0 || resultPreview.alreadyExists.length > 0) && <button className="primary" onClick={() => finishAdminResult(resultPreview.matching, resultPreview.filename, resultPreview.failed.length > 0, true)}><Check size={15} />Mark {resultPreview.notFound.length + resultPreview.alreadyExists.length} completed elsewhere{resultPreview.failed.length ? " · review other failures" : ""}</button>}
          {resultPreview.failed.length === 0 && resultPreview.notFound.length === 0 && resultPreview.alreadyExists.length === 0 && <button className="primary" onClick={() => finishAdminResult(resultPreview.matching, resultPreview.filename, false)}><Check size={15} />Finish triage · {resultPreview.successful.length} successful</button>}
        </div>
      </> : uploadDecision ? <><h2 id="export-confirm-title">Keep these rows in Step 3?</h2><p>If the file was not uploaded, nothing has completed. Keep the rows ready here, or return all of them to Step 2 if their decisions need correction.</p><code>{exportConfirmation.filename}</code><div><button className="secondary" onClick={() => { setUploadDecision(null); setExportConfirmation(null); }}>Keep in Step 3</button><button className="primary" onClick={() => { onReopen(exportConfirmation.records.map((record) => record.id)); setUploadDecision(null); setExportConfirmation(null); }}><ChevronLeft size={15} />Return all to Step 2</button></div></> : <><h2 id="export-confirm-title">What happened in the Admin upload?</h2><p>If Admin produced a result CSV, import it so successful rows finish and only failed rows remain. Use “all succeeded” only when every row was accepted.</p><code>{exportConfirmation.filename}</code><input ref={resultInput} type="file" accept=".csv,text/csv" hidden onChange={(event) => { importAdminResult(event.target.files?.[0]); event.target.value = ""; }} />{resultError && <div className="reference-error"><CircleHelp size={14} />{resultError}</div>}<div><button className="secondary" onClick={() => setUploadDecision("NOT_YET")}>Not uploaded / failed</button><button className="secondary" onClick={() => resultInput.current?.click()}><FileUp size={15} />Import Admin result CSV</button><button className="primary" onClick={() => finishAdminResult(exportConfirmation.records.map((record, index) => ({ rowNumber: index + 1, unmappedBrandId: record.id, unmappedBrandName: record.name, status: "SUCCESS" as const, rawStatus: "SUCCESS" })), exportConfirmation.filename, false)}><Check size={15} />All {exportConfirmation.records.length} succeeded</button></div></>}
    </section></>}
    {completionFlow && <><div className="fresh-dialog-scrim completion-flow-scrim" /><section className={`completion-flow-dialog ${completionFlow.phase}`} role="dialog" aria-modal="true" aria-labelledby="completion-flow-title" aria-live="polite">
      <div className="completion-flow-mark">{completionFlow.phase === "saving" ? <RefreshCw className="spinning" size={30} /> : completionFlow.phase === "pending" ? <UploadCloud size={32} /> : <Check size={34} />}</div>
      <small>{completionFlow.phase === "saving" ? "SAVING STEP 3" : completionFlow.phase === "pending" ? "TEAM SAVE PENDING" : "PROCESS COMPLETE"}</small>
      <h2 id="completion-flow-title">{completionFlow.phase === "saving" ? "Saving your completed batch…" : completionFlow.phase === "pending" ? "Saved here — team save needs attention" : "Your batch is saved and complete"}</h2>
      <p>{completionFlow.phase === "saving" ? "Please keep this window open. Brandmaster is recording the result and saving each part of the completed process." : completionFlow.phase === "pending" ? "Your completed work is safe on this device. Keep this dialog open and retry the team save when the connection is available." : `${completionFlow.count} brand${completionFlow.count === 1 ? "" : "s"} completed. The final checkpoint is saved and this batch will not return as unfinished work.`}</p>
      <div className="completion-flow-progress" role="progressbar" aria-label="Saving completed batch" aria-valuemin={0} aria-valuemax={100} aria-valuenow={completionFlow.progress}><i style={{ width: `${completionFlow.progress}%` }} /><span>{completionFlow.phase === "pending" ? "Local save complete" : `${completionFlow.progress}% saved`}</span></div>
      {completionFlow.phase !== "complete" ? <div className="completion-flow-steps">
        <span className="done"><Check size={14} />Admin result confirmed</span>
        <span className={completionFlow.step === "local" && completionFlow.phase === "saving" ? "active" : completionFlow.step === "team" || completionFlow.phase === "pending" ? "done" : ""}>{completionFlow.step === "local" && completionFlow.phase === "saving" ? <RefreshCw className="spinning" size={14} /> : completionFlow.step === "team" || completionFlow.phase === "pending" ? <Check size={14} /> : <Archive size={14} />}Batch, review history, and queue saved locally</span>
        <span className={completionFlow.phase === "pending" ? "pending" : completionFlow.step === "team" ? "active" : ""}>{completionFlow.phase === "pending" ? <CircleHelp size={14} /> : completionFlow.step === "team" ? <RefreshCw className="spinning" size={14} /> : <Cloud size={14} />}{completionFlow.phase === "pending" ? "Team workspace not saved yet" : "Saving final team workspace checkpoint"}</span>
      </div> : <section className="completion-weekly-progress">
        <div className="completion-weekly-head"><div><small>WEEKLY PROGRESS · PERSONAL AND TEAM</small><b>{weeklyTarget.weekStart.toLocaleDateString(undefined, { month: "short", day: "numeric" })}–{new Date(weeklyTarget.weekEnd.getTime() - 1).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</b></div><span>Team target: {weeklyTarget.weeklyTarget.toLocaleString()}</span></div>
        <div className="completion-progress-split">
          <section className="completion-personal-progress">
            <div className="completion-scope-head"><span><Users size={16} /></span><div><small>YOUR PROGRESS</small><b>{canonicalAnalyticsReviewer(currentUser)}</b></div></div>
            <div className="completion-personal-totals"><span className="batch-added"><b>+{completionFlow.count.toLocaleString()}</b><small>this batch</small></span><span><b>{personalWeeklyTarget.completed.toLocaleString()}</b><small>your completed this week</small></span></div>
            <div className="completion-personal-days">{personalWeeklyTarget.days.map((day) => <span className={`${day.isToday ? "today" : ""} ${day.isFuture ? "future" : ""}`} key={day.key}><small>{day.label}</small><b>{day.completed.toLocaleString()}</b></span>)}</div>
            <p>Your numbers include only work credited to {canonicalAnalyticsReviewer(currentUser)}.</p>
          </section>
          <section className="completion-team-progress">
            <div className="completion-scope-head"><span><Users size={16} /></span><div><small>TEAM PROGRESS</small><b>Everyone combined</b></div><strong>{weeklyTarget.completed.toLocaleString()} / {weeklyTarget.weeklyTarget.toLocaleString()}</strong></div>
            <div className="completion-team-stats"><span><b>{weeklyTarget.completed.toLocaleString()}</b><small>team completed</small></span><span><b>{weeklyTarget.remaining.toLocaleString()}</b><small>team remaining</small></span><span><b>{weeklyTarget.dailyTarget.toLocaleString()}</b><small>team daily target</small></span></div>
            <div className="completion-target-track" role="progressbar" aria-label="Weekly team target" aria-valuemin={0} aria-valuemax={weeklyTarget.weeklyTarget} aria-valuenow={weeklyTarget.completed}><i style={{ width: `${weeklyTarget.progressPercent}%` }} /><span>{weeklyTarget.progressPercent}% of the team goal</span></div>
            <div className="completion-daily-grid">{weeklyTarget.days.map((day) => <div className={`${day.isToday ? "today" : ""} ${day.isFuture ? "future" : ""}`} key={day.key}><span><i style={{ height: `${Math.max(4, day.progressPercent)}%` }} /></span><b>{day.completed.toLocaleString()}</b><small>{day.label} · / {day.target.toLocaleString()}</small></div>)}</div>
            <p>Team total combines every contributor and imported manual task.</p>
          </section>
        </div>
      </section>}
      {completionFlow.phase === "pending" && <div className="completion-flow-actions"><button className="primary" onClick={() => void retryCompletionSave()}><RefreshCw size={15} />Retry team save</button></div>}
      {completionFlow.phase === "complete" && <div className="completion-flow-actions"><button className="secondary" onClick={() => { setCompletionFlow(null); onNavigate("analytics"); }}><BarChart3 size={15} />View progress</button><button className="primary" onClick={() => { setCompletionFlow(null); onRestart(); }}><Plus size={15} />Start a new batch</button></div>}
    </section></>}
  </>;
}

function DecisionDrawer({ record, records, brands, ubqRows, onClose, onSave, onApplyRelated }: { record: BrandRecord; records: BrandRecord[]; brands: CatalogBrand[]; ubqRows: { id: string; name: string }[]; onClose: () => void; onSave: (id: string, changes: Partial<BrandRecord>, learn?: boolean) => void; onApplyRelated: (ids: string[], targetId: string, targetName: string) => void }) {
  const [action, setAction] = useState<Action>(record.action); const [unmappedId, setUnmappedId] = useState(record.id); const [target, setTarget] = useState(record.targetId || ""); const [targetName, setTargetName] = useState(record.targetName || record.normalized); const [targetQuery, setTargetQuery] = useState(record.targetId || record.targetName || record.normalized); const [ubqQuery, setUbqQuery] = useState(record.name); const [selectedRelated, setSelectedRelated] = useState<string[]>([]); const [familyApplied, setFamilyApplied] = useState(false); const [notes, setNotes] = useState(record.notes || "");
  const [createOverride, setCreateOverride] = useState(false);
  const rootMode = record.workflowSource === "ROOT";
  const existingCreateBrand = action === "CREATE" && !rootMode ? findExistingBrandByName(targetName, brands) : undefined;
  const relatedWorklistRows = (record.relatedUbq || []).map((related) => records.find((candidate) => candidate.id === related.id)).filter((candidate): candidate is BrandRecord => Boolean(candidate));
  const ubqMatches = useMemo(() => ubqRows.map((row) => ({ row, match: matchCatalogBrand(ubqQuery, { ...row, aliases: [], category: "Automotive", source: "Manual" }) })).filter((item) => item.match.score >= 42).sort((left, right) => right.match.score - left.match.score).slice(0, 8), [ubqRows, ubqQuery]);
  function changeAction(next: Action) {
    setAction(next);
    setCreateOverride(false);
    if (next === "CREATE") { setTarget(""); setTargetName(record.normalized); }
    if (next === "SKIP" || next === "DELETE") { setTarget(""); setTargetName(""); }
  }
  return <><div className="drawer-scrim" onClick={onClose} /><aside className="drawer"><div className="drawer-head"><div><span>BRAND DECISION</span><h2>{record.name}</h2></div><button className="icon-button" onClick={onClose}><X size={20} /></button></div><div className="drawer-body">
    <div className="name-transform"><div><span>Original</span><b>{record.name}</b></div><strong>→</strong><div><span>Normalized</span><b>{record.normalized}</b></div></div>
    <label className="field identity-field"><span>{rootMode ? "Root BrandID" : "UnmappedBrandID"}</span><input readOnly={rootMode} value={unmappedId.startsWith("missing_id_") ? "" : unmappedId} onChange={(e) => setUnmappedId(e.target.value.trim())} placeholder={rootMode ? "brand_..." : "draft_brand_..."} /><small>{rootMode ? "Existing source identity is locked. The reviewed action will stage a Root table change." : unmappedId.startsWith("draft_brand_") ? "Valid bulk-upload ID format" : "Search the loaded UBQ below, or enter a real draft_brand_… ID."}</small></label>
    {!rootMode && !unmappedId.startsWith("draft_brand_") && <section className="missing-id-resolver"><h3>Find this brand in the loaded UBQ</h3><p>Search by brand name or paste its draft_brand_ ID, then select the correct row.</p><div className="smart-target-search"><Search size={15} /><input value={ubqQuery} onChange={(event) => setUbqQuery(event.target.value)} placeholder="Search UBQ name or draft_brand_ ID…" /></div>{ubqRows.length ? <div className="smart-target-results">{ubqMatches.length ? ubqMatches.map(({ row, match }) => <button type="button" key={row.id} onClick={() => { setUnmappedId(row.id); setUbqQuery(row.name); }}><span><b>{row.name}</b><small>{brandMatchLabel(match)}</small></span><code>{row.id}</code><em>Select</em></button>) : <p>No UBQ match found. Try fewer words or paste the exact ID.</p>}</div> : <button className="secondary" type="button" onClick={() => setUnmappedId("")}>No UBQ table loaded · enter the ID above</button>}</section>}
    {!rootMode && record.relatedUbq?.length ? <section className="drawer-ubq-family actionable"><header className="related-family-head"><h3>Associate related UBQ names</h3>{relatedWorklistRows.length > 0 && <button type="button" onClick={() => setSelectedRelated(selectedRelated.length === relatedWorklistRows.length ? [] : relatedWorklistRows.map((item) => item.id))}>{selectedRelated.length === relatedWorklistRows.length ? "Clear" : `Select all ${relatedWorklistRows.length}`}</button>}</header><p>Select related rows that are in this worklist. Each source <code>draft_brand_…</code> ID will receive exactly one MERGE row pointing to the one existing <code>brand_…</code> target chosen below.</p><div>{record.relatedUbq.map((item) => { const available = relatedWorklistRows.some((candidate) => candidate.id === item.id); const checked = selectedRelated.includes(item.id); return <button type="button" className={checked ? "selected" : ""} disabled={!available} key={item.id} onClick={() => setSelectedRelated(checked ? selectedRelated.filter((id) => id !== item.id) : [...selectedRelated, item.id])}><input type="checkbox" readOnly checked={checked} /><span><b>{item.name}</b><small>{item.score}% · {item.reason}{!available ? " · not in this worklist" : ""}</small><code>{item.id}</code></span></button>; })}</div>{record.ubqFamilyCanonicalName && <em>Suggested canonical candidate: <b>{record.ubqFamilyCanonicalName}</b></em>}{selectedRelated.length > 0 && <button type="button" className="primary family-merge-action" disabled={action !== "MERGE" || !target.startsWith("brand_") || !targetName.trim()} onClick={() => { onApplyRelated(selectedRelated, target, targetName.trim()); setFamilyApplied(true); setSelectedRelated([]); }}><Tags size={14} />{familyApplied ? "Related rows updated" : target.startsWith("brand_") ? `Associate ${selectedRelated.length} selected with ${targetName}` : "Choose an existing brand below first"}</button>}</section> : null}
    {record.action === "MERGE" && record.suggestedAliases?.length ? <section className="drawer-alias-plan"><h3>Alias plan for {record.targetName}</h3><p>When this decision is saved, Brandmaster also stages these aliases as a Root Admin task.</p><div>{record.suggestedAliases.map((alias) => <span key={alias}><Tags size={12} />{alias}</span>)}</div>{record.canonicalTargetChain && record.canonicalTargetChain.length > 1 && <small>Target chain resolved: {record.canonicalTargetChain.join(" → ")}</small>}</section> : null}
    {record.previouslyMergedStillPresent && <section className="stale-merge-warning"><History size={18} /><div><b>Previously merged, but still present in UBQ</b><p>Recommended default: reapply MERGE to <strong>{record.priorFamilyTargetName}</strong> · <code>{record.priorFamilyTargetId}</code>. Choose DELETE only when Admin confirms this is a stale queue artifact with no valid listings to preserve.</p></div></section>}
    <section><h3>{rootMode ? "Admin action and research" : "Research this brand"}</h3><div className="drawer-admin-research">{rootMode ? <AdminBrandLink id={record.id} name={record.name} /> : <AdminUnknownBrandLink name={record.name} />}<ResearchLinks name={record.name} /></div></section>
    <section><h3>Recommendation</h3><div className="ai-recommendation"><div><Sparkles size={18} /><b>{record.decisionSource || "Local decision engine"}</b><Confidence value={record.confidence} /></div><ActionPill action={record.action} /><p>{record.reason}</p></div></section>
    <section><h3>Evidence</h3><div className="evidence-list">{record.evidence.map((item, i) => <div key={item}><span>{i === 0 ? <Database size={15} /> : <Search size={15} />}</span><div><b>{item}</b><p>{item.includes("Offline") ? "Connect an enrichment API in Settings for live source verification." : "Matched during local processing."}</p></div><Check size={15} /></div>)}</div></section>
    <section className="association-workbench"><h3>Find and associate an existing brand</h3><p>Search manually whenever the automatic suggestion is wrong or incomplete. Selecting a result fills both target fields and changes this decision to MERGE.</p><SmartTargetPicker brands={brands} query={targetQuery} selectedId={target} onQuery={setTargetQuery} onSelect={(brand) => { setAction("MERGE"); setTarget(brand.id); setTargetName(brand.name); setTargetQuery(brand.id); setCreateOverride(false); }} /></section>
    <section><h3>{rootMode ? "Root recommendation" : "Your decision"}</h3><div className="action-picker">{(["MERGE", "CREATE", "SKIP", "DELETE"] as Action[]).map((a) => <button key={a} className={`${a.toLowerCase()} ${action === a ? "active" : ""}`} onClick={() => changeAction(a)}><span>{a === "MERGE" ? "↗" : a === "CREATE" ? "+" : a === "SKIP" ? "–" : "×"}</span>{rootMode ? (a === "MERGE" ? "CONSOLIDATE" : a === "CREATE" ? "EDIT / KEEP" : a) : a}<Check size={14} /></button>)}</div>
      {action === "MERGE" && <div className="merge-fields"><label className="field"><span>TargetBrandID</span><input value={target} onChange={(e) => { const value = e.target.value.trim(); setTarget(value); setTargetQuery(value); const brand = brands.find((item) => item.id === value); if (brand) setTargetName(brand.name); }} placeholder="brand_xxxxxxxxxxxxxxxxxxxxxx" /></label><label className="field"><span>TargetBrandName</span><input value={targetName} onChange={(e) => setTargetName(e.target.value)} placeholder="Canonical brand name" /></label></div>}
      {action === "CREATE" && <><label className="field"><span>{rootMode ? "Corrected canonical name" : "TargetBrandName"}</span><input value={targetName} onChange={(e) => { setTargetName(e.target.value); setCreateOverride(false); }} placeholder={rootMode ? "Correct Root brand name" : "Canonical brand name to create"} /><small>{rootMode ? "This records an edit recommendation; make the actual name or alias change in Admin." : "TargetBrandID stays blank for CREATE. Brandmaster checks this name against the existing catalog."}</small></label>{existingCreateBrand && <div className={`create-collision-warning ${createOverride ? "overridden" : ""}`}><CircleHelp size={17} /><span><b>{createOverride ? "Reviewer override: CREATE will be kept" : `Possible existing-brand conflict with ${existingCreateBrand.name}`}</b><small>{createOverride ? `You confirmed that ${targetName} is distinct from ${existingCreateBrand.name}. The manual decision takes priority.` : <>The catalog name or alias matched <code>{existingCreateBrand.id}</code>. MERGE is suggested, but it is not forced.</>}</small></span><div className="create-collision-actions"><button onClick={() => { setAction("MERGE"); setTarget(existingCreateBrand.id); setTargetName(existingCreateBrand.name); setCreateOverride(false); }}>Use MERGE</button><button onClick={() => setCreateOverride(!createOverride)}>{createOverride ? "Undo override" : "CREATE anyway"}</button></div></div>}</>}
      <label className="field"><span>Reviewer notes</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Explain this decision for the review history…" /></label>
    </section></div><div className="drawer-footer"><p><kbd>⌘</kbd><kbd>↵</kbd> Save decision</p><button className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={(Boolean(existingCreateBrand) && !createOverride) || (action === "MERGE" && (!target.startsWith("brand_") || target === record.id || !targetName.trim())) || (action === "CREATE" && !targetName.trim())} onClick={() => onSave(record.id, { id: unmappedId, ubqVerified: rootMode ? record.ubqVerified : unmappedId.startsWith("draft_brand_"), action, targetId: action === "MERGE" ? target : undefined, targetName: action === "MERGE" || action === "CREATE" ? targetName.trim() : undefined, notes, confidence: 100, reason: createOverride ? "Reviewer overrode possible catalog collision and validated CREATE" : rootMode ? `Validated Root cleanup: ${action}` : `Validated for bulk upload: ${action}`, evidence: createOverride ? [`Manual CREATE override: reviewed possible match to ${existingCreateBrand?.name} · ${existingCreateBrand?.id}`, ...record.evidence] : record.evidence, blockedByTargetCreation: false, mergeOverride: action === "MERGE" }, true)}>Save decision</button></div></aside></>;
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

function InternalBrandSearch({ name, rootBrands, ubqRows, compact = false, excludeId, onMerge }: { name: string; rootBrands: CatalogBrand[]; ubqRows: ParsedRow[]; compact?: boolean; excludeId?: string; onMerge?: (brand: CatalogBrand) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(name);
  const normalizedQuery = normalizeBrand(query).toLowerCase();
  const rootMatches = useMemo(() => {
    if (!open || !query.trim()) return [];
    return rootBrands.map((brand) => {
      const names = [brand.name, ...brand.aliases];
      const exact = brand.id.toLowerCase() === query.trim().toLowerCase() || names.some((item) => normalizeBrand(item).toLowerCase() === normalizedQuery);
      const best = names.reduce((score, item) => Math.max(score, assessMergeCompatibility(query, item).score), 0);
      return { brand, exact, score: exact ? 100 : best };
    }).filter((item) => item.brand.id !== excludeId && (item.exact || item.score >= 55)).sort((left, right) => Number(right.exact) - Number(left.exact) || right.score - left.score || left.brand.name.localeCompare(right.brand.name)).slice(0, 12);
  }, [excludeId, normalizedQuery, open, query, rootBrands]);
  const ubqMatches = useMemo(() => {
    if (!open || !query.trim()) return [];
    return ubqRows.map((row) => {
      const exact = row.id.toLowerCase() === query.trim().toLowerCase() || normalizeBrand(row.name).toLowerCase() === normalizedQuery;
      return { row, exact, score: exact ? 100 : assessMergeCompatibility(query, row.name).score };
    }).filter((item) => item.row.id !== excludeId && (item.exact || item.score >= 55)).sort((left, right) => Number(right.exact) - Number(left.exact) || right.score - left.score || left.row.name.localeCompare(right.row.name)).slice(0, 12);
  }, [excludeId, normalizedQuery, open, query, ubqRows]);
  return <><button className={`internal-search-button ${compact ? "compact" : ""}`} onClick={() => { setQuery(name); setOpen(true); }} title="Search exact and similar names in Root and UBQ"><Boxes size={14} />{compact ? "Internal" : "Search Root + UBQ"}</button>{open && <><div className="internal-search-scrim" onClick={() => setOpen(false)} /><aside className="internal-search-drawer"><header><div><small>INTERNAL BRAND RESEARCH</small><h2>Search Root and UBQ</h2><p>Root results are valid MERGE targets. UBQ results are similarity clues that may belong to the same family.</p></div><button className="icon-button" onClick={() => setOpen(false)}><X size={19} /></button></header><label className="internal-search-field"><Search size={18} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search brand name, alias, or brand ID…" /><kbd>{rootMatches.length + ubqMatches.length} matches</kbd></label><div className="internal-search-columns"><section><div className="internal-search-title"><Database size={16} /><span><b>Existing Root brands</b><small>Canonical brands and aliases · eligible MERGE targets</small></span><em>{rootMatches.length}</em></div>{rootMatches.length ? rootMatches.map(({ brand, exact, score }) => <article key={brand.id}><span><b>{brand.name}</b><code>{brand.id}</code><small>{brand.aliases.length ? `${brand.aliases.length} aliases · ${brand.aliases.slice(0, 3).join(", ")}` : "No aliases listed"}</small></span><strong className={exact ? "exact" : "similar"}>{exact ? "Exact" : `${score}% similar`}</strong><div><AdminBrandLink id={brand.id} name={brand.name} compact />{onMerge && <button className="primary" onClick={() => { onMerge(brand); setOpen(false); }}><Check size={13} />Use MERGE</button>}</div></article>) : <p className="internal-search-empty">No Root brands match this search.</p>}</section><section><div className="internal-search-title"><FileClock size={16} /><span><b>Related UBQ names</b><small>Unknown records · compare or triage, but never use as a MERGE target</small></span><em>{ubqMatches.length}</em></div>{ubqMatches.length ? ubqMatches.map(({ row, exact, score }) => <article key={row.id}><span><b>{row.name}</b><code>{row.id}</code><small>{(row.listingCount || 0).toLocaleString()} listings · {(row.skuCount || 0).toLocaleString()} SKUs</small></span><strong className={exact ? "exact" : "similar"}>{exact ? "Exact" : `${score}% similar`}</strong><div><AdminUnknownBrandLink name={row.name} compact /></div></article>) : <p className="internal-search-empty">No related UBQ names match this search.</p>}</section></div></aside></>}</>;
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

type CleanupCompareRecord = {
  id: string;
  name: string;
  kind: "ROOT" | "UBQ";
  role: string;
  aliases: string[];
  status?: string;
  sameAs?: string;
  listingCount?: number;
  skuCount?: number;
};

function CleanupComparisonDrawer({ issue, source, data, ubqSource, onClose, onReview, onConfirm, onPriority }: { issue: CleanupIssue; source: CleanupSource; data: AppData; ubqSource: UbqSource | null; onClose: () => void; onReview: () => void; onConfirm: () => void; onPriority: () => void }) {
  const rootById = new Map(data.rootBrands.map((brand) => [brand.id, brand]));
  const resolve = (id: string, role: string): CleanupCompareRecord | null => {
    const root = rootById.get(id);
    if (root) return { id: root.id, name: root.name, kind: "ROOT", role, aliases: root.aliases, status: root.rootStatus || "ACTIVE", sameAs: root.sameAs };
    const ubq = ubqSource?.byId.get(id);
    if (ubq) return { id: ubq.id, name: ubq.name, kind: "UBQ", role, aliases: [], listingCount: ubq.listingCount, skuCount: ubq.skuCount };
    return null;
  };
  const flagged = resolve(issue.brandId, "Flagged record") || { id: issue.brandId, name: issue.name, kind: source, role: "Flagged record", aliases: [] };
  const candidateIds = [...new Set([issue.targetId, ...(issue.related || []).map((item) => item.id)].filter(Boolean) as string[])].filter((id) => id !== issue.brandId).slice(0, 3);
  const candidates = candidateIds.map((id, index) => resolve(id, id === issue.targetId ? "Suggested canonical" : `Related record ${index + 1}`)).filter(Boolean) as CleanupCompareRecord[];
  const cards = [flagged, ...candidates];
  return <><div className="cleanup-compare-scrim" onClick={onClose} /><aside className="cleanup-compare-drawer"><header><div><span>SMART CLEANUP · SIDE-BY-SIDE REVIEW</span><h2>Compare before changing Admin</h2><p>Brandmaster found records that may compete for the same identity. Review both before editing, deleting, or moving aliases.</p></div><button className="icon-button" onClick={onClose} aria-label="Close comparison"><X size={20} /></button></header><section className="cleanup-compare-recommendation"><WandSparkles size={20} /><div><small>BRANDMASTER RECOMMENDATION</small><b>{issue.suggestion || issue.title}</b><p>{issue.reason}</p></div><strong>{issue.confidence}%<small>confidence</small></strong></section><div className={`cleanup-compare-grid ${cards.length > 2 ? "many" : ""}`}>{cards.map((record, index) => <article className={index === 0 ? "flagged" : "candidate"} key={record.id}><div className="cleanup-compare-card-head"><span>{index === 0 ? <CircleHelp size={16} /> : <ShieldCheck size={16} />}{record.role}</span><em>{record.kind === "ROOT" ? "Existing Root brand" : "Unknown-brand queue"}</em></div><h3>{record.name}</h3><code>{record.id}</code><dl><div><dt>Status</dt><dd>{record.status || (record.kind === "UBQ" ? "UNMAPPED" : "Unknown")}</dd></div>{record.sameAs && <div><dt>sameAs</dt><dd><code>{record.sameAs}</code></dd></div>}{record.kind === "UBQ" && <><div><dt>Listings</dt><dd>{(record.listingCount || 0).toLocaleString()}</dd></div><div><dt>SKUs</dt><dd>{(record.skuCount || 0).toLocaleString()}</dd></div></>}<div className="aliases"><dt>Aliases</dt><dd>{record.aliases.length ? record.aliases.slice(0, 8).map((alias) => <span key={alias}>{alias}</span>) : <small>No aliases listed</small>}{record.aliases.length > 8 && <small>+{record.aliases.length - 8} more</small>}</dd></div></dl><div className="cleanup-compare-research"><ResearchLinks name={record.name} compact /></div>{record.kind === "ROOT" ? <AdminBrandLink id={record.id} name={record.name} /> : <AdminUnknownBrandLink name={record.name} />}</article>)}</div>{!candidates.length && <div className="cleanup-compare-missing"><CircleHelp size={17} /><span><b>The related record is not available in the loaded tables.</b><small>Use research and Admin search to identify the correct canonical record before changing anything.</small></span></div>}<section className="cleanup-compare-guidance"><div><b>Recommended manual sequence</b><ol><li>Open each record in Admin.</li><li>Choose the legitimate canonical BrandID.</li><li>Move useful aliases, then consolidate, block, or delete the duplicate.</li><li>Reload the Root/UBQ table so Smart Cleanup can verify the result.</li></ol></div><p><ShieldCheck size={16} />Brandmaster does not delete source records from this screen.</p></section><footer><button className="secondary" onClick={onConfirm}><ShieldCheck size={15} />Both are valid — confirm clean</button><button className="secondary" onClick={onPriority}><Users size={15} />Send flagged record to High Priority</button><button className="primary" onClick={onReview}><WandSparkles size={15} />Review consolidation in Step 2</button></footer></aside></>;
}

function SmartCleanup({ data, ubqSource, onSaveRoot, onValidate, onAddPriority, onSetConfirmation, onNavigate }: { data: AppData; ubqSource: UbqSource | null; onSaveRoot: (brand: CatalogBrand) => void; onValidate: (source: "ROOT" | "UBQ", ids: string[]) => void; onAddPriority: (source: PriorityQueueSource, rows: ReturnType<typeof parseCsv>) => void; onSetConfirmation: (source: CleanupSource, rows: { brandId: string; name: string; fingerprint: string }[], status: "CONFIRMED" | "REOPENED") => void; onNavigate: (view: View) => void }) {
  const [source, setSource] = useState<CleanupSource>("ROOT");
  const [batchSize, setBatchSize] = useState<10 | 25 | 50>(25);
  const [severity, setSeverity] = useState<"ALL" | CleanupSeverity>("ALL");
  const [issues, setIssues] = useState<CleanupIssue[]>([]);
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [lastScan, setLastScan] = useState("");
  const [showConfirmed, setShowConfirmed] = useState(false);
  const [compareIssue, setCompareIssue] = useState<CleanupIssue | null>(null);
  const sourceCount = source === "ROOT" ? data.rootBrands.length : ubqSource?.count || 0;
  const sourceRecords = useMemo(() => {
    const records = new Map<string, CatalogBrand | ParsedRow>();
    if (source === "ROOT") data.rootBrands.forEach((brand) => records.set(brand.id, brand));
    else ubqSource?.byId.forEach((row, id) => records.set(id, row));
    return records;
  }, [source, data.rootBrands, ubqSource]);
  const fingerprintFor = (brandId: string) => { const record = sourceRecords.get(brandId); return record ? cleanupRecordFingerprint(source, record) : ""; };
  const activeConfirmations = data.cleanupConfirmations.filter((item) => item.source === source && item.status === "CONFIRMED" && item.fingerprint === fingerprintFor(item.brandId));
  const confirmedIds = new Set(activeConfirmations.map((item) => item.brandId));
  const unconfirmedIssues = issues.filter((issue) => !confirmedIds.has(issue.brandId));
  const filtered = unconfirmedIssues.filter((issue) => severity === "ALL" || issue.severity === severity);
  const page = filtered.slice(cursor, cursor + batchSize);
  const confirmedPage = activeConfirmations.slice(cursor, cursor + batchSize);
  const counts = cleanupIssueCounts(unconfirmedIssues);
  const queuedIds = new Set(data.priorityQueue.filter((item) => item.source === source).map((item) => item.brandId));
  const selectedIssues = page.filter((issue) => selected.includes(issue.key));

  function scan() {
    if (!sourceCount) { onNavigate("settings"); return; }
    setScanning(true); setSelected([]);
    setTimeout(() => {
      const found = source === "ROOT" ? analyzeRootBrands(data.rootBrands) : analyzeUbqBrands(ubqSource ? [...ubqSource.byId.values()] : [], data.rootBrands);
      setIssues(found); setCursor(0); setLastScan(new Date().toISOString()); setScanning(false);
    }, 500);
  }
  function confirmationRows(rows: CleanupIssue[]) { return rows.map((issue) => ({ brandId: issue.brandId, name: issue.name, fingerprint: fingerprintFor(issue.brandId) })).filter((item) => item.fingerprint); }
  function confirmRows(rows: CleanupIssue[]) { onSetConfirmation(source, confirmationRows(rows), "CONFIRMED"); setSelected([]); }
  function nextBatch() { const total = showConfirmed ? activeConfirmations.length : filtered.length; if (cursor + batchSize < total) setCursor(cursor + batchSize); else if (!showConfirmed) scan(); setSelected([]); }
  function queueRows(rows: CleanupIssue[]) {
    onAddPriority(source, rows.map((issue) => ({ id: issue.brandId, name: issue.name })));
    setSelected([]);
  }
  function applyQuickFix(issue: CleanupIssue) {
    const brand = data.rootBrands.find((item) => item.id === issue.brandId); if (!brand) return;
    if (issue.type === "NAME_CLEANUP" || issue.type === "SYMBOLS") {
      const name = issue.suggestion?.replace(/^Rename to\s+/i, "").trim(); if (!name || /review|block|correct/i.test(name)) { onValidate("ROOT", [issue.brandId]); return; }
      onSaveRoot({ ...brand, name }); setIssues((current) => current.filter((item) => item.brandId !== issue.brandId)); return;
    }
    if (issue.type === "ALIAS_CONFLICT" && issue.title === "Duplicate aliases on one brand") {
      const seen = new Set<string>(); const aliases = brand.aliases.filter((alias) => { const key = alias.toLowerCase().replace(/[^a-z0-9]+/g, ""); if (seen.has(key)) return false; seen.add(key); return true; });
      onSaveRoot({ ...brand, aliases }); setIssues((current) => current.filter((item) => item.brandId !== issue.brandId)); return;
    }
    onValidate("ROOT", [issue.brandId]);
  }
  const directFix = (issue: CleanupIssue) => source === "ROOT" && (issue.type === "NAME_CLEANUP" || (issue.type === "ALIAS_CONFLICT" && issue.title === "Duplicate aliases on one brand"));

  return <><PageHead eyebrow="ADMIN TOOLS · DATA QUALITY" title="Smart brand cleanup" body="Scan the Root or UBQ table for likely junk, duplicates, alias conflicts, broken targets, and existing-brand matches. Work through 10–50 prioritized findings at a time." actions={<button className="primary cleanup-magic" disabled={scanning || !sourceCount} onClick={scan}><WandSparkles className={scanning ? "spinning" : ""} size={17} />{scanning ? "Analyzing data…" : issues.length ? "Scan again" : "Find cleanup opportunities"}</button>} />
    <section className="cleanup-source-grid"><button className={source === "ROOT" ? "active" : ""} onClick={() => { setSource("ROOT"); setIssues([]); setCursor(0); setShowConfirmed(false); }}><span><Database size={22} /></span><div><small>AUTHORITATIVE CATALOG</small><b>Root table cleanup</b><p>{data.rootBrands.length.toLocaleString()} existing brands · names, aliases, duplicates, and target chains</p></div>{source === "ROOT" && <Check size={18} />}</button><button className={source === "UBQ" ? "active" : ""} onClick={() => { setSource("UBQ"); setIssues([]); setCursor(0); setShowConfirmed(false); }}><span><FileClock size={22} /></span><div><small>UNKNOWN BRAND QUEUE</small><b>UBQ cleanup</b><p>{(ubqSource?.count || 0).toLocaleString()} unknown brands · junk, families, and Root matches</p></div>{source === "UBQ" && <Check size={18} />}</button></section>
    {!sourceCount ? <section className="cleanup-empty panel"><div><Database size={28} /></div><h2>Load the {source === "ROOT" ? "Existing Brand Table (root table)" : "Full UBQ Export"} first</h2><p>Smart Cleanup runs locally against the tables already stored in Brandmaster.</p><button className="primary" onClick={() => onNavigate("settings")}>Open Data sources &amp; setup</button></section> : scanning ? <section className="cleanup-scanning"><div><WandSparkles size={28} /><i /><i /></div><span>SMART ANALYZER RUNNING</span><h2>Inspecting {sourceCount.toLocaleString()} {source === "ROOT" ? "existing brands" : "unknown-brand rows"}</h2><p>Checking names, aliases, duplicates, canonical targets, and known Root matches…</p></section> : !issues.length ? <section className="cleanup-start panel"><div className="cleanup-orbit"><WandSparkles size={31} /></div><span>READY WHEN YOU ARE</span><h2>Let Brandmaster find the next cleanup worklist</h2><p>The scan is deterministic and offline. It will not change data automatically; every suggestion remains under reviewer control.</p><div><label>Brands per worklist<select value={batchSize} onChange={(event) => setBatchSize(Number(event.target.value) as 10 | 25 | 50)}><option value={10}>10 brands</option><option value={25}>25 brands</option><option value={50}>50 brands</option></select></label><button className="primary" onClick={scan}><WandSparkles size={17} />Analyze {source === "ROOT" ? "Root table" : "UBQ export"}</button></div></section> : <>
      <section className="cleanup-summary"><div><span><ShieldCheck size={20} /></span><div><small>LAST SCAN</small><b>{source === "ROOT" ? "Root table" : "UBQ export"} · {lastScan ? `${fmtDate(lastScan)} at ${fmtTime(lastScan)}` : "just now"}</b><p>{unconfirmedIssues.length.toLocaleString()} open opportunities · {activeConfirmations.length.toLocaleString()} confirmed clean</p></div></div><div><button className={!showConfirmed && severity === "ALL" ? "active" : ""} onClick={() => { setShowConfirmed(false); setSeverity("ALL"); setCursor(0); }}>All <b>{unconfirmedIssues.length}</b></button><button className={!showConfirmed && severity === "HIGH" ? "active high" : "high"} onClick={() => { setShowConfirmed(false); setSeverity("HIGH"); setCursor(0); }}>High <b>{counts.HIGH}</b></button><button className={!showConfirmed && severity === "MEDIUM" ? "active medium" : "medium"} onClick={() => { setShowConfirmed(false); setSeverity("MEDIUM"); setCursor(0); }}>Medium <b>{counts.MEDIUM}</b></button><button className={!showConfirmed && severity === "LOW" ? "active low" : "low"} onClick={() => { setShowConfirmed(false); setSeverity("LOW"); setCursor(0); }}>Low <b>{counts.LOW}</b></button><button className={showConfirmed ? "active confirmed" : "confirmed"} onClick={() => { setShowConfirmed(true); setCursor(0); setSelected([]); }}><ShieldCheck size={13} />Confirmed <b>{activeConfirmations.length}</b></button><label>Show<select value={batchSize} onChange={(event) => { setBatchSize(Number(event.target.value) as 10 | 25 | 50); setCursor(0); }}><option value={10}>10 at a time</option><option value={25}>25 at a time</option><option value={50}>50 at a time</option></select></label></div></section>
      {!showConfirmed && selected.length > 0 && <div className="cleanup-bulk"><b>{selected.length} selected</b><button onClick={() => confirmRows(selectedIssues)}><ShieldCheck size={14} />Confirm no cleanup needed</button><button onClick={() => onValidate(source, selectedIssues.map((issue) => issue.brandId))}><WandSparkles size={14} />Review selected now</button><button onClick={() => queueRows(selectedIssues)}><Users size={14} />Send to high priority</button><button className="icon-button" onClick={() => setSelected([])}><X size={15} /></button></div>}
      {showConfirmed ? <section className="cleanup-results cleanup-confirmed-results"><div className="cleanup-results-head"><label><ShieldCheck size={15} />Confirmed as needing no cleanup</label><span>Showing {Math.min(cursor + 1, activeConfirmations.length)}–{Math.min(cursor + batchSize, activeConfirmations.length)} of {activeConfirmations.length.toLocaleString()}</span></div>{confirmedPage.length ? confirmedPage.map((item) => <article className="cleanup-confirmed-row" key={item.id}><span><ShieldCheck size={19} /></span><div><h3>{item.name}</h3><code>{item.brandId}</code><p>Confirmed clean by <b>@{item.confirmedBy}</b> on {fmtDate(item.confirmedAt)} at {fmtTime(item.confirmedAt)}. This confirmation is automatically retired if the source record changes.</p></div><div className="cleanup-confirmed-actions"><ResearchLinks name={item.name} compact />{source === "ROOT" ? <AdminBrandLink id={item.brandId} name={item.name} compact /> : <AdminUnknownBrandLink name={item.name} compact />}<button className="secondary" onClick={() => onSetConfirmation(source, [{ brandId: item.brandId, name: item.name, fingerprint: item.fingerprint }], "REOPENED")}><RotateCcw size={14} />Reopen cleanup</button></div></article>) : <div className="cleanup-confirmed-empty"><ShieldCheck size={26} /><b>No brands have been confirmed clean yet</b><p>Use “Confirm clean” on a finding after manual review.</p></div>}</section> : <section className="cleanup-results"><div className="cleanup-results-head"><label><input type="checkbox" checked={page.length > 0 && page.every((issue) => selected.includes(issue.key))} onChange={(event) => setSelected(event.target.checked ? page.map((issue) => issue.key) : [])} />Select this worklist</label><span>Showing {Math.min(cursor + 1, filtered.length)}–{Math.min(cursor + batchSize, filtered.length)} of {filtered.length.toLocaleString()}</span></div>{page.map((issue) => <article className={`cleanup-issue ${issue.severity.toLowerCase()}`} key={issue.key}><label><input type="checkbox" checked={selected.includes(issue.key)} onChange={(event) => setSelected(event.target.checked ? [...selected, issue.key] : selected.filter((key) => key !== issue.key))} /></label><span className="cleanup-issue-icon">{issue.type === "DUPLICATE" || issue.type === "UBQ_FAMILY" ? <Boxes size={19} /> : issue.type === "ALIAS_CONFLICT" ? <Tags size={19} /> : issue.type === "EXISTING_BRAND" ? <Check size={19} /> : issue.type === "BROKEN_TARGET" ? <History size={19} /> : <Sparkles size={19} />}</span><div className="cleanup-issue-main"><div><span className={`cleanup-severity ${issue.severity.toLowerCase()}`}>{issue.severity}</span><small>{issue.type.replaceAll("_", " ")}</small></div><h3>{issue.name}</h3><code>{issue.brandId}</code><b>{issue.title}</b><p>{issue.reason}</p>{issue.suggestion && <em><WandSparkles size={13} />Suggestion: {issue.suggestion}</em>}{issue.targetName && <span className="cleanup-target"><Boxes size={13} />Target: <b>{issue.targetName}</b><code>{issue.targetId}</code></span>}{issue.related?.length ? <div className="cleanup-related">{issue.related.slice(0, 3).map((item) => <span key={item.id}>{item.name}</span>)}{issue.related.length > 3 && <small>+{issue.related.length - 3} more</small>}</div> : null}</div><strong className="cleanup-confidence">{issue.confidence}%<small>confidence</small></strong><div className="cleanup-issue-actions">{directFix(issue) && <button className="primary" onClick={() => applyQuickFix(issue)}><Check size={14} />Apply suggested fix</button>}<button className="cleanup-confirm" onClick={() => confirmRows([issue])}><ShieldCheck size={14} />Confirm clean</button>{issue.targetId || issue.related?.length ? <button className="primary cleanup-compare-inline" onClick={() => setCompareIssue(issue)}><Boxes size={14} />Compare & clean up</button> : <button className={directFix(issue) ? "secondary" : "primary"} onClick={() => onValidate(source, [issue.brandId])}><WandSparkles size={14} />Review now</button>}<ResearchLinks name={issue.name} compact />{source === "ROOT" ? <AdminBrandLink id={issue.brandId} name={issue.name} compact /> : <AdminUnknownBrandLink name={issue.name} compact />}<button className="secondary" disabled={queuedIds.has(issue.brandId)} onClick={() => queueRows([issue])}><Users size={14} />{queuedIds.has(issue.brandId) ? "Already prioritized" : "High priority"}</button></div></article>)}</section>}
      <section className="cleanup-pagination"><button className="secondary" disabled={cursor === 0} onClick={() => { setCursor(Math.max(0, cursor - batchSize)); setSelected([]); }}><ChevronLeft size={15} />Previous {batchSize}</button><span><b>{Math.floor(cursor / batchSize) + 1}</b> of {Math.max(1, Math.ceil((showConfirmed ? activeConfirmations.length : filtered.length) / batchSize))} worklists</span>{showConfirmed ? <button className="primary" disabled={cursor + batchSize >= activeConfirmations.length} onClick={nextBatch}>Next {batchSize}<ChevronRight size={15} /></button> : <button className="primary" onClick={nextBatch}>{cursor + batchSize < filtered.length ? `Next ${batchSize}` : "Analyze again"}<ChevronRight size={15} /></button>}</section>
    </>}
    {compareIssue && <CleanupComparisonDrawer issue={compareIssue} source={source} data={data} ubqSource={ubqSource} onClose={() => setCompareIssue(null)} onReview={() => { setCompareIssue(null); onValidate(source, [compareIssue.brandId]); }} onConfirm={() => { confirmRows([compareIssue]); setCompareIssue(null); }} onPriority={() => { queueRows([compareIssue]); setCompareIssue(null); }} />}
  </>;
}

function BrandDatabase({ data, ubqSource, query, onSave, onUndoRootChange, onUpdateRootTask, onValidate, onAddPriority }: { data: AppData; ubqSource: UbqSource | null; query: string; onSave: (brand: CatalogBrand) => void; onUndoRootChange: (id: string) => void; onUpdateRootTask: (id: string, status: NonNullable<AppData["rootChanges"][string]["adminStatus"]>) => void; onValidate: (source: "ROOT" | "UBQ", ids: string[]) => void; onAddPriority: (source: PriorityQueueSource, rows: ReturnType<typeof parseCsv>) => void }) {
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
      {ubqOpen && <div className="ubq-worklist"><div className="ubq-worklist-tools"><label><Search size={14} /><input value={ubqQuery} onChange={(event) => setUbqQuery(event.target.value)} placeholder="Find an unmapped UBQ brand…" /></label><span>{selectedUbq.length} selected</span><button className="secondary" disabled={!selectedUbq.length} onClick={() => onAddPriority("UBQ", selectedUbq.map((id) => ubqSource?.byId.get(id)).filter(Boolean) as ParsedRow[])}><Users size={14} />Send to high priority</button><button className="primary" disabled={!selectedUbq.length} onClick={() => onValidate("UBQ", selectedUbq)}><WandSparkles size={14} />Validate selected in Step 2</button></div>{!ubqSource ? <EmptyState icon={Database} title="No UBQ table loaded" body="Open Validation modules and load the full UBQ export once; it will then be available here." /> : <div className="ubq-select-table">
        <div><input type="checkbox" checked={ubqRows.length > 0 && ubqRows.every((row) => selectedUbq.includes(row.id))} onChange={(event) => setSelectedUbq(event.target.checked ? ubqRows.map((row) => row.id) : [])} /><b>Unmapped brand</b><b>UnmappedBrandID</b><b>Listings</b><b>SKUs</b><b>Admin queue</b></div>
        {ubqRows.map((row) => <div key={row.id}><input type="checkbox" checked={selectedUbq.includes(row.id)} onChange={(event) => setSelectedUbq(event.target.checked ? [...new Set([...selectedUbq, row.id])] : selectedUbq.filter((id) => id !== row.id))} /><b>{row.name}</b><code>{row.id}</code><span>{row.listingCount ?? "—"}</span><span>{row.skuCount ?? "—"}</span><AdminUnknownBrandLink name={row.name} compact /></div>)}
      </div>}</div>}
    </section>
    {(rootChanges.length > 0 || appliedRootTasks.length > 0) && <section className="root-task-center"><div className="root-task-center-head"><span><FileClock size={20} /></span><div><b>Root Admin task center</b><p>{rootChanges.length} pending · {rootTasks.filter((task) => task.adminStatus === "COMPLETED" && task.status !== "APPLIED").length} completed but awaiting verification · {appliedRootTasks.length} verified</p></div>{rootChanges.length > 0 && <button className="primary" onClick={() => download("brandmaster-root-table-changes.csv", toRootChangesCsv(rootChanges))}><ArrowDownToLine size={15} />Download pending changes</button>}</div><div className="root-task-list">{rootTasks.filter((change) => change.adminStatus !== "REJECTED" && change.adminStatus !== "SUPERSEDED").slice(0, 8).map((change) => <div key={change.id} className={change.status === "APPLIED" ? "verified" : ""}><span className="task-state">{change.status === "APPLIED" ? <Check size={14} /> : change.adminStatus === "COMPLETED" ? <History size={14} /> : <FileClock size={14} />}</span><span className="task-copy"><b>{change.before?.name || "New brand"} → {change.after.name}</b><small>{change.adminStatus || "RECOMMENDED"} · {change.changedFields.join(", ")}{change.verificationNote ? ` · ${change.verificationNote}` : ""}</small></span><div className="task-actions"><AdminBrandLink id={change.after.id} name={change.after.name} compact onOpen={() => onUpdateRootTask(change.id, "OPENED")} />{change.status !== "APPLIED" && <button className="secondary" onClick={() => onUpdateRootTask(change.id, "COMPLETED")}><Check size={12} />Done in Admin</button>}<button className="icon-button" title={change.status === "APPLIED" ? "Dismiss verified task" : "Reject and undo recommendation"} onClick={() => change.status === "APPLIED" ? onUndoRootChange(change.id) : onUpdateRootTask(change.id, "REJECTED")}><X size={13} /></button></div></div>)}</div></section>}
    {conflicts.length > 0 && <section className="conflict-banner"><div><CircleHelp size={18} /><span><b>{conflicts.length} alias or canonical-name {conflicts.length === 1 ? "conflict" : "conflicts"}</b><p>A lookup value points to more than one BrandID. Resolve these before trusting automatic MERGE recommendations.</p></span></div><button className={conflictsOnly ? "primary" : "secondary"} onClick={() => setConflictsOnly(!conflictsOnly)}>{conflictsOnly ? "Show all brands" : `Review ${conflicts.length} conflicts`}</button></section>}
    <div className="catalog-toolbar"><label><Search size={15} /><input value={localQuery} onChange={(event) => setLocalQuery(event.target.value)} placeholder="Filter name, ID, alias, category…" /></label><select value={source} onChange={(event) => setSource(event.target.value)}><option>All</option>{sources.map((item) => <option key={item}>{item}</option>)}</select>{selectedRoot.length > 0 && <><button className="secondary" onClick={() => onAddPriority("ROOT", selectedRoot.map((id) => data.rootBrands.find((brand) => brand.id === id)).filter(Boolean).map((brand) => ({ id: brand!.id, name: brand!.name })))}><Users size={14} />Send {selectedRoot.length} to high priority</button><button className="primary" onClick={() => onValidate("ROOT", selectedRoot)}><WandSparkles size={14} />Validate {selectedRoot.length} now</button></>}<span>{brands.length.toLocaleString()} results</span></div>
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
  const [query, setQuery] = useState("");
  const [source, setSource] = useState("ALL");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const brands = useMemo(() => effectiveCatalogBrands(data), [data]);
  const allAliases = useMemo(() => brands.flatMap((brand) => brand.aliases.map((alias) => ({ alias, brand }))).sort((a, b) => a.alias.localeCompare(b.alias)), [brands]);
  const sources = useMemo(() => [...new Set(allAliases.map(({ brand }) => brand.source || "Manual"))].sort(), [allAliases]);
  const aliases = useMemo(() => allAliases.filter(({ alias, brand }) => {
    const term = query.trim().toLowerCase();
    return (!term || `${alias} ${brand.name} ${brand.id} ${brand.category} ${brand.source || "Manual"}`.toLowerCase().includes(term))
      && (source === "ALL" || (brand.source || "Manual") === source);
  }), [allAliases, query, source]);
  const pages = Math.max(1, Math.ceil(aliases.length / pageSize));
  const visible = aliases.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => setPage(1), [query, source, pageSize]);
  return <><PageHead eyebrow="KNOWLEDGE BASE" title="Brand aliases" body="Alternate names resolve to a single canonical catalog brand. Filter the list, then open any row to correct its alias list." actions={<span className="status ready"><Pencil size={12} />Editable locally</span>} />
    <div className="record-filters"><label className="filter-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find alias, canonical brand, or BrandID…" /></label><label><span>Source</span><select value={source} onChange={(event) => setSource(event.target.value)}><option value="ALL">All sources</option>{sources.map((item) => <option key={item}>{item}</option>)}</select></label><strong>{aliases.length.toLocaleString()} of {allAliases.length.toLocaleString()} aliases</strong>{(query || source !== "ALL") && <button className="text-button" onClick={() => { setQuery(""); setSource("ALL"); }}>Clear filters</button>}</div>
    <div className="table-panel"><div className="data-table alias-table managed"><div className="table-row table-head-row"><div>Alias</div><div>Canonical brand</div><div>Brand ID</div><div>Match type</div><div>Source</div><div /></div>{visible.map(({ alias, brand }) => <div className="table-row" key={`${brand.id}-${alias}`}><div><b>{alias}</b></div><div>{brand.name}</div><div><code>{brand.id}</code></div><div><span className="category">Exact alias</span></div><div>{brand.source || "Manual"}</div><div><button className="icon-button row-edit" onClick={() => setEditing(brand)} title={`Edit aliases for ${brand.name}`}><Pencil size={14} /></button></div></div>)}</div>{!visible.length && <EmptyState icon={Tags} title={allAliases.length ? "No aliases match these filters" : "No aliases yet"} body={allAliases.length ? "Clear or change the filters to see more aliases." : "Open Brand management and add aliases to a canonical brand."} />}
      {aliases.length > 0 && <div className="catalog-pagination"><span>Rows per page <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></span><b>{`${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, aliases.length)} of ${aliases.length.toLocaleString()}`}</b><button className="icon-button" disabled={page === 1} onClick={() => setPage((current) => current - 1)}><ChevronLeft size={16} /></button><button className="icon-button" disabled={page === pages} onClick={() => setPage((current) => current + 1)}><ChevronRight size={16} /></button></div>}
    </div>{editing && <CatalogBrandDrawer key={editing.id} brand={editing} isNew={false} onClose={() => setEditing(null)} onSave={onSave} />}</>;
}

function Ledger({ entries, records }: { entries: LedgerEntry[]; records: BrandRecord[] }) {
  const [query, setQuery] = useState("");
  const [action, setAction] = useState<"ALL" | Action>("ALL");
  const [source, setSource] = useState("ALL");
  const [reviewer, setReviewer] = useState("ALL");
  const [confidence, setConfidence] = useState<"ALL" | "HIGH" | "REVIEW" | "LOW">("ALL");
  const [range, setRange] = useState<"ALL" | "TODAY" | "7" | "30">("ALL");
  const [order, setOrder] = useState<"NEWEST" | "OLDEST">("NEWEST");
  const sources = useMemo(() => [...new Set(entries.map((entry) => entry.decisionSource || "Legacy decision"))].sort(), [entries]);
  const reviewers = useMemo(() => [...new Set(entries.map((entry) => entry.reviewer || "Unattributed"))].sort(), [entries]);
  const filtered = useMemo(() => entries.filter((entry) => {
    const term = query.trim().toLowerCase();
    const age = Date.now() - new Date(entry.date).getTime();
    const withinRange = range === "ALL" || (range === "TODAY" ? new Date(entry.date).toDateString() === new Date().toDateString() : age >= 0 && age <= Number(range) * 86_400_000);
    const confidenceMatches = confidence === "ALL" || (confidence === "HIGH" ? entry.confidence >= 90 : confidence === "REVIEW" ? entry.confidence >= 70 && entry.confidence < 90 : entry.confidence < 70);
    return (!term || `${entry.name} ${entry.normalized} ${entry.id} ${entry.targetName || ""} ${entry.targetId || ""} ${entry.reason} ${entry.reviewer || "Unattributed"} ${entry.decisionSource || "Legacy decision"}`.toLowerCase().includes(term))
      && (action === "ALL" || entry.action === action)
      && (source === "ALL" || (entry.decisionSource || "Legacy decision") === source)
      && (reviewer === "ALL" || (entry.reviewer || "Unattributed") === reviewer)
      && confidenceMatches && withinRange;
  }).sort((left, right) => order === "NEWEST" ? right.date.localeCompare(left.date) : left.date.localeCompare(right.date)), [entries, query, action, source, reviewer, confidence, range, order]);
  const filtersActive = Boolean(query) || action !== "ALL" || source !== "ALL" || reviewer !== "ALL" || confidence !== "ALL" || range !== "ALL" || order !== "NEWEST";
  const exportRecords = entries.length ? filtered : records;
  function clearFilters() { setQuery(""); setAction("ALL"); setSource("ALL"); setReviewer("ALL"); setConfidence("ALL"); setRange("ALL"); setOrder("NEWEST"); }
  return <><PageHead eyebrow="DECISION HISTORY" title="Review history" body="See every approved, corrected, or AI-imported brand decision. History stays in the workspace and is included in backups and Team Sync." actions={<><button className="secondary" disabled={!filtered.length} title="External report columns: Brand, DATE, ACTION" onClick={() => download("brandmaster-external-progress-report.csv", reviewHistoryProgressCsv(filtered))}><ArrowDownToLine size={16} />External progress report</button><button className="secondary" disabled={!exportRecords.length} onClick={() => download("brandmaster-review-history.json", JSON.stringify(exportRecords, null, 2), "application/json")}><ArrowDownToLine size={16} />Export shown details</button><button className="primary" disabled={!exportRecords.length} onClick={() => download("brandmaster-decisions.csv", toCsv(exportRecords))}><ArrowDownToLine size={16} />Export shown CSV</button></>} />
    <section className="history-explainer"><div><Check size={17} /><span><b>What is recorded?</b><p>Saving a decision, using a bulk review action, or applying validated AI JSON creates a dated entry.</p></span></div><div><History size={17} /><span><b>How are corrections handled?</b><p>A correction adds a new entry. The newest reviewed decision is used for future validation.</p></span></div><div><ShieldCheck size={17} /><span><b>Where is it stored?</b><p>In this workspace. It is included when you download a backup or push changes through Team Sync.</p></span></div></section>
    {entries.length > 0 && <div className="record-filters ledger-filters"><label className="filter-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find brand, ID, target, reason, or reviewer…" /></label><label><span>Action</span><select value={action} onChange={(event) => setAction(event.target.value as "ALL" | Action)}><option value="ALL">All actions</option>{(["MERGE", "CREATE", "SKIP", "DELETE"] as Action[]).map((item) => <option key={item}>{item}</option>)}</select></label><label><span>Source</span><select value={source} onChange={(event) => setSource(event.target.value)}><option value="ALL">All sources</option>{sources.map((item) => <option key={item}>{item}</option>)}</select></label><label><span>Reviewer</span><select value={reviewer} onChange={(event) => setReviewer(event.target.value)}><option value="ALL">All reviewers</option>{reviewers.map((item) => <option key={item}>{item}</option>)}</select></label><label><span>Confidence</span><select value={confidence} onChange={(event) => setConfidence(event.target.value as typeof confidence)}><option value="ALL">Any confidence</option><option value="HIGH">90–100%</option><option value="REVIEW">70–89%</option><option value="LOW">Below 70%</option></select></label><label><span>Date</span><select value={range} onChange={(event) => setRange(event.target.value as typeof range)}><option value="ALL">All dates</option><option value="TODAY">Today</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option></select></label><label><span>Order</span><select value={order} onChange={(event) => setOrder(event.target.value as typeof order)}><option value="NEWEST">Newest first</option><option value="OLDEST">Oldest first</option></select></label><strong>{filtered.length.toLocaleString()} of {entries.length.toLocaleString()}</strong>{filtersActive && <button className="text-button" onClick={clearFilters}>Clear filters</button>}</div>}
    <div className="table-panel">{entries.length ? filtered.length ? <div className="data-table ledger-table"><div className="table-row table-head-row"><div>Reviewed on</div><div>Input brand</div><div>Decision</div><div>Target / reason</div><div>Confidence</div><div>Reviewed by</div></div>{filtered.map((entry) => { const reviewedBy = entry.reviewer || "Unattributed"; return <div className="table-row" key={entry.ledgerId}><div><b>{fmtDate(entry.date)}</b><small>{fmtTime(entry.date)}</small></div><div><b>{entry.name}</b><small>{entry.name !== entry.normalized ? `Normalized: ${entry.normalized}` : entry.id}</small></div><div><ActionPill action={entry.action} /></div><div><b>{entry.targetName || "No target brand"}</b><small>{entry.reason}</small></div><div><Confidence value={entry.confidence} /></div><div><span className="reviewer-avatar">{reviewedBy.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span>{reviewedBy}<small>{entry.decisionSource || "Legacy decision"}</small></div></div>; })}</div> : <EmptyState icon={Search} title="No decisions match these filters" body="Clear one or more filters to see the hidden review history." action={<button className="secondary" onClick={clearFilters}>Clear all filters</button>} /> : <EmptyState icon={History} title="No reviewed decisions yet" body="Open Process & Review and save a brand decision. Your first review will appear here with its date, action, target, and reason." action={<span className="status ready"><History size={12} />Automatic recommendations are not added until reviewed</span>} />}</div></>;
}

function DataQualityAnalytics({ data, ubqSource, onAddPriority, onNavigate }: { data: AppData; ubqSource: UbqSource | null; onAddPriority: (source: PriorityQueueSource, rows: ReturnType<typeof parseCsv>) => void; onNavigate: (view: View) => void }) {
  const [source, setSource] = useState<"ALL" | CleanupSource>("ALL");
  const [severity, setSeverity] = useState<"ALL" | CleanupSeverity>("ALL");
  const [issueType, setIssueType] = useState("ALL");
  const [selectedIssues, setSelectedIssues] = useState<string[]>([]);
  const qualityScore = (issue: CleanupIssue) => Math.min(100, (issue.severity === "HIGH" ? 60 : issue.severity === "MEDIUM" ? 38 : 20) + Math.round(issue.confidence * .25) + (issue.source === "ROOT" ? 10 : 5));
  const ubqRows = useMemo(() => ubqSource ? [...ubqSource.byId.values()] : [], [ubqSource]);
  const rootIssues = useMemo(() => analyzeRootBrands(data.rootBrands), [data.rootBrands]);
  const ubqIssues = useMemo(() => analyzeUbqBrands(ubqRows, data.rootBrands), [ubqRows, data.rootBrands]);
  const allIssues = useMemo(() => [...rootIssues, ...ubqIssues], [rootIssues, ubqIssues]);
  const filteredIssues = useMemo(() => allIssues.filter((issue) => (source === "ALL" || issue.source === source) && (severity === "ALL" || issue.severity === severity) && (issueType === "ALL" || issue.type === issueType)).sort((left, right) => qualityScore(right) - qualityScore(left)), [allIssues, source, severity, issueType]);
  const severityCounts = cleanupIssueCounts(allIssues);
  const typeCounts = useMemo(() => allIssues.reduce<Record<string, number>>((counts, issue) => ({ ...counts, [issue.type]: (counts[issue.type] || 0) + 1 }), {}), [allIssues]);
  const totalRows = data.rootBrands.length + ubqRows.length;
  const affectedRows = new Set(allIssues.map((issue) => `${issue.source}:${issue.brandId}`)).size;
  const health = totalRows ? Math.max(0, Math.round((1 - affectedRows / totalRows) * 100)) : 0;
  const topUbq = useMemo(() => [...ubqRows].sort((left, right) => (right.listingCount || 0) - (left.listingCount || 0) || (right.skuCount || 0) - (left.skuCount || 0)).slice(0, 8), [ubqRows]);
  const topRoot = useMemo(() => data.rootBrands.filter((brand) => (brand.rootStatus || "ACTIVE") === "ACTIVE").sort((left, right) => right.aliases.length - left.aliases.length || left.name.localeCompare(right.name)).slice(0, 8), [data.rootBrands]);
  const aliasRisks = useMemo(() => data.rootBrands.flatMap((brand) => brand.aliases.map((alias) => ({ brand, alias, compatibility: assessMergeCompatibility(alias, brand.name) }))).filter(({ alias, brand, compatibility }) => alias.trim().length >= 4 && normalizeBrand(alias).toLowerCase() !== normalizeBrand(brand.name).toLowerCase() && !compatibility.safe).sort((left, right) => left.compatibility.score - right.compatibility.score).slice(0, 12), [data.rootBrands]);
  const categoryData = [
    { key: "DUPLICATE", label: "Duplicates", color: "blue" },
    { key: "ALIAS_CONFLICT", label: "Alias conflicts", color: "purple" },
    { key: "JUNK", label: "Nonsense / placeholders", color: "red" },
    { key: "SYMBOLS", label: "Symbols", color: "yellow" },
    { key: "EXISTING_BRAND", label: "UBQ matches Root", color: "green" },
    { key: "UBQ_FAMILY", label: "Related UBQ families", color: "teal" },
  ];
  const maxCategory = Math.max(1, ...categoryData.map((item) => typeCounts[item.key] || 0));
  const queueByKey = useMemo(() => new Map(normalizePriorityQueueItems(data.priorityQueue).map((item) => [item.taskKey || priorityTaskKey(item.source, item.brandId, item.name), item])), [data.priorityQueue]);
  const taskFor = (itemSource: CleanupSource, brandId: string, name: string) => queueByKey.get(priorityTaskKey(itemSource, brandId, name));
  const activeQualityQueue = data.priorityQueue.filter(isActivePriorityTask);
  const queueCounts = {
    available: activeQualityQueue.filter((item) => item.status === "UNASSIGNED").length,
    assigned: activeQualityQueue.filter((item) => item.status === "ASSIGNED").length,
    review: activeQualityQueue.filter((item) => item.status === "IN_REVIEW").length,
    ready: activeQualityQueue.filter((item) => item.status === "COMPLETED").length,
    awaiting: activeQualityQueue.filter((item) => item.externalStatus === "DONE_PENDING_VERIFICATION" || item.externalStatus === "EXPORTED_PENDING_VERIFICATION").length,
    verified: data.priorityQueue.filter((item) => !item.resolvedWithoutMappingAt && item.externalStatus === "VERIFIED").length,
    blocked: activeQualityQueue.filter((item) => item.status === "BLOCKED").length,
  };
  const freshness = (["ROOT", "UBQ"] as const).map((key) => {
    const meta = data.sourceMeta[key];
    const days = meta?.updatedAt ? Math.max(0, Math.floor((Date.now() - new Date(meta.updatedAt).getTime()) / 86_400_000)) : undefined;
    return { key, meta, days, stale: days === undefined || days > 7 };
  });
  const pendingVerification = data.adminUpdateRuns.flatMap((run) => run.items).filter((item) => item.status === "AWAITING_NEWER_DATA" || item.status === "PARTIALLY_APPLIED").length;
  const queueIssue = (issue: CleanupIssue) => onAddPriority(issue.source, [{ id: issue.brandId, name: issue.name }]);
  const openQueue = (filter: PriorityQueueStatus) => { sessionStorage.setItem("brandmaster.queue.filter", filter); onNavigate("imports"); };
  const applyQualityView = (next: "HIGH_ROOT" | "UBQ_SKIP" | "DUPLICATES" | "ALL") => {
    if (next === "HIGH_ROOT") { setSource("ROOT"); setSeverity("HIGH"); setIssueType("ALL"); }
    if (next === "UBQ_SKIP") { setSource("UBQ"); setSeverity("ALL"); setIssueType("JUNK"); }
    if (next === "DUPLICATES") { setSource("ALL"); setSeverity("ALL"); setIssueType("DUPLICATE"); }
    if (next === "ALL") { setSource("ALL"); setSeverity("ALL"); setIssueType("ALL"); }
    setSelectedIssues([]);
    document.getElementById("quality-attention")?.scrollIntoView({ behavior: "smooth" });
  };
  const bulkQueueIssues = () => {
    const chosen = allIssues.filter((issue) => selectedIssues.includes(issue.key));
    (["ROOT", "UBQ"] as const).forEach((itemSource) => {
      const rows = chosen.filter((issue) => issue.source === itemSource).map((issue) => ({ id: issue.brandId, name: issue.name }));
      if (rows.length) onAddPriority(itemSource, rows);
    });
    setSelectedIssues([]);
  };
  const taskAction = (itemSource: CleanupSource, brandId: string, name: string, add: () => void) => {
    const task = taskFor(itemSource, brandId, name);
    if (!task) return <button onClick={add}>Triage</button>;
    const done = task.status === "COMPLETED" || task.externalStatus === "VERIFIED";
    return <button className={done ? "quality-task-state done" : "quality-task-state"} onClick={() => onNavigate("imports")} title={task.assignedTo ? `${task.status.replaceAll("_", " ")} · ${task.assignedTo}` : task.status.replaceAll("_", " ")}>{done ? <Check size={12} /> : <Users size={12} />}{done ? "Completed" : task.assignedTo ? `${task.assignedTo} · ${task.status === "IN_REVIEW" ? "working" : "assigned"}` : "In team queue"}</button>;
  };
  return <>
    <PageHead eyebrow="CATALOG INTELLIGENCE" title="Data quality analytics" body="A separate health view for the Root brand catalog and Unknown Brand Queue. Every chart leads to a cleanup action or team worklist." actions={<button className="primary" onClick={() => onNavigate("cleanup")}><WandSparkles size={16} />Open Smart Cleanup</button>} />
    {!data.rootBrands.length && !ubqRows.length ? <div className="panel"><EmptyState icon={Database} title="Load Root and UBQ data to begin" body="Open Data sources & setup and load the latest Root table and full UBQ export. This page analyzes them locally and works offline." action={<button className="primary" onClick={() => onNavigate("settings")}>Open Data sources & setup</button>} /></div> : <>
      <section className="quality-hero">
        <div className="quality-score" style={{ "--quality-score": `${health}%` } as React.CSSProperties}><span><b>{health}%</b><small>catalog health</small></span></div>
        <div><small>COMBINED QUALITY SNAPSHOT</small><h2>{affectedRows.toLocaleString()} brands need attention</h2><p>Across {data.rootBrands.length.toLocaleString()} Root brands and {ubqRows.length.toLocaleString()} UBQ records. A finding is a review signal—not an automatic deletion.</p><div className="quality-severity-track"><i className="high" style={{ flex: severityCounts.HIGH || 0 }} /><i className="medium" style={{ flex: severityCounts.MEDIUM || 0 }} /><i className="low" style={{ flex: severityCounts.LOW || 0 }} /></div></div>
        <aside><b>{severityCounts.HIGH}<small>high risk</small></b><b>{severityCounts.MEDIUM}<small>review</small></b><b>{severityCounts.LOW}<small>cleanup</small></b></aside>
      </section>
      <section className="quality-trust-strip">
        {freshness.map(({ key, meta, days, stale }) => <div className={stale ? "stale" : "fresh"} key={key}><span>{stale ? <CircleHelp size={17} /> : <Check size={17} />}</span><div><b>{key} source {meta ? `${days} day${days === 1 ? "" : "s"} old` : "not loaded"}</b><small>{meta ? `${meta.filename} · ${meta.rowCount?.toLocaleString() || "unknown"} rows` : `Load the latest ${key} export before relying on cleanup results.`}</small></div>{stale && <button onClick={() => onNavigate("settings")}>Update source</button>}</div>)}
        <div className={pendingVerification ? "waiting" : "fresh"}><span>{pendingVerification ? <History size={17} /> : <ShieldCheck size={17} />}</span><div><b>{pendingVerification.toLocaleString()} changes awaiting source verification</b><small>{pendingVerification ? "Upload a newer Root or UBQ export to prove whether Admin applied them." : "No submitted changes are waiting for a newer source snapshot."}</small></div>{pendingVerification > 0 && <button onClick={() => onNavigate("settings")}>View reconciliation</button>}</div>
      </section>
      <section className="quality-lifecycle"><div><small>SHARED TRIAGE LIFECYCLE</small><h2>What the team is working on</h2><p>Click a total to open that exact queue. One brand keeps one protected shared task.</p></div><button onClick={() => openQueue("UNASSIGNED")}><b>{queueCounts.available}</b><small>Available</small></button><button onClick={() => openQueue("ASSIGNED")}><b>{queueCounts.assigned}</b><small>Assigned</small></button><button onClick={() => openQueue("IN_REVIEW")}><b>{queueCounts.review}</b><small>In review</small></button><button onClick={() => onNavigate("output")}><b>{queueCounts.ready}</b><small>Ready</small></button><button onClick={() => onNavigate("settings")}><b>{queueCounts.awaiting}</b><small>Awaiting proof</small></button><button className="verified" onClick={() => openQueue("COMPLETED")}><b>{queueCounts.verified}</b><small>Verified</small></button>{queueCounts.blocked > 0 && <button className="blocked" onClick={() => openQueue("BLOCKED")}><b>{queueCounts.blocked}</b><small>Blocked</small></button>}</section>
      <section className="quality-source-grid">
        <article className="root"><span><Database size={21} /></span><div><small>ROOT TABLE</small><h2>{rootIssues.length.toLocaleString()} findings</h2><p>{(typeCounts.DUPLICATE || 0).toLocaleString()} duplicates · {(typeCounts.ALIAS_CONFLICT || 0).toLocaleString()} alias conflicts · {aliasRisks.length.toLocaleString()} possible unrelated aliases</p></div><button onClick={() => { setSource("ROOT"); document.getElementById("quality-attention")?.scrollIntoView({ behavior: "smooth" }); }}>Review Root findings</button></article>
        <article className="ubq"><span><FileClock size={21} /></span><div><small>UNKNOWN BRAND QUEUE</small><h2>{ubqIssues.length.toLocaleString()} findings</h2><p>{ubqIssues.filter((issue) => issue.type === "JUNK" || issue.type === "SYMBOLS").length.toLocaleString()} likely SKIP / DELETE · {ubqIssues.filter((issue) => issue.type === "EXISTING_BRAND").length.toLocaleString()} Root matches</p></div><button onClick={() => { setSource("UBQ"); document.getElementById("quality-attention")?.scrollIntoView({ behavior: "smooth" }); }}>Review UBQ findings</button></article>
      </section>
      <section className="quality-dashboard-grid">
        <article className="panel quality-category-chart"><div className="panel-head"><div><h2>Why brands need attention</h2><p>Issue volume by validation rule · click a bar to filter</p></div><strong>{allIssues.length.toLocaleString()}<small>total signals</small></strong></div><div>{categoryData.map((item) => <button className={issueType === item.key ? "active" : ""} key={item.key} onClick={() => { setIssueType(issueType === item.key ? "ALL" : item.key); setSeverity("ALL"); document.getElementById("quality-attention")?.scrollIntoView({ behavior: "smooth" }); }}><span>{item.label}</span><i><em className={item.color} style={{ width: `${(typeCounts[item.key] || 0) / maxCategory * 100}%` }} /></i><b>{typeCounts[item.key] || 0}</b></button>)}</div></article>
        <article className="panel quality-priority"><div className="panel-head"><div><h2>Recommended first</h2><p>Highest-risk cleanup opportunities</p></div><ShieldCheck size={18} /></div>{allIssues.slice(0, 6).map((issue) => <div key={issue.key}><span className={issue.severity.toLowerCase()}>{issue.severity[0]}</span><div><b>{issue.name}</b><small>{issue.title} · {issue.source}</small></div>{taskAction(issue.source, issue.brandId, issue.name, () => queueIssue(issue))}</div>)}</article>
      </section>
      <section className="quality-top-grid">
        <article className="panel"><div className="panel-head"><div><h2>Top UBQ brands</h2><p>Highest listing volume—search Root and UBQ, research externally, or send to triage</p></div></div><div className="quality-ranking">{topUbq.map((row, index) => <div key={row.id}><em>{index + 1}</em><span><b>{row.name}</b><small>{row.id}</small></span><strong>{(row.listingCount || 0).toLocaleString()}<small>listings</small></strong><div className="quality-row-actions"><InternalBrandSearch name={row.name} rootBrands={data.rootBrands} ubqRows={ubqRows} compact excludeId={row.id} /><ResearchLinks name={row.name} compact /><AdminUnknownBrandLink name={row.name} compact />{taskAction("UBQ", row.id, row.name, () => onAddPriority("UBQ", [{ id: row.id, name: row.name, listingCount: row.listingCount, skuCount: row.skuCount }]))}</div></div>)}</div></article>
        <article className="panel"><div className="panel-head"><div><h2>Root brands with most aliases</h2><p>Compare internal names and aliases or open the exact BrandID in Admin</p></div></div><div className="quality-ranking">{topRoot.map((brand, index) => <div key={brand.id}><em>{index + 1}</em><span><b>{brand.name}</b><small>{brand.id}</small></span><strong>{brand.aliases.length}<small>aliases</small></strong><div className="quality-row-actions"><InternalBrandSearch name={brand.name} rootBrands={data.rootBrands} ubqRows={ubqRows} compact excludeId={brand.id} /><ResearchLinks name={brand.name} compact /><AdminBrandLink id={brand.id} name={brand.name} compact />{taskAction("ROOT", brand.id, brand.name, () => onAddPriority("ROOT", [{ id: brand.id, name: brand.name }]))}</div></div>)}</div></article>
      </section>
      {aliasRisks.length > 0 && <section className="panel quality-alias-review"><div className="panel-head"><div><h2>Aliases that need a human check</h2><p>These aliases have weak name identity with their canonical brand. They may be legitimate acquired brands, so Brandmaster never removes them automatically.</p></div><button className="secondary" onClick={() => onNavigate("aliases")}>Open alias management</button></div><div>{aliasRisks.slice(0, 8).map(({ brand, alias, compatibility }) => <span key={`${brand.id}:${alias}`}><b>{alias}</b><em>→</em><strong>{brand.name}</strong><small>{compatibility.reason}</small><div className="quality-row-actions"><ResearchLinks name={alias} compact /><AdminBrandLink id={brand.id} name={brand.name} compact />{taskAction("ROOT", brand.id, brand.name, () => onAddPriority("ROOT", [{ id: brand.id, name: brand.name }]))}</div></span>)}</div></section>}
      <section id="quality-attention" className="panel quality-attention"><div className="panel-head"><div><h2>Brands needing attention</h2><p>Ranked by risk, impact, and source. Select several findings to create one protected team worklist.</p></div><div><select value={source} onChange={(event) => setSource(event.target.value as typeof source)}><option value="ALL">Root + UBQ</option><option value="ROOT">Root only</option><option value="UBQ">UBQ only</option></select><select value={severity} onChange={(event) => setSeverity(event.target.value as typeof severity)}><option value="ALL">All severity</option><option value="HIGH">High risk</option><option value="MEDIUM">Needs review</option><option value="LOW">Cleanup</option></select><select value={issueType} onChange={(event) => setIssueType(event.target.value)}><option value="ALL">All issue types</option>{categoryData.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></div></div>
        <div className="quality-quick-views"><b>Quick views</b><button onClick={() => applyQualityView("HIGH_ROOT")}>High-risk Root</button><button onClick={() => applyQualityView("UBQ_SKIP")}>UBQ skip candidates</button><button onClick={() => applyQualityView("DUPLICATES")}>Duplicates</button><button onClick={() => applyQualityView("ALL")}>All findings</button></div>
        {selectedIssues.length > 0 && <div className="quality-bulk-bar"><b>{selectedIssues.length} findings selected</b><button className="primary" onClick={bulkQueueIssues}><Users size={14} />Send selected to team triage</button><button className="secondary" onClick={() => setSelectedIssues([])}>Clear</button></div>}
        <div className="quality-findings">{filteredIssues.slice(0, 50).map((issue) => { const task = taskFor(issue.source, issue.brandId, issue.name); return <div key={issue.key}><input type="checkbox" checked={selectedIssues.includes(issue.key)} onChange={(event) => setSelectedIssues(event.target.checked ? [...selectedIssues, issue.key] : selectedIssues.filter((key) => key !== issue.key))} /><span className={issue.severity.toLowerCase()}>{issue.severity}</span><div><b>{issue.name}</b><small>{issue.brandId}</small></div><strong>{issue.title}<small>{issue.reason}</small></strong><em><b>{qualityScore(issue)}</b> priority · {issue.suggestion || "Manual review"}</em><div className="quality-row-actions"><ResearchLinks name={issue.name} compact />{issue.source === "ROOT" ? <AdminBrandLink id={issue.brandId} name={issue.name} compact /> : <AdminUnknownBrandLink name={issue.name} compact />}{taskAction(issue.source, issue.brandId, issue.name, () => queueIssue(issue))}{task?.activity?.length ? <details className="quality-history"><summary><History size={12} />History</summary><div>{task.activity.slice(0, 5).map((event) => <p key={event.id}><b>{event.by}</b> {event.message}<small>{fmtDate(event.at)} · {fmtTime(event.at)}</small></p>)}</div></details> : null}</div></div>; })}</div>{filteredIssues.length > 50 && <p className="quality-more">Showing the first 50 of {filteredIssues.length.toLocaleString()} findings. Use Smart Cleanup for the complete paginated worklist.</p>}</section>
    </>}
  </>;
}

function Analytics({ records, ledger, historicalMappings, priorityQueue, completionActivity, currentUser }: { records: BrandRecord[]; ledger: LedgerEntry[]; historicalMappings: HistoricalMappingEntry[]; priorityQueue: PriorityQueueItem[]; completionActivity: MappingActivityEntry[]; currentUser: string }) {
  const [granularity, setGranularity] = useState<MappingGranularity>("week");
  const [mappingRange, setMappingRange] = useState<"week" | "month" | "four-months" | "all">("four-months");
  const [activityAction, setActivityAction] = useState<"ALL" | Action>("ALL");
  const [activityReviewer, setActivityReviewer] = useState("ALL");
  const [activitySource, setActivitySource] = useState<"ALL" | "HISTORICAL" | "LIVE">("ALL");
  type AnalyticsActivity = MappingActivityEntry & { activitySource: "HISTORICAL" | "LIVE" };
  const mappedRecords = useMemo(() => records.filter((record) => !record.triageResolution && !record.excludedFromExport), [records]);
  const resolvedRecordIds = useMemo(() => new Set(records.filter((record) => record.triageResolution).map((record) => record.id)), [records]);
  const allActivity = useMemo<AnalyticsActivity[]>(() => [
    ...historicalMappings.map((entry) => ({ date: entry.date, action: entry.action, reviewer: canonicalAnalyticsReviewer(entry.reviewer || "Imported from manual task"), activitySource: "HISTORICAL" as const })),
    ...ledger.filter((entry) => !resolvedRecordIds.has(entry.id)).map((entry) => ({ ...entry, reviewer: canonicalAnalyticsReviewer(entry.reviewer), activitySource: "LIVE" as const })),
  ], [historicalMappings, ledger, resolvedRecordIds]);
  const activityReviewers = useMemo(() => [...new Set(allActivity.map((entry) => entry.reviewer?.trim() || "Unattributed"))].sort(), [allActivity]);
  const filteredActivity = useMemo(() => allActivity.filter((entry) => (activityAction === "ALL" || entry.action === activityAction) && (activityReviewer === "ALL" || (entry.reviewer?.trim() || "Unattributed") === activityReviewer) && (activitySource === "ALL" || entry.activitySource === activitySource)), [allActivity, activityAction, activityReviewer, activitySource]);
  const summary = useMemo(() => summarizeMappingActivity(filteredActivity, mappedRecords), [filteredActivity, mappedRecords]);
  const completionSummary = useMemo(() => summarizeMappingActivity(completionActivity, []), [completionActivity]);
  const recentDays = useMemo(() => buildMappingActivitySeries(completionActivity, "day", new Date(), 7), [completionActivity]);
  const high = mappedRecords.filter((record) => record.confidence >= 90).length;
  const averageConfidence = mappedRecords.length ? Math.round(mappedRecords.reduce((sum, record) => sum + record.confidence, 0) / mappedRecords.length) : 0;
  const maxDay = Math.max(1, ...recentDays.map((day) => day.total));
  const weekDelta = completionSummary.lastWeek ? Math.round((completionSummary.thisWeek - completionSummary.lastWeek) / completionSummary.lastWeek * 100) : completionSummary.thisWeek ? 100 : 0;
  const mappingQueue = priorityQueue.filter((item) => !item.resolvedWithoutMappingAt);
  const queueCompleted = mappingQueue.filter((item) => item.status === "COMPLETED").length;
  const queueOpen = mappingQueue.length - queueCompleted;
  const queueOwners = [...new Set(mappingQueue.map((item) => item.assignedTo).filter(Boolean))];
  const adminSuccessful = mappedRecords.filter((record) => record.adminUploadStatus === "SUCCESS").length;
  const adminFailed = mappedRecords.filter((record) => record.adminUploadStatus === "FAILED").length;
  const adminPending = mappedRecords.filter((record) => !record.adminUploadStatus && record.status !== "needs-review").length;
  const adminResultsRecorded = adminSuccessful + adminFailed;
  const adminConfirmers = [...new Set(mappedRecords.filter((record) => record.adminUploadStatus === "SUCCESS").map((record) => record.adminUploadedBy).filter((name): name is string => Boolean(name)).map(canonicalAnalyticsReviewer))];
  const adminConfirmationLabel = adminConfirmers.length === 1 ? adminConfirmers[0] : adminConfirmers.length > 1 ? adminConfirmers.join(", ") : "the team";
  const analyticsFiltersActive = activityAction !== "ALL" || activityReviewer !== "ALL" || activitySource !== "ALL";
  const safeUser = currentUser.toLowerCase().replace(/[^a-z0-9]+/g, "-");
  function downloadExcelReport() {
    download(`brandmaster-analytics-${safeUser}-${new Date().toISOString().slice(0, 10)}.xls`, analyticsExcelXml(filteredActivity, mappedRecords, priorityQueue), "application/vnd.ms-excel;charset=utf-8");
  }
  async function downloadPdfReport() {
    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF({ unit: "pt", format: "letter" });
    const actionCounts = { CREATE: 0, MERGE: 0, SKIP: 0, DELETE: 0 };
    filteredActivity.forEach((entry) => { actionCounts[entry.action] += 1; });
    doc.setFillColor(54, 101, 243); doc.rect(0, 0, 612, 92, "F"); doc.setTextColor(255, 255, 255); doc.setFont("helvetica", "bold"); doc.setFontSize(24); doc.text("Brandmaster Analytics", 44, 48); doc.setFontSize(10); doc.setFont("helvetica", "normal"); doc.text(`Generated for ${currentUser} on ${new Date().toLocaleString()}`, 44, 69);
    doc.setTextColor(28, 31, 35); doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.text("Mapping progress", 44, 126);
    const metrics = [["Recorded decisions", summary.totalEffort], ["Team completed today", completionSummary.today], ["Team completed this week", completionSummary.thisWeek], ["Current rows reviewed", summary.reviewedRows]] as const;
    metrics.forEach(([label, value], index) => { const x = 44 + index * 132; doc.setFillColor(245, 247, 251); doc.roundedRect(x, 142, 120, 64, 6, 6, "F"); doc.setFontSize(19); doc.text(String(value), x + 12, 169); doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(95, 101, 110); doc.text(label, x + 12, 188); doc.setFont("helvetica", "bold"); doc.setTextColor(28, 31, 35); });
    doc.setFontSize(15); doc.text("Action mix", 44, 248); doc.setFont("helvetica", "normal"); doc.setFontSize(11); doc.text(`CREATE  ${actionCounts.CREATE}     MERGE  ${actionCounts.MERGE}     SKIP  ${actionCounts.SKIP}     DELETE  ${actionCounts.DELETE}`, 44, 271);
    doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.text("Admin upload outcomes", 44, 316); doc.setFont("helvetica", "normal"); doc.setFontSize(11); doc.text(`Successful  ${adminSuccessful}     Failed  ${adminFailed}     Awaiting result  ${adminPending}`, 44, 340);
    doc.setFont("helvetica", "bold"); doc.setFontSize(15); doc.text("High priority team queue", 44, 385); doc.setFont("helvetica", "normal"); doc.setFontSize(11); doc.text(`Total  ${mappingQueue.length}     Completed  ${queueCompleted}     Open  ${queueOpen}     Contributors  ${queueOwners.length}`, 44, 409);
    doc.setDrawColor(220, 224, 231); doc.line(44, 448, 568, 448); doc.setTextColor(95, 101, 110); doc.setFontSize(9); doc.text("Admin success is recorded only after the result CSV is imported or all rows are explicitly confirmed successful.", 44, 470, { maxWidth: 524 });
    doc.save(`brandmaster-analytics-${safeUser}-${new Date().toISOString().slice(0, 10)}.pdf`);
  }
  return <><PageHead eyebrow="MAPPING PERFORMANCE" title="Progress & effort analytics" body="Imported manual tasks, live reviews, and confirmed Admin upload results show both team effort and delivered mapping progress." actions={<><a className="secondary button-link" href={`${APP_BASE_PATH}/analytics`} target="_blank" rel="noreferrer"><BarChart3 size={15} />Public view</a><button className="secondary" onClick={downloadExcelReport}><ArrowDownToLine size={15} />Download Excel</button><button className="primary" onClick={() => void downloadPdfReport()}><ArrowDownToLine size={15} />Download PDF</button></>} />
    <section className="analytics-progress-hero"><div className="progress-orb" style={{ "--progress": `${summary.completionPercent}%` } as React.CSSProperties}><span><b>{summary.completionPercent}%</b><small>reviewed</small></span></div><div className="progress-copy"><span>CURRENT MAPPING PROGRESS</span><h2>{summary.reviewedRows.toLocaleString()} of {mappedRecords.length.toLocaleString()} mapped rows reviewed</h2><p>{summary.remainingRows ? `${summary.remainingRows.toLocaleString()} mapping rows still need a saved human decision.` : mappedRecords.length ? "Every active mapping row currently in the workspace has been reviewed." : "No mapping work is active. Operationally resolved items are not counted."}</p><div className="progress-track"><i style={{ width: `${summary.completionPercent}%` }} /></div></div><div className="quality-pulse"><ShieldCheck size={18} /><span><b>{averageConfidence}%</b><small>average confidence</small></span><span><b>{high.toLocaleString()}</b><small>high-confidence rows</small></span></div></section>
    {mappingQueue.length > 0 && <section className="queue-analytics"><div><span><Users size={20} /></span><div><small>HIGH PRIORITY TEAM QUEUE</small><h2>{queueCompleted.toLocaleString()} of {mappingQueue.length.toLocaleString()} urgent brands completed</h2><i><em style={{ width: `${Math.round(queueCompleted / mappingQueue.length * 100)}%` }} /></i></div></div><aside><b>{mappingQueue.filter((item) => isActivePriorityTask(item) && item.status === "UNASSIGNED").length}<small>available</small></b><b>{mappingQueue.filter((item) => isActivePriorityTask(item) && item.status === "ASSIGNED").length}<small>assigned</small></b><b>{mappingQueue.filter((item) => isActivePriorityTask(item) && item.status === "IN_REVIEW").length}<small>in progress</small></b><b>{mappingQueue.filter((item) => isActivePriorityTask(item) && item.status === "BLOCKED").length}<small>blocked</small></b><b>{queueOpen}<small>left</small></b><b>{queueOwners.length}<small>teammates</small></b></aside></section>}
    <section className={`admin-outcome-analytics ${adminResultsRecorded ? "" : "unverified"}`}><div><span><ShieldCheck size={21} /></span><div><small>TEAM DELIVERY VERIFICATION</small><h2>{adminResultsRecorded ? `${adminSuccessful.toLocaleString()} mappings confirmed by ${adminConfirmationLabel}` : "Team delivery has not been verified yet"}</h2><p>{adminResultsRecorded ? "Team confirmations come from imported result files or an explicit all-success confirmation." : `${adminPending.toLocaleString()} reviewed row${adminPending === 1 ? " is" : "s are"} awaiting team confirmation. Imported manual tasks measure team decisions, but do not prove that the external tool applied them.`}</p></div></div><aside><b className="success">{adminSuccessful}<small>confirmed</small></b><b className={adminFailed ? "failed" : ""}>{adminFailed}<small>failed</small></b><b>{adminPending}<small>not verified</small></b></aside></section>
    <section className="analytics-filter-bar"><div><span><Gauge size={18} /></span><div><b>Explore decision activity</b><small>Filters update the decision trend, recorded total, action mix, reviewer effort, and downloaded reports. Team completion cards always match the weekly target.</small></div></div><label>Source<select value={activitySource} onChange={(event) => setActivitySource(event.target.value as typeof activitySource)}><option value="ALL">All sources</option><option value="HISTORICAL">Imported manual tasks</option><option value="LIVE">Brandmaster reviews</option></select></label><label>Reviewer<select value={activityReviewer} onChange={(event) => setActivityReviewer(event.target.value)}><option value="ALL">All reviewers</option>{activityReviewers.map((reviewer) => <option key={reviewer}>{reviewer}</option>)}</select></label><label>Action<select value={activityAction} onChange={(event) => setActivityAction(event.target.value as typeof activityAction)}><option value="ALL">All actions</option>{(["CREATE", "MERGE", "SKIP", "DELETE"] as Action[]).map((action) => <option key={action}>{action}</option>)}</select></label><strong>{filteredActivity.length.toLocaleString()}<small>decisions</small></strong>{analyticsFiltersActive && <button className="secondary" onClick={() => { setActivitySource("ALL"); setActivityReviewer("ALL"); setActivityAction("ALL"); }}>Clear filters</button>}</section>
    <section className="mapping-dashboard-grid"><div className="panel mapping-trend-panel"><div className="panel-head"><div><h2>Brand mapping actions over time</h2><p>Recorded decisions—not automatic recommendations or verified Admin delivery</p></div><div className="analytics-controls"><div className="analytics-toggle range-toggle"><button className={mappingRange === "week" ? "active" : ""} onClick={() => setMappingRange("week")}>Week</button><button className={mappingRange === "month" ? "active" : ""} onClick={() => setMappingRange("month")}>Month</button><button className={mappingRange === "four-months" ? "active" : ""} onClick={() => setMappingRange("four-months")}>4 months</button><button className={mappingRange === "all" ? "active" : ""} onClick={() => setMappingRange("all")}>All</button></div><div className="analytics-toggle"><button className={granularity === "day" ? "active" : ""} onClick={() => setGranularity("day")}>Daily</button><button className={granularity === "week" ? "active" : ""} onClick={() => setGranularity("week")}>Weekly</button></div></div></div>{filteredActivity.length ? <MappingTrendChart entries={filteredActivity} granularity={granularity} range={mappingRange} /> : <EmptyState icon={Search} title="No activity matches these filters" body="Clear or change a filter to restore mapping activity." action={<button className="secondary" onClick={() => { setActivitySource("ALL"); setActivityReviewer("ALL"); setActivityAction("ALL"); }}>Clear filters</button>} />}</div>
      <aside className="mapping-stat-stack"><AnalyticsStat label="Recorded decisions" value={summary.totalEffort} detail={`${filteredActivity.filter((entry) => entry.activitySource === "HISTORICAL").length.toLocaleString()} manual imports · ${filteredActivity.filter((entry) => entry.activitySource === "LIVE").length.toLocaleString()} live`} icon={Boxes} /><AnalyticsStat label="Team completed today" value={completionSummary.today} detail="same as weekly target" icon={Activity} /><AnalyticsStat label="Team completed this week" value={completionSummary.thisWeek} detail={`${weekDelta >= 0 ? "+" : ""}${weekDelta}% vs last week`} icon={TrendingUp} /><AnalyticsStat label="Team completed last week" value={completionSummary.lastWeek} detail="verified, deduplicated brands" icon={CalendarDays} /></aside>
    </section>
    <section className="analytics-lower-grid"><div className="panel daily-effort-panel"><div className="panel-head"><div><h2>Team completions · last 7 days</h2><p>The same verified, deduplicated completion source used by the weekly target</p></div><strong>{completionSummary.averagePerActiveDay}<small>avg / active day</small></strong></div><div className="daily-effort-bars">{recentDays.map((day, index) => <div key={day.key} className={index === recentDays.length - 1 ? "today" : ""}><span><i style={{ height: `${Math.max(day.total ? 8 : 2, day.total / maxDay * 100)}%` }}><em>{day.total || ""}</em></i></span><b>{index === recentDays.length - 1 ? "Today" : day.start.toLocaleDateString(undefined, { weekday: "short" })}</b><small>{day.total.toLocaleString()} completed</small></div>)}</div></div>
      <div className="panel"><div className="panel-head"><div><h2>Filtered action mix</h2><p>Imported manual tasks + Brandmaster decisions</p></div></div>{filteredActivity.length ? <DonutChart records={filteredActivity} /> : <EmptyState icon={BarChart3} title="No matching actions" body="Change the analytics filters to see the action mix." />}</div>
      <div className="panel contributor-panel"><div className="panel-head"><div><h2>Reviewer effort</h2><p>Saved decisions by contributor</p></div><Users size={16} /></div>{summary.reviewerEffort.length ? <div className="contributor-list">{summary.reviewerEffort.slice(0, 6).map((item) => <div key={item.reviewer}><span>{item.reviewer.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span><div><b>{item.reviewer}</b><i><em style={{ width: `${item.decisions / summary.reviewerEffort[0].decisions * 100}%` }} /></i></div><strong>{item.decisions.toLocaleString()}<small>decisions</small></strong></div>)}</div> : <EmptyState icon={Users} title="No reviewer activity" body="Reviewer names are recorded when decisions are saved." />}</div>
    </section>
  </>;
}

function AnalyticsStat({ label, value, detail, icon: Icon }: { label: string; value: number; detail: string; icon: typeof Activity }) {
  return <div><span><Icon size={16} /></span><div><small>{label}</small><b>{value.toLocaleString()}</b><em>{detail}</em></div></div>;
}

function MappingTrendChart({ entries, granularity, range }: { entries: MappingActivityEntry[]; granularity: MappingGranularity; range: "week" | "month" | "four-months" | "all" }) {
  const rangeDays = range === "week" ? 7 : range === "month" ? 30 : range === "four-months" ? 120 : undefined;
  const buckets = useMemo(() => cumulativeMappingSeries(buildAvailableMappingSeries(entries, granularity, rangeDays)), [entries, granularity, rangeDays]);
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
  const labelEvery = Math.max(1, Math.ceil(buckets.length / 10));
  const rangeLabel = range === "week" ? "last available week" : range === "month" ? "last available month" : range === "four-months" ? "last available 4 months" : "all available dates";
  return <div className="mapping-trend"><div className="mapping-legend">{actions.map((item) => <span key={item.action}><i style={{ background: item.color }} />{item.label}<b>{buckets.at(-1)?.cumulative[item.action] || 0}</b></span>)}</div><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Cumulative mapping decisions by ${granularity}`}>
    {[0, .25, .5, .75, 1].map((fraction) => <g key={fraction}><line x1={left} x2={width - right} y1={y(max * fraction)} y2={y(max * fraction)} className="trend-grid" /><text x={left - 9} y={y(max * fraction) + 3} textAnchor="end">{Math.round(max * fraction).toLocaleString()}</text></g>)}
    {layers.map((layer) => <g key={layer.action}><path d={area(layer.topValues, layer.bottomValues)} fill={layer.color} opacity=".13" /><path d={line(layer.topValues)} fill="none" stroke={layer.color} strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" />{layer.topValues.map((value, index) => <circle key={buckets[index].key} cx={x(index)} cy={y(value)} r="2.1" fill={layer.color}><title>{buckets[index].label}: {layer.label} {buckets[index].cumulative[layer.action]} cumulative · {buckets[index].counts[layer.action]} this {granularity}</title></circle>)}</g>)}
    {buckets.map((bucket, index) => index % labelEvery === 0 || index === buckets.length - 1 ? <text key={bucket.key} x={x(index)} y={height - 13} textAnchor="middle" className="trend-x-label">{bucket.label}</text> : null)}
  </svg><p className="trend-caption"><CircleHelp size={12} />Showing {rangeLabel}, trimmed to the first and last recorded actions. Imported history and live reviews are combined.</p></div>;
}

function ArtifactsView({ data, onNavigate }: { data: AppData; onNavigate: (view: View) => void }) {
  const totalRows = data.batches.reduce((sum, batch) => sum + batch.rows, 0);
  const ready = (batch: ImportBatch) => getBulkExportReadiness(batch.records).ready;
  const pendingRootChanges = Object.values(data.rootChanges).filter((change) => change.status !== "APPLIED" && change.adminStatus !== "REJECTED" && change.adminStatus !== "SUPERSEDED");
  return <><PageHead eyebrow="WORKSPACE DATA" title="Data & artifacts" body="Import history, generated bulk files, decisions, and offline reference sources live here—not in the validation workflow." actions={<button className="secondary" onClick={() => onNavigate("settings")}><Settings size={15} />Validation modules</button>} />
    <section className="artifact-stats"><div><FileUp size={17} /><span><b>{data.batches.length}</b><small>Imports</small></span></div><div><Boxes size={17} /><span><b>{totalRows.toLocaleString()}</b><small>Processed rows</small></span></div><div><ArrowDownToLine size={17} /><span><b>{data.batches.filter(ready).length}</b><small>Ready bulk files</small></span></div><div><History size={17} /><span><b>{data.ledger.length}</b><small>Manual decisions</small></span></div></section>
    <div className="artifact-layout"><section className="panel"><div className="panel-head"><div><h2>Import history</h2><p>Processing runs stored on this device</p></div></div>{data.batches.length ? <div className="artifact-list">{data.batches.map((batch, index) => { const isReady = ready(batch); const needs = batch.records.filter((record) => record.status === "needs-review").length; return <div key={batch.id}><div className="file-icon">CSV</div><div><b>{batch.filename}</b><p>{fmtDate(batch.createdAt)} at {fmtTime(batch.createdAt)} · {batch.rows.toLocaleString()} brands</p></div><span className={`status ${isReady ? "done" : "review"}`}>{isReady ? <><Check size={12} />Ready</> : `${needs} to review`}</span>{index === 0 && <button className="text-button" onClick={() => onNavigate("review")}>Open latest</button>}</div>; })}</div> : <EmptyState icon={Archive} title="No import history" body="Completed and in-progress validation runs will appear here." />}</section>
      <aside className="artifact-side"><section className="panel"><div className="panel-head"><div><h2>Bulk CSV artifacts</h2><p>Files ready for the real upload tool</p></div></div>{data.batches.length ? <div className="download-list">{data.batches.slice(0, 6).map((batch) => <div key={batch.id}><div><b>{batch.filename.replace(/\.csv$/i, "")}</b><small>{ready(batch) ? `${batch.rows.toLocaleString()} mappings` : "Complete review first"}</small></div><button className="icon-button" disabled={!ready(batch)} title={ready(batch) ? "Download bulk output" : "Not ready"} onClick={() => download(`brandmaster-${batch.filename.replace(/\.csv$/i, "")}-bulk.csv`, toCsv(batch.records))}><ArrowDownToLine size={16} /></button></div>)}</div> : <EmptyState icon={ArrowDownToLine} title="No artifacts" body="Validated bulk files will appear here." />}</section>
        <section className="panel"><div className="panel-head"><div><h2>Offline sources</h2><p>Stored in this browser profile</p></div></div><div className="source-summary"><div><span>Previous decisions</span><b>{Object.keys(data.learned).length.toLocaleString()}</b></div><div><span>Historical mappings</span><b>{data.historicalMappings.length.toLocaleString()}</b></div><div><span>Existing brands</span><b>{data.rootBrands.length.toLocaleString()}</b></div><div><span>Pending Root recommendations</span><b>{pendingRootChanges.length.toLocaleString()}</b></div><div><span>ACA brands</span><b>{data.acaBrands.length.toLocaleString()}</b></div><div><span>FPA brands</span><b>{data.fpaBrands.length.toLocaleString()}</b></div>{pendingRootChanges.length > 0 && <button className="primary source-download" onClick={() => download("brandmaster-root-table-changes.csv", toRootChangesCsv(pendingRootChanges))}><ArrowDownToLine size={14} />Download pending Root changes</button>}<button className="text-button" onClick={() => onNavigate("settings")}>Manage sources →</button></div></section>
      </aside></div>
  </>;
}

function ModuleToggle({ label, body, enabled, onChange, locked = false, online = false, unavailable = false }: { label: string; body: string; enabled: boolean; onChange?: () => void; locked?: boolean; online?: boolean; unavailable?: boolean }) {
  return <button className={`module-row ${unavailable ? "unavailable" : ""}`} onClick={onChange} disabled={locked || unavailable}><span className={`module-check ${enabled ? "enabled" : ""}`}>{enabled && <Check size={13} />}</span><div><b>{label}</b><p>{body}</p></div>{unavailable ? <em>NOT CONNECTED</em> : online ? <em>ONLINE</em> : locked ? <em>REQUIRED</em> : null}</button>;
}

function UbqUploader({ source, meta, data, onLoad }: { source: UbqSource | null; meta?: SourceMetadata; data: AppData; onLoad: (filename: string, rows: ParsedRow[]) => void }) {
  const input = useRef<HTMLInputElement>(null); const [loading, setLoading] = useState(false); const [error, setError] = useState("");
  const [preview, setPreview] = useState<{ filename: string; rows: ParsedRow[]; markedNotDone: CompletedBrandDetail[] } | null>(null);
  function accept(file?: File) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".csv")) { setError("The UBQ reference must be a CSV file."); return; }
    setLoading(true); setError(""); setPreview(null);
    const reader = new FileReader();
    reader.onload = () => {
      const rows = parseCsv(String(reader.result)); setLoading(false);
      if (!rows.length || !rows.some((row) => row.id.startsWith("draft_brand_"))) { setError("Expected UnmappedBrandID/Brand ID and UnmappedBrandName/Brand Name columns with draft_brand_ IDs."); return; }
      setPreview({ filename: file.name, rows, markedNotDone: findCompletedBrandDetails(data, rows) });
    };
    reader.onerror = () => { setLoading(false); setError("This UBQ CSV could not be read."); };
    reader.readAsText(file);
  }
  return <div className={`reference-upload ubq-upload ${source ? "loaded" : ""}`}><div className="reference-icon">{source ? <Check size={18} /> : <FileUp size={18} />}</div><div className="reference-info"><span>AUTHORITATIVE COMPLETION SOURCE</span><b>Full UBQ Export</b><p>{source ? `${source.count.toLocaleString()} currently not-done brands indexed` : "A brand is verified done only when it is absent from the latest UBQ"}</p><small>{sourceUpdated(meta)}</small><code>UnmappedBrandID · UnmappedBrandName · optional counts</code></div><input ref={input} type="file" accept=".csv,text/csv" hidden onChange={(event) => { accept(event.target.files?.[0]); event.target.value = ""; }} /><button className={source ? "secondary" : "primary"} onClick={() => input.current?.click()}>{loading ? "Reading UBQ…" : preview ? "Choose another UBQ" : source ? "Replace UBQ export" : "Choose full UBQ export"}</button>{preview && <section className="team-progress-preview ubq-reconciliation-preview"><div className="team-progress-preview-head"><span><ShieldCheck size={17} /></span><div><small>REVIEW BEFORE UPDATING COMPLETION</small><b>{preview.filename}</b><p>The uploaded UBQ becomes the current source of truth. Brands present in it are not done; tracked brands absent from it can be verified done.</p></div></div><div className="team-progress-preview-stats ubq-preview-stats"><span><b>{preview.rows.length.toLocaleString()}</b><small>currently in UBQ</small></span><span className={preview.markedNotDone.length ? "warning" : ""}><b>{preview.markedNotDone.length.toLocaleString()}</b><small>will be marked not done</small></span></div>{preview.markedNotDone.length > 0 ? <div className="ubq-reopen-report"><b>{preview.markedNotDone.length.toLocaleString()} previously completed brand{preview.markedNotDone.length === 1 ? "" : "s"} returned in this UBQ</b><p>{preview.markedNotDone.slice(0, 10).map((item) => item.brand).join(", ")}{preview.markedNotDone.length > 10 ? `, and ${(preview.markedNotDone.length - 10).toLocaleString()} more` : ""}</p></div> : <div className="team-progress-preview-note"><Check size={14} /><p>No previously completed brands return in this UBQ export.</p></div>}<div className="team-progress-preview-actions"><button className="secondary" onClick={() => setPreview(null)}>Cancel</button><button className="primary" onClick={() => { onLoad(preview.filename, preview.rows); setPreview(null); }}><RefreshCw size={15} />Confirm and reconcile UBQ</button></div></section>}{error && <div className="reference-error"><CircleHelp size={14} />{error}</div>}</div>;
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

function HistoricalMappingUploader({ count, idCount, meta, onLoad }: { count: number; idCount: number; meta?: SourceMetadata; onLoad: (entries: HistoricalMappingEntry[], filename: string, mode: HistoricalImportMode, idReferences: ManualFpaIdReference[]) => void }) {
  const input = useRef<HTMLInputElement>(null); const [loading, setLoading] = useState(false); const [mode, setMode] = useState<HistoricalImportMode>(count ? "update" : "replace"); const [message, setMessage] = useState(""); const [error, setError] = useState(""); const [preview, setPreview] = useState<{ filename: string; result: ReturnType<typeof parseHistoricalMappingCsv> } | null>(null);
  function accept(file?: File) {
    if (!file) return;
    setLoading(true); setError(""); setMessage(""); setPreview(null);
    const reader = new FileReader();
    reader.onload = () => {
      const result = parseHistoricalMappingCsv(String(reader.result), file.name); setLoading(false);
      if (!result.entries.length && !result.idReferences.length) { setError(result.errors[0] || "No valid historical actions or Unmapped Brand IDs were found."); return; }
      setPreview({ filename: file.name, result });
    };
    reader.onerror = () => { setLoading(false); setError("This historical mapping CSV could not be read."); };
    reader.readAsText(file);
  }
  const modeHelp = mode === "append" ? "Adds only actions not already stored for the same brand, action, and date." : mode === "update" ? "Replaces all stored history for brands present in this CSV; other brands stay unchanged." : "Deletes the current historical dataset and replaces it with this CSV.";
  const previewEntries = preview?.result.entries || [];
  const aliasesMissingTargets = previewEntries.filter((entry) => entry.action === "MERGE" && !entry.targetBrandId).length;
  const withSourceIds = preview?.result.idReferences.length || 0;
  return <div className={`reference-upload historical-upload ${count || idCount ? "loaded" : ""}`}><div className="reference-icon">{count || idCount ? <Check size={18} /> : <TrendingUp size={18} />}</div><div className="reference-info"><span>OFFLINE TEAM RECONCILIATION</span><b>Team Progress CSV</b><p>{count || idCount ? `${count.toLocaleString()} completed actions · ${idCount.toLocaleString()} Manual FPA IDs` : "Import the shared team worksheet and recognize completed offline work"}</p><small>{sourceUpdated(meta)}{message ? ` · ${message}` : ""}</small><code>listing_brand · Action · Date · UBQ · Unmapped Brand ID · optional target details</code><div className="historical-mode"><button className={mode === "append" ? "active" : ""} onClick={() => setMode("append")}>Append new</button><button className={mode === "update" ? "active" : ""} onClick={() => setMode("update")}>Regular reconciliation</button><button className={mode === "replace" ? "active" : ""} onClick={() => setMode("replace")}>Replace all</button></div><small className="historical-mode-help">{modeHelp}</small></div><input ref={input} type="file" accept=".csv,text/csv" hidden onChange={(event) => { accept(event.target.files?.[0]); event.target.value = ""; }} /><button className={count || idCount ? "secondary" : "primary"} onClick={() => input.current?.click()}>{loading ? "Reading progress…" : preview ? "Choose another CSV" : count || idCount ? "Upload progress CSV" : "Add progress CSV"}</button>{preview && <section className="team-progress-preview"><div className="team-progress-preview-head"><span><ShieldCheck size={17} /></span><div><small>REVIEW BEFORE RECONCILING</small><b>{preview.filename}</b><p>Completed actions become history. Every valid Unmapped Brand ID is indexed even when Action or Date is blank; rows marked UBQ = Yes remain not done.</p></div></div><div className="team-progress-preview-stats"><span><b>{previewEntries.length.toLocaleString()}</b><small>completed rows</small></span><span><b>{withSourceIds.toLocaleString()}</b><small>Manual FPA IDs</small></span><span><b>{preview.result.skipped.toLocaleString()}</b><small>not completion rows</small></span><span className={aliasesMissingTargets ? "warning" : ""}><b>{aliasesMissingTargets.toLocaleString()}</b><small>aliases missing target</small></span></div><div className="team-progress-preview-note"><CircleHelp size={14} /><p><b>Duplicate protection rule:</b> UBQ = Yes overrides older completion history and reopens the brand. The stored Unmapped Brand ID also fixes missing IDs in review.</p></div><div className="team-progress-preview-actions"><button className="secondary" onClick={() => setPreview(null)}>Cancel</button><button className="primary" onClick={() => { onLoad(preview.result.entries, preview.filename, mode, preview.result.idReferences); setMessage(`${preview.result.entries.length.toLocaleString()} completed actions · ${preview.result.idReferences.length.toLocaleString()} IDs reconciled`); setPreview(null); }}><Check size={15} />Confirm reconciliation</button></div></section>}{error && <div className="reference-error"><CircleHelp size={14} />{error}</div>}</div>;
}

function ServiceWorkspacePanel({ createSnapshot, applySnapshot, session, onSession, remoteUpdate, onRemoteUpdate, teamSync, onTeamSync }: { createSnapshot: () => SharedWorkspaceSnapshot; applySnapshot: (snapshot: SharedWorkspaceSnapshot) => Promise<void>; session: SyncSession | null; onSession: (session: SyncSession | null) => void; remoteUpdate: GitHubRemoteUpdate | null; onRemoteUpdate: (update: GitHubRemoteUpdate | null) => void; teamSync?: SharedWorkspaceSnapshot["sync"]; onTeamSync: (sync?: SharedWorkspaceSnapshot["sync"]) => void }) {
  const revisionKey = "brandmaster-service-revision"; const syncedAtKey = "brandmaster-service-synced-at";
  const [busy, setBusy] = useState(""); const [message, setMessage] = useState(""); const [error, setError] = useState(""); const [lastSyncedAt, setLastSyncedAt] = useState("");
  useEffect(() => { setLastSyncedAt(localStorage.getItem(syncedAtKey) || ""); }, []);
  async function remember(revision: string | null, workspace: SharedWorkspaceSnapshot) {
    if (revision) localStorage.setItem(revisionKey, revision); else localStorage.removeItem(revisionKey);
    const when = workspace.sync?.lastSyncedAt || new Date().toISOString(); localStorage.setItem(syncedAtKey, when); setLastSyncedAt(when); onTeamSync(workspace.sync); onRemoteUpdate(null); await saveGitHubBaseline(workspace);
  }
  async function sync() {
    setBusy("sync"); setError(""); setMessage("");
    try {
      const remote = await pullSharedWorkspace(SYNC_SERVICE_URL); const local = createSnapshot(); const baseline = await loadGitHubBaseline();
      if (!remote.workspace) {
        const saved = await pushSharedWorkspace(SYNC_SERVICE_URL, local, null); if (!saved.workspace) throw new Error("NuKV did not return the saved workspace");
        await remember(saved.revision, saved.workspace); setMessage("Created the shared NuKV workspace from this browser."); return;
      }
      const merged = mergeWorkspaceSnapshots(baseline, local, remote.workspace);
      if (!merged.localChanges) {
        await applySnapshot(remote.workspace); await remember(remote.revision, remote.workspace); setMessage(`Pulled ${merged.remoteChanges} team change${merged.remoteChanges === 1 ? "" : "s"}.`); return;
      }
      const saved = await pushSharedWorkspace(SYNC_SERVICE_URL, merged.workspace, remote.revision); if (!saved.workspace) throw new Error("NuKV did not return the saved workspace");
      await applySnapshot(saved.workspace); await remember(saved.revision, saved.workspace); setMessage(`Merged and saved ${merged.localChanges} local change${merged.localChanges === 1 ? "" : "s"}.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "The shared NuKV workspace could not be synchronized."); }
    finally { setBusy(""); }
  }
  async function disconnect() { try { await logoutSync(SYNC_SERVICE_URL); } finally { onSession({ authenticated: false }); onRemoteUpdate(null); } }
  const user = session?.authenticated ? session.user : undefined; const history = teamSync?.history || [];
  return <section className="shared-workspace"><div className="section-title"><div><h2>Shared NuKV workspace</h2><p>Live team data with incremental merge, conflict protection, and no personal repository token.</p></div><span className={`connection-chip ${user ? "online" : ""}`}>{user ? <Check size={13} /> : <Database size={13} />}{user ? "Connected" : "Not connected"}</span></div><div className="shared-workspace-card">
    {!user ? <div className="github-connect"><div className="github-connect-copy"><ShieldCheck size={18} /><span><b>Sign in with Corporate GitHub</b><p>Your GitHub identity controls access. NuKV credentials stay inside the internal service and never reach this browser.</p></span></div><button className="primary" onClick={() => { location.href = syncLoginUrl(SYNC_SERVICE_URL, location.href); }}><Github size={15} />Sign in and connect</button></div> : <><div className="github-session"><div className="github-user"><div>{user.login.slice(0, 2).toUpperCase()}</div><span><b>{user.name || user.login}</b><p>@{user.login} · NuKV team workspace</p></span></div><div className="github-sync-status"><span>{lastSyncedAt ? "LAST LOCAL SYNC" : "READY TO SYNC"}</span><b>{lastSyncedAt ? `${fmtDate(lastSyncedAt)} at ${fmtTime(lastSyncedAt)}` : "Pull and merge team data"}</b>{teamSync?.lastSyncedBy && <small>Latest save by @{teamSync.lastSyncedBy}</small>}</div><div className="sync-actions"><button className="text-button" disabled={Boolean(busy)} onClick={() => void disconnect()}><LogOut size={14} />Disconnect</button><button className="primary" disabled={Boolean(busy)} onClick={() => void sync()}><RefreshCw className={busy ? "spinning" : ""} size={15} />{busy ? "Merging changes…" : remoteUpdate ? "Pull, merge & sync" : "Sync & Pull"}</button></div></div>{remoteUpdate && <div className="github-update"><Bell size={17} /><span><b>New team update available</b><p>A collaborator saved a newer NuKV revision. Your local changes will be merged, not overwritten.</p></span><button className="secondary" onClick={() => void sync()}>Pull, merge & sync</button></div>}{history.length > 0 && <details className="sync-history"><summary>Recent team sync activity</summary><div>{history.slice(0, 6).map((entry, index) => <div key={`${entry.syncedAt}-${index}`}><span>{entry.syncedBy.slice(0, 2).toUpperCase()}</span><p><b>@{entry.syncedBy}</b><small>{fmtDate(entry.syncedAt)} at {fmtTime(entry.syncedAt)} · {entry.changeCount} change{entry.changeCount === 1 ? "" : "s"}</small></p></div>)}</div></details>}</>}
    {message && <div className="sync-message success"><Check size={14} />{message}</div>}{error && <div className="sync-message error"><CircleHelp size={14} />{error}</div>}
  </div></section>;
}

function GitHubWorkspacePanel({ session, onSession, remoteUpdate, onRemoteUpdate, teamSync, onSync, online }: { session: GitHubSession | null; onSession: (session: GitHubSession | null) => void; remoteUpdate: GitHubRemoteUpdate | null; onRemoteUpdate: (update: GitHubRemoteUpdate | null) => void; teamSync?: SharedWorkspaceSnapshot["sync"]; onSync: () => Promise<string>; online: boolean }) {
  const [tokenInput, setTokenInput] = useState(""); const token = session?.token || ""; const user = session?.user || null;
  const [busy, setBusy] = useState(""); const [message, setMessage] = useState(""); const [error, setError] = useState(""); const [lastSyncedAt, setLastSyncedAt] = useState("");
  useEffect(() => { setLastSyncedAt(localStorage.getItem(GITHUB_SYNCED_AT_KEY) || ""); }, []);
  useEffect(() => { if (teamSync?.lastSyncedAt) setLastSyncedAt(teamSync.lastSyncedAt); }, [teamSync]);
  function friendlyError(cause: unknown) { return cause instanceof GitHubWorkspaceError || cause instanceof Error ? cause.message : "Corporate GitHub could not be reached."; }
  async function connect() {
    const candidate = tokenInput.trim(); if (!candidate) { setError("Paste a Corporate GitHub personal access token first."); return; }
    if (/BEGIN (RSA |EC )?PRIVATE KEY|^ssh-|^Iv1\./m.test(candidate)) { setError("This looks like an app private key, SSH key, or client ID. Create a Corporate GitHub personal access token instead."); return; }
    setBusy("connect"); setError(""); setMessage("");
    try {
      const [account] = await Promise.all([connectGitHubWorkspace(candidate), verifyGitHubWorkspaceRepository(candidate)]);
      localStorage.setItem(GITHUB_TOKEN_KEY, candidate); localStorage.setItem(GITHUB_USER_KEY, JSON.stringify(account)); onSession({ token: candidate, user: account }); setTokenInput(""); setMessage("Connected to the private Brandmaster-data repository. Brandmaster is loading the shared sources.");
    } catch (cause) { setError(friendlyError(cause)); }
    finally { setBusy(""); }
  }
  async function sync() {
    if (!token || !user) return;
    setBusy("sync"); setError(""); setMessage("");
    try { setMessage(await onSync()); }
    catch (cause) { setError(friendlyError(cause)); }
    finally { setBusy(""); }
  }
  function disconnect() { localStorage.removeItem(GITHUB_TOKEN_KEY); localStorage.removeItem(GITHUB_USER_KEY); onSession(null); setTokenInput(""); onRemoteUpdate(null); setError(""); setMessage("Disconnected. The saved token was removed from this browser."); }
  const history = teamSync?.history || [];
  return <section className="shared-workspace"><div className="section-title"><div><h2>Shared GitHub workspace</h2><p>Incrementally merge team updates and save your changes to the private Brandmaster-data repository.</p></div><span className={`connection-chip ${user ? "online" : ""}`}>{user ? <Check size={13} /> : <Github size={13} />}{user ? "Connected" : "Not connected"}</span></div><div className="shared-workspace-card">
    <div className="shared-workspace-intro"><div className="shared-cloud"><Github size={22} /></div><div><b>{GITHUB_WORKSPACE_REPOSITORY}</b><p><code>brandmaster/workspace.json</code> is a small manifest; large tables are stored as safe sub-megabyte chunks and committed atomically.</p></div><a className="secondary shared-repo-link" href={`https://github.corp.ebay.com/${GITHUB_WORKSPACE_REPOSITORY}`} target="_blank" rel="noreferrer">Open repository<ExternalLink size={13} /></a></div>
    {!user ? <div className="github-connect"><div className="github-connect-copy"><KeyRound size={18} /><span><b>Connect this browser to Team Sync</b><p>Your token is saved only in this browser so live sync survives refreshes. It is never committed to either repository or included in workspace exports.</p></span></div><details className="token-guide" open><summary>Teammate setup checklist</summary><ol><li><span>1</span><div><b>Ask the repository owner for Write access</b><p><code>bmeshesha</code> must add your Corporate GitHub account as a Write collaborator on <code>Brandmaster-data</code>.</p></div></li><li><span>2</span><div><b>Open Corporate GitHub token settings</b><p>Use Corporate GitHub—not github.com—and choose a reasonable expiration.</p></div></li><li><span>3</span><div><b>Choose repository access</b><p>Try a fine-grained token for <code>bmeshesha/Brandmaster-data</code>. If a collaborator cannot select that personal repository, use the classic token fallback.</p></div></li><li><span>4</span><div><b>Allow repository contents</b><p>Fine-grained: Contents read/write. Classic fallback: <code>repo</code>. Stay connected to the corporate network or VPN.</p></div></li></ol><div><a className="primary" href="https://github.corp.ebay.com/settings/personal-access-tokens/new" target="_blank" rel="noreferrer">Create fine-grained token<ExternalLink size={13} /></a><a className="secondary" href="https://github.corp.ebay.com/settings/tokens/new?scopes=repo&description=Brandmaster%20workspace%20sync" target="_blank" rel="noreferrer">Classic token fallback<ExternalLink size={13} /></a></div></details><div className="github-connect-form"><input type="password" autoComplete="off" spellCheck={false} value={tokenInput} onChange={(event) => setTokenInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void connect(); }} placeholder="Paste Corporate GitHub personal access token" aria-label="Repository access token" /><button className="primary" disabled={busy === "connect" || !online} onClick={() => void connect()}><Github size={15} />{busy === "connect" ? "Connecting…" : online ? "Connect Corporate GitHub" : "Connect when online"}</button></div></div> : <><div className="github-session"><div className="github-user"><div>BM</div><span><b>Shared Brandmaster connection</b><p>Private repository access · automatic sync every 45 seconds</p></span></div><div className="github-sync-status"><span>{online ? (lastSyncedAt ? "LAST LIVE SYNC" : "STARTING LIVE SYNC") : "SYNC PAUSED OFFLINE"}</span><b>{lastSyncedAt ? `${fmtDate(lastSyncedAt)} at ${fmtTime(lastSyncedAt)}` : online ? "Loading team data sources…" : "Reconnect to resume automatically"}</b>{teamSync?.lastSyncedBy && <small>Latest team save by {TEAM_MEMBERS.includes(teamSync.lastSyncedBy as typeof TEAM_MEMBERS[number]) ? teamSync.lastSyncedBy : "Shared team"}</small>}</div><div className="sync-actions"><button className="text-button" disabled={Boolean(busy)} onClick={disconnect}><LogOut size={14} />Disconnect</button><button className="primary" disabled={Boolean(busy) || !online} onClick={() => void sync()}><RefreshCw className={busy === "sync" ? "spinning" : ""} size={15} />{busy === "sync" ? "Merging changes…" : !online ? "Paused offline" : remoteUpdate ? "Pull, merge & sync" : "Sync & Pull now"}</button></div></div>{remoteUpdate && <div className="github-update"><Bell size={17} /><span><b>New team update available</b><p>{remoteUpdate.sync?.lastSyncedAt ? `A teammate saved changes ${fmtDate(remoteUpdate.sync.lastSyncedAt)} at ${fmtTime(remoteUpdate.sync.lastSyncedAt)}.` : "A teammate saved a newer workspace."} Live sync will merge it automatically.</p></span><button className="secondary" disabled={Boolean(busy) || !online} onClick={() => void sync()}>Sync now</button></div>}{history.length > 0 && <details className="sync-history"><summary>Recent team sync activity</summary><div>{history.slice(0, 6).map((entry, index) => { const name = TEAM_MEMBERS.includes(entry.syncedBy as typeof TEAM_MEMBERS[number]) ? entry.syncedBy : "Shared team"; return <div key={`${entry.syncedAt}-${index}`}><span>{name.slice(0, 2).toUpperCase()}</span><p><b>{name}</b><small>{fmtDate(entry.syncedAt)} at {fmtTime(entry.syncedAt)} · {entry.changeCount} change{entry.changeCount === 1 ? "" : "s"}</small></p></div>; })}</div></details>}</>}
    <details className="github-admin"><summary>Repository owner setup</summary><ol><li>Open <code>bmeshesha/Brandmaster-data</code> → Settings → Collaborators.</li><li>Add each teammate&apos;s Corporate GitHub username with <b>Write</b> access.</li><li>Ask the teammate to reconnect here. If fine-grained access is unavailable, use the classic <code>repo</code> token link above.</li></ol><p>Corporate network or VPN access is still required. Brandmaster cannot grant repository permissions itself.</p><a href={`https://github.corp.ebay.com/${GITHUB_WORKSPACE_REPOSITORY}/settings/access`} target="_blank" rel="noreferrer">Manage repository collaborators<ExternalLink size={12} /></a></details>
    {message && <div className="sync-message success"><Check size={14} />{message}</div>}{error && <div className="sync-message error"><CircleHelp size={14} />{error}</div>}
  </div></section>;
}

function WorkspaceBackupPanel({ onBackup, onRestore }: { onBackup: () => void; onRestore: (file: File) => Promise<void> }) {
  const input = useRef<HTMLInputElement>(null); const [restoring, setRestoring] = useState(false);
  async function restore(file?: File) { if (!file) return; setRestoring(true); await onRestore(file); setRestoring(false); }
  return <div className="workspace-backup"><div><Archive size={18} /><span><b>Workspace backup</b><p>Save imports, reviews, settings, Root changes, reference tables, and the UBQ index in one JSON file.</p></span></div><div><button className="secondary" onClick={onBackup}><ArrowDownToLine size={14} />Download backup</button><input ref={input} type="file" accept=".json,application/json" hidden onChange={(event) => { void restore(event.target.files?.[0]); event.target.value = ""; }} /><button className="secondary" disabled={restoring} onClick={() => input.current?.click()}><FileUp size={14} />{restoring ? "Restoring…" : "Restore backup"}</button></div></div>;
}

function ReconciliationReport({ data, currentUser, onReturn }: { data: AppData; currentUser: string; onReturn: (ids: string[], destination: "HIGH_PRIORITY" | "REVIEW") => void }) {
  const items = data.adminUpdateRuns.flatMap((run) => run.items.map((item) => ({ ...item, run })));
  if (!items.length) return <section className="reconciliation-report empty" id="source-reconciliation-report"><div><ShieldCheck size={24} /></div><span><b>No Admin verification runs yet</b><p>After a Bulk CSV is confirmed uploaded, the next newer UBQ or Root import will produce a source reconciliation report here.</p></span></section>;
  const counts = (status: AdminUpdateItem["status"]) => items.filter((item) => item.status === status).length;
  const problems = items.filter((item) => ["NOT_APPLIED", "PARTIALLY_APPLIED", "CONFLICT", "CANNOT_VERIFY"].includes(item.status));
  const verified = items.filter((item) => item.status === "VERIFIED");
  function retryCsv(item: AdminUpdateItem) {
    const record: BrandRecord = { id: item.sourceId, name: item.originalName, normalized: normalizeBrand(item.originalName), action: item.action, targetId: item.targetId, targetName: item.targetName, confidence: 100, reason: item.detail, evidence: [], status: "reviewed", decisionSource: "Reconciliation retry" };
    download(`brandmaster-${currentUser.toLowerCase()}-retry-${new Date().toISOString().slice(0, 10)}.csv`, toCsv([record]));
  }
  return <section className="reconciliation-report" id="source-reconciliation-report">
    <div className="reconciliation-head"><span><ShieldCheck size={24} /></span><div><small>EXTERNAL ADMIN VERIFICATION</small><h2>Data source reconciliation</h2><p>Compares confirmed exports with newer UBQ and Root tables. Unverified recommendations never become trusted decision memory.</p></div><strong>{items.length}<small>tracked changes</small></strong></div>
    <div className="reconciliation-stats"><span className="verified"><b>{counts("VERIFIED")}</b><small>Verified</small></span><span className="failed"><b>{counts("NOT_APPLIED")}</b><small>Not applied</small></span><span className="partial"><b>{counts("PARTIALLY_APPLIED")}</b><small>Partial</small></span><span className="conflict"><b>{counts("CONFLICT")}</b><small>Conflicts</small></span><span><b>{counts("AWAITING_NEWER_DATA")}</b><small>Awaiting newer data</small></span></div>
    {problems.length ? <div className="reconciliation-list"><div className="reconciliation-list-head"><b>External-tool issues requiring team action</b><small>These rows may represent repeated work, missed uploads, or incomplete Admin changes.</small></div>{problems.slice(0, 100).map((item) => <article key={item.id}><span className={`reconcile-state ${item.status.toLowerCase()}`}>{item.status.replaceAll("_", " ")}</span><div><b>{item.originalName}</b><small>{item.source} · {item.sourceId} · {item.action}{item.targetName ? ` → ${item.targetName}` : ""}</small><p>{item.detail}</p><em>{item.checkedAgainst ? `Checked against ${item.checkedAgainst}` : "Not checked"}{item.returnedAt ? ` · Returned to ${item.returnDestination === "REVIEW" ? "Step 2" : "High Priority"} by ${item.returnedBy}` : ""}</em></div><div className="reconcile-actions"><button className="secondary" onClick={() => retryCsv(item)}><ArrowDownToLine size={13} />Retry CSV</button><button className="secondary" onClick={() => onReturn([item.id], "HIGH_PRIORITY")}><Users size={13} />High Priority</button><button className="primary" onClick={() => onReturn([item.id], "REVIEW")}><RotateCcw size={13} />Review again</button></div></article>)}</div> : <div className="tables-ready"><Check size={16} /><div><b>No unresolved external-tool issues</b><p>All checked changes are verified, or are still waiting for a newer source export.</p></div></div>}
    {verified.length > 0 && <details className="reconciliation-verified"><summary><Check size={15} />View {verified.length} verified change{verified.length === 1 ? "" : "s"}<ChevronDown size={14} /></summary><div>{verified.slice(0, 100).map((item) => <p key={item.id}><span><b>{item.originalName}</b><small>{item.source} · {item.action}{item.actualTargetName ? ` → ${item.actualTargetName}` : ""}</small></span><em>{item.detail}<small>{item.checkedAgainst ? `Verified against ${item.checkedAgainst}` : "Verified"}</small></em></p>)}</div></details>}
  </section>;
}

type SettingsViewProps = { editingAllowed: boolean; data: AppData; currentUser: string; ubqSource: UbqSource | null; onLoadUbq: (filename: string, rows: ParsedRow[]) => void; onReturnReconciliation: (ids: string[], destination: "HIGH_PRIORITY" | "REVIEW") => void; onClear: () => void; onUpdateSettings: (settings: Partial<ValidationSettings>) => void; onSetReference: (source: "ACA" | "FPA" | "ROOT", brands: CatalogBrand[], filename: string) => void; onAddDecisions: (decisions: AppData["learned"], filename: string) => void; onAddHistoricalMappings: (entries: HistoricalMappingEntry[], filename: string, mode: HistoricalImportMode, idReferences: ManualFpaIdReference[]) => void; onBackup: () => void; onRestore: (file: File) => Promise<void>; createSnapshot: () => SharedWorkspaceSnapshot; applySnapshot: (snapshot: SharedWorkspaceSnapshot) => Promise<void>; githubSession: GitHubSession | null; onGitHubSession: (session: GitHubSession | null) => void; onGitHubSync: () => Promise<string>; online: boolean; serviceSession: SyncSession | null; onServiceSession: (session: SyncSession | null) => void; githubRemoteUpdate: GitHubRemoteUpdate | null; onGitHubRemoteUpdate: (update: GitHubRemoteUpdate | null) => void; githubTeamSync?: SharedWorkspaceSnapshot["sync"]; onGitHubTeamSync: (sync?: SharedWorkspaceSnapshot["sync"]) => void };

function SettingsView({ editingAllowed, data, currentUser, ubqSource, onLoadUbq, onReturnReconciliation, onClear, onUpdateSettings, onSetReference, onAddDecisions, onAddHistoricalMappings, onBackup, onRestore, createSnapshot, applySnapshot, githubSession, onGitHubSession, onGitHubSync, online, serviceSession, onServiceSession, githubRemoteUpdate, onGitHubRemoteUpdate, githubTeamSync, onGitHubTeamSync }: SettingsViewProps) {
  const [confirm, setConfirm] = useState(false); const s = data.validationSettings;
  return <><PageHead eyebrow="DATA SOURCES, VERIFICATION & SYNC" title="Data sources & setup" body="Load fresh UBQ and Root exports, verify what the external Admin tool actually changed, and return unresolved work to team triage." />
    <div className="module-layout"><div className="settings-content">{USE_SYNC_SERVICE ? <ServiceWorkspacePanel createSnapshot={createSnapshot} applySnapshot={applySnapshot} session={serviceSession} onSession={onServiceSession} remoteUpdate={githubRemoteUpdate} onRemoteUpdate={onGitHubRemoteUpdate} teamSync={githubTeamSync} onTeamSync={onGitHubTeamSync} /> : <GitHubWorkspacePanel session={githubSession} onSession={onGitHubSession} remoteUpdate={githubRemoteUpdate} onRemoteUpdate={onGitHubRemoteUpdate} teamSync={githubTeamSync} onSync={onGitHubSync} online={online} />}
      {!editingAllowed && <div className="settings-lock-note"><ShieldCheck size={18} /><span><b>Data changes are locked</b><p>Connect above, or explicitly choose the isolated offline workspace, before replacing tables or changing validation settings.</p></span></div>}
      <fieldset className="workspace-stage" disabled={!editingAllowed}>
      <section className="reference-section"><div className="section-title"><div><h2>Brand data sources</h2><p>The newest source update wins: a brand in the latest full UBQ—or marked UBQ = Yes in a newer Manual FPA upload—is not done. Manual FPA Unmapped Brand IDs remain available for missing-ID lookup.</p></div><span className="offline-chip"><CloudOff size={13} />Stored offline + syncable</span></div><div className="reference-list"><UbqUploader source={ubqSource} meta={data.sourceMeta.UBQ} data={data} onLoad={onLoadUbq} /><DecisionUploader count={Object.keys(data.learned).length} meta={data.sourceMeta.DECISIONS} onLoad={onAddDecisions} /><ReferenceUploader source="ROOT" count={data.rootBrands.length} meta={data.sourceMeta.ROOT} onLoad={(brands, filename) => onSetReference("ROOT", brands, filename)} /><ReferenceUploader source="ACA" count={data.acaBrands.length} meta={data.sourceMeta.ACA} onLoad={(brands, filename) => onSetReference("ACA", brands, filename)} /><ReferenceUploader source="FPA" count={data.fpaBrands.length} meta={data.sourceMeta.FPA} onLoad={(brands, filename) => onSetReference("FPA", brands, filename)} /><HistoricalMappingUploader count={data.historicalMappings.length} idCount={data.manualFpaIds.length} meta={data.sourceMeta.HISTORICAL} onLoad={onAddHistoricalMappings} /></div>{(ubqSource || data.rootBrands.length > 0 || data.historicalMappings.length > 0 || data.manualFpaIds.length > 0) && <div className="tables-ready"><Check size={16} /><div><b>{ubqSource ? "UBQ completion verification is active" : "Validation memory is ready"}</b><p>{ubqSource ? `${ubqSource.count.toLocaleString()} brands are currently in the full UBQ. ` : "No full UBQ export is loaded. "}{data.manualFpaIds.filter((reference) => reference.ubq === true).length.toLocaleString()} brands are explicitly not done in the Manual FPA snapshot; {data.manualFpaIds.length.toLocaleString()} IDs are available for lookup. {data.rootBrands.length.toLocaleString()} active existing brands, {Object.keys(data.learned).length.toLocaleString()} previous decisions, and {data.historicalMappings.length.toLocaleString()} completed historical actions are available.</p>{data.sourceMeta.MANUAL_FPA && <small>{sourceUpdated(data.sourceMeta.MANUAL_FPA)}</small>}</div></div>}</section>
      <ReconciliationReport data={data} currentUser={currentUser} onReturn={onReturnReconciliation} />
      <section><div className="section-title"><div><h2>Offline modules</h2><p>Fast, private, and available without an internet connection.</p></div><span className="offline-chip"><CloudOff size={13} />Always available</span></div>
        <div className="module-list"><ModuleToggle label="Normalize brands" body="Clean OEM wording, separators, punctuation, and whitespace." enabled locked /><ModuleToggle label="Previous decisions" body="Use prior reviews and manual overrides as final decisions." enabled={s.previousDecisions} onChange={() => onUpdateSettings({ previousDecisions: !s.previousDecisions })} /><ModuleToggle label="Historical mapping memory" body={`Recognize ${data.historicalMappings.length.toLocaleString()} past New Brand, Alias, Skip, and Delete actions. Alias evidence still requires a valid target BrandID.`} enabled={s.historicalMappings} onChange={() => onUpdateSettings({ historicalMappings: !s.historicalMappings })} /><ModuleToggle label="Alias table" body="Resolve aliases from the existing and FPA brand tables." enabled={s.aliasTable} onChange={() => onUpdateSettings({ aliasTable: !s.aliasTable })} /><ModuleToggle label="Existing brand table" body={`Authoritative exact and fuzzy matching against ${data.rootBrands.length.toLocaleString()} ACTIVE brands.`} enabled={s.rootBrandTable} onChange={() => onUpdateSettings({ rootBrandTable: !s.rootBrandTable })} /><ModuleToggle label="ACA brand table" body={`Exact and fuzzy recognition against ${data.acaBrands.length.toLocaleString()} locally loaded brands.`} enabled={s.acaTable} onChange={() => onUpdateSettings({ acaTable: !s.acaTable })} /><ModuleToggle label="FPA brand table" body={`Fallback matching against ${(SEED_BRANDS.length + data.fpaBrands.length).toLocaleString()} available brands.`} enabled={s.fpaTable} onChange={() => onUpdateSettings({ fpaTable: !s.fpaTable })} /><ModuleToggle label="Offline brand rules" body="Detect placeholders, OEM language, retailers, and generic text." enabled={s.offlineRules} onChange={() => onUpdateSettings({ offlineRules: !s.offlineRules })} /></div>
      </section>
      <section><div className="section-title"><div><h2>Online integrations</h2><p>No online connector is installed. These modules do not run and never appear in validation progress.</p></div><span className="connection-chip"><CloudOff size={13} />Not connected</span></div>
        <div className="module-list"><ModuleToggle label="Official website search" body="Unavailable until a real search connector is installed and tested." enabled={false} online unavailable /><ModuleToggle label="Marketplace search" body="eBay, Amazon, Walmart, RockAuto, RevZilla, and CMSNL are not connected." enabled={false} online unavailable /><ModuleToggle label="Google search" body="No Google or other search-provider API is connected." enabled={false} online unavailable /><ModuleToggle label="AI validator" body="No OpenAI request is made. Use Manual AI Assist in review if desired." enabled={false} online unavailable /></div>
        <div className="info-banner"><ShieldCheck size={17} /><span>Brandmaster currently performs offline validation only. It will not request or store an API key for unavailable integrations.</span></div>
      </section>
      <section><h2>Workspace data</h2><p>{data.batches.length} imports, {data.priorityQueue.length.toLocaleString()} high-priority team tasks, {data.ledger.length} live reviewed decisions, {data.historicalMappings.length.toLocaleString()} historical mapping actions, and {(data.rootBrands.length + data.acaBrands.length + data.fpaBrands.length).toLocaleString()} reference brands are stored locally and included in workspace sync.</p><WorkspaceBackupPanel onBackup={onBackup} onRestore={onRestore} /><div className="danger-row"><div><b>Clear local workspace</b><p>Remove imports, the high-priority queue, references, settings, review history, historical mappings, and learned decisions.</p></div>{confirm ? <div className="confirm-actions"><button className="secondary" onClick={() => setConfirm(false)}>Cancel</button><button className="danger" onClick={() => { onClear(); setConfirm(false); }}><Trash2 size={15} />Clear everything</button></div> : <button className="danger-outline" onClick={() => setConfirm(true)}>Clear data</button>}</div></section>
      </fieldset>
    </div><aside className="engine-order"><span>EXECUTION ORDER</span><ol>{ubqSource && <li>Resolve UBQ IDs</li>}<li className="required">Normalize</li>{s.previousDecisions && <li>Previous decisions</li>}{s.historicalMappings && <li>Historical mapping memory</li>}{s.aliasTable && <li>Alias table</li>}{s.rootBrandTable && <li>Existing brand table</li>}{s.acaTable && <li>ACA brand table</li>}{s.fpaTable && <li>FPA brand table</li>}{s.offlineRules && <li>Offline rules</li>}</ol><p>The first decisive local match stops processing. Historical Alias rows never invent a target BrandID.</p></aside></div>
  </>;
}
