"use client";

import {
  Activity, Archive, Tags, ArrowDownToLine, BarChart3, Bell, BookOpen, Boxes, Check, ChevronDown,
  CircleHelp, Cloud, CloudOff, Database, FileClock, FileUp, Gauge, History, LayoutDashboard,
  Menu, Moon, MoreHorizontal, PanelLeftClose, Plus, Search, Settings, ShieldCheck, Sparkles,
  Sun, Trash2, UploadCloud, Users, WandSparkles, X,
} from "lucide-react";
import { ChangeEvent, DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { buildAiReviewPrompt, classifyBrand, parseAiReviewJson, parseCsv, parseDecisionCsv, parseReferenceCsv, SEED_BRANDS, toCsv } from "@/lib/brand-engine";
import { clearReferenceTables, download, EMPTY_DATA, loadData, loadReferenceTables, saveData, saveReferenceTable } from "@/lib/storage";
import { Action, AppData, BrandRecord, CatalogBrand, ImportBatch, LedgerEntry, ValidationSettings, View } from "@/lib/types";

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
    { id: "ledger", label: "Decision ledger", icon: History },
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
const uid = () => globalThis.crypto?.randomUUID?.() || Math.random().toString(36).slice(2);
type ParsedRow = ReturnType<typeof parseCsv>[number];
type UbqSource = { filename: string; count: number; byId: Map<string, ParsedRow>; byName: Map<string, ParsedRow[]> };
type ProcessingRun = { filename: string; count: number; steps: string[]; current: number };
const APP_BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

function ActionPill({ action }: { action: Action }) {
  return <span className={`action-pill ${action.toLowerCase()}`}><span />{action}</span>;
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

  useEffect(() => {
    setData(loadData()); setLoaded(true);
    loadReferenceTables().then((tables) => setData((prev) => ({ ...prev, ...tables }))).catch(() => setToast("Local reference tables could not be restored"));
    setDark(localStorage.getItem("brandmaster-theme") === "dark" || (!localStorage.getItem("brandmaster-theme") && matchMedia("(prefers-color-scheme: dark)").matches));
    const update = () => setOnline(navigator.onLine); update();
    addEventListener("online", update); addEventListener("offline", update);
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register(`${APP_BASE_PATH}/sw.js`, { scope: `${APP_BASE_PATH}/` }).catch(() => undefined);
    }
    return () => { removeEventListener("online", update); removeEventListener("offline", update); };
  }, []);
  useEffect(() => { if (loaded) saveData(data); }, [data, loaded]);
  useEffect(() => { document.documentElement.dataset.theme = dark ? "dark" : "light"; localStorage.setItem("brandmaster-theme", dark ? "dark" : "light"); }, [dark]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(""), 2800); return () => clearTimeout(timer); }, [toast]);

  const allRecords = useMemo(() => data.batches.flatMap((batch) => batch.records), [data.batches]);
  const knownBrandIds = useMemo(() => new Set([
    ...SEED_BRANDS, ...data.rootBrands, ...data.fpaBrands, ...data.customBrands,
  ].map((brand) => brand.id).filter((id) => id.startsWith("brand_")).concat(allRecords.map((record) => record.targetId || "").filter((id) => id.startsWith("brand_")))), [data.rootBrands, data.fpaBrands, data.customBrands, allRecords]);
  const current = data.batches[0];
  const pending = allRecords.filter((r) => r.status === "needs-review");
  const avg = allRecords.length ? Math.round(allRecords.reduce((sum, item) => sum + item.confidence, 0) / allRecords.length) : 0;

  function navigate(next: View) { setView(next); setSidebar(false); setSelected(null); }
  function loadUbqSource(filename: string, rows: ParsedRow[]) {
    const byId = new Map<string, ParsedRow>();
    const byName = new Map<string, ParsedRow[]>();
    rows.forEach((row) => {
      byId.set(row.id, row);
      const key = row.name.trim().toLowerCase();
      byName.set(key, [...(byName.get(key) || []), row]);
    });
    setUbqSource({ filename, count: rows.length, byId, byName });
    setToast(`${rows.length.toLocaleString()} UBQ records indexed for this session`);
  }
  function importRows(filename: string, rows: ReturnType<typeof parseCsv>) {
    if (!rows.length) { setToast("No valid brand rows found"); return; }
    const base: AppData = data;
    const s = base.validationSettings;
    const steps = ["Normalize brand names", s.previousDecisions && "Previous decisions", s.aliasTable && "Alias table", s.rootBrandTable && "Existing brand table", s.acaTable && "ACA brand table", s.fpaTable && "FPA brand table", s.offlineRules && "Offline brand rules"].filter(Boolean) as string[];
    setView("review"); setProcessing({ filename, count: rows.length, steps, current: 0 });
    const advance = (index: number) => {
      if (index < steps.length) { setProcessing({ filename, count: rows.length, steps, current: index }); setTimeout(() => advance(index + 1), 340); return; }
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
      const batch: ImportBatch = { id: uid(), filename, createdAt: new Date().toISOString(), rows: rows.length, records };
      setData((prev) => ({ ...prev, batches: [batch, ...prev.batches] })); setProcessing(null); setToast(`${rows.length} brands processed locally`);
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
      const entry: LedgerEntry = { ...changed, ledgerId: uid(), date: new Date().toISOString() };
      const learned = learn ? { ...prev.learned, [changed.normalized.toLowerCase()]: { action: changed.action, targetId: changed.targetId, targetName: changed.targetName, reason: changed.reason, reviewedAt: entry.date, origin: "manual" as const } } : prev.learned;
      return { ...prev, batches, ledger: [entry, ...prev.ledger], learned };
    });
    setSelected(null); setToast("Decision saved to the knowledge base");
  }
  function clearWorkspace() { setData(EMPTY_DATA); void clearReferenceTables(); setSelected(null); setToast("Local workspace cleared"); }
  function updateValidationSettings(changes: Partial<ValidationSettings>) { setData((prev) => ({ ...prev, validationSettings: { ...prev.validationSettings, ...changes } })); }
  function setReferenceTable(source: "ACA" | "FPA" | "ROOT", brands: CatalogBrand[]) { const key = source === "ACA" ? "acaBrands" : source === "FPA" ? "fpaBrands" : "rootBrands"; setData((prev) => ({ ...prev, [key]: brands })); void saveReferenceTable(source, brands); setToast(`${brands.length.toLocaleString()} ${source === "ROOT" ? "existing" : source} brands saved offline`); }
  function addDecisionHistory(decisions: AppData["learned"]) {
    setData((prev) => {
      const manual = Object.fromEntries(Object.entries(prev.learned).filter(([, decision]) => decision.origin !== "imported"));
      return { ...prev, learned: { ...manual, ...decisions } };
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
        <button className="icon-button"><Bell size={18} /><i className="notification-dot" /></button>
        <div className="avatar">BM</div>
      </header>
      <div className="page">
        {view === "dashboard" && <Dashboard data={data} records={allRecords} avg={avg} pending={pending.length} onNavigate={navigate} onImport={importRows} />}
        {view === "imports" && <Imports batches={data.batches} onImport={importRows} onNavigate={navigate} ubqSource={ubqSource} onLoadUbq={loadUbqSource} />}
        {view === "review" && (processing ? <ProcessingView run={processing} /> : <ReviewQueue records={current?.records || []} knownBrandIds={knownBrandIds} onUpdate={updateRecord} onSelect={setSelected} query={query} onNavigate={navigate} />)}
        {view === "output" && <BulkOutput records={current?.records || []} batch={current} onNavigate={navigate} />}
        {view === "brands" && <BrandDatabase data={data} query={query} />}
        {view === "aliases" && <Aliases data={data} />}
        {view === "ledger" && <Ledger entries={data.ledger} records={allRecords} />}
        {view === "analytics" && <Analytics records={allRecords} ledger={data.ledger} />}
        {view === "artifacts" && <ArtifactsView data={data} onNavigate={navigate} />}
        {view === "settings" && <SettingsView data={data} onClear={clearWorkspace} onUpdateSettings={updateValidationSettings} onSetReference={setReferenceTable} onAddDecisions={addDecisionHistory} />}
      </div>
    </main>
    {selected && <DecisionDrawer record={selected} brands={[...SEED_BRANDS, ...data.customBrands]} onClose={() => setSelected(null)} onSave={updateRecord} />}
    {toast && <div className="toast"><Check size={16} />{toast}</div>}
  </div>;
}

function PageHead({ eyebrow, title, body, actions }: { eyebrow?: string; title: string; body: string; actions?: React.ReactNode }) {
  return <div className="page-head"><div>{eyebrow && <span>{eyebrow}</span>}<h1>{title}</h1><p>{body}</p></div>{actions && <div className="page-actions">{actions}</div>}</div>;
}

function WorkflowStepper({ stage, onNavigate, hasImport = false, outputReady = false }: { stage: 1 | 2 | 3; onNavigate: (view: View) => void; hasImport?: boolean; outputReady?: boolean }) {
  const steps: { number: 1 | 2 | 3; label: string; detail: string; view: View; available: boolean }[] = [
    { number: 1, label: "Import CSV", detail: "Unmapped IDs + names", view: "imports", available: true },
    { number: 2, label: "Process & review", detail: "Validate every action", view: "review", available: hasImport },
    { number: 3, label: "Bulk output CSV", detail: "Ready for real tool", view: "output", available: hasImport },
  ];
  return <div className="workflow-stepper">{steps.map((step, index) => <div className={`workflow-step ${stage === step.number ? "active" : ""} ${stage > step.number || (step.number === 3 && outputReady) ? "done" : ""}`} key={step.number}><button disabled={!step.available} onClick={() => onNavigate(step.view)}><span>{stage > step.number || (step.number === 3 && outputReady) ? <Check size={15} /> : step.number}</span><div><b>{step.label}</b><small>{step.detail}</small></div></button>{index < 2 && <i />}</div>)}</div>;
}

function ProcessingView({ run }: { run: ProcessingRun }) {
  const progress = Math.round(((run.current + 1) / run.steps.length) * 100);
  return <div className="processing-page"><div className="processing-orbit"><span className="orbit-ring ring-one" /><span className="orbit-ring ring-two" /><div><WandSparkles size={30} /><b>{progress}%</b></div></div><span className="processing-eyebrow">VALIDATION ENGINE RUNNING</span><h1>Checking {run.count.toLocaleString()} brand{run.count === 1 ? "" : "s"}</h1><p>{run.filename}</p><div className="process-progress"><i style={{ width: `${progress}%` }} /></div><div className="process-modules">{run.steps.map((step, index) => <div className={index < run.current ? "done" : index === run.current ? "active" : ""} key={step}><span>{index < run.current ? <Check size={14} /> : index === run.current ? <Activity size={14} /> : index + 1}</span><div><b>{step}</b><small>{index < run.current ? "Checked" : index === run.current ? "Searching now…" : "Waiting"}</small></div>{index === run.current && <em><i /><i /><i /></em>}</div>)}</div><small className="processing-note"><ShieldCheck size={13} />All local checks run on this Mac. Your data is not uploaded.</small></div>;
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
      <section className="panel recent-panel"><div className="panel-head"><div><h2>Recent decisions</h2><p>Latest activity across imports and reviews</p></div><button className="text-button" onClick={() => onNavigate("ledger")}>View ledger →</button></div>
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

function Imports({ batches, onImport, onNavigate, ubqSource, onLoadUbq }: { batches: ImportBatch[]; onImport: (name: string, rows: ReturnType<typeof parseCsv>) => void; onNavigate: (v: View) => void; ubqSource: UbqSource | null; onLoadUbq: (name: string, rows: ParsedRow[]) => void }) {
  const input = useRef<HTMLInputElement>(null); const sourceInput = useRef<HTMLInputElement>(null); const [drag, setDrag] = useState(false); const [error, setError] = useState(""); const [sourceLoading, setSourceLoading] = useState(false); const [brandNames, setBrandNames] = useState(""); const [inputMode, setInputMode] = useState<"csv" | "paste">("csv");
  function accept(file?: File) { if (!file) return; if (!file.name.toLowerCase().endsWith(".csv")) { setError("Please choose a CSV file."); return; } const reader = new FileReader(); reader.onload = () => { const rows = parseCsv(String(reader.result)); if (!rows.length) setError("No brand rows found. Include UnmappedBrandID and UnmappedBrandName columns."); else { setError(""); onImport(file.name, rows); } }; reader.readAsText(file); }
  function acceptSource(file?: File) { if (!file) return; if (!file.name.toLowerCase().endsWith(".csv")) { setError("The UBQ reference must be a CSV file."); return; } setSourceLoading(true); const reader = new FileReader(); reader.onload = () => { const rows = parseCsv(String(reader.result)); setSourceLoading(false); if (!rows.length || !rows.some((row) => row.id.startsWith("draft_brand_"))) setError("This does not look like a UBQ export. Expected Brand ID and Brand Name columns."); else { setError(""); onLoadUbq(file.name, rows); } }; reader.onerror = () => { setSourceLoading(false); setError("The UBQ reference could not be read."); }; reader.readAsText(file); }
  function drop(e: DragEvent) { e.preventDefault(); setDrag(false); accept(e.dataTransfer.files[0]); }
  const pastedNames = [...new Map(brandNames.split(/\r?\n/).map((name) => name.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim()).filter(Boolean).map((name) => [name.toLowerCase(), name])).values()];
  function validatePasted() { onImport("pasted-brand-list.csv", pastedNames.map((name, index) => ({ id: `missing_id_${String(index + 1).padStart(5, "0")}`, name }))); }
  return <><WorkflowStepper stage={1} onNavigate={onNavigate} hasImport={batches.length > 0} />
    <PageHead eyebrow="STEP 1 OF 3" title="Add brands to validate" body="Upload a CSV or paste brand names, then run validation." />
    <section className="compact-import"><div className="input-mode-tabs"><div><button className={inputMode === "csv" ? "active" : ""} onClick={() => setInputMode("csv")}><FileUp size={15} />Upload CSV</button><button className={inputMode === "paste" ? "active" : ""} onClick={() => setInputMode("paste")}><WandSparkles size={15} />Paste brands</button></div><button className="text-button" onClick={() => download("brandmaster-template.csv", "UnmappedBrandID,UnmappedBrandName,Seller Count\n")}><ArrowDownToLine size={13} />Template</button></div>
      {inputMode === "csv" ? <div className={`dropzone compact ${drag ? "drag" : ""}`} onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={drop} onClick={() => input.current?.click()}><input ref={input} type="file" accept=".csv,text/csv" hidden onChange={(e: ChangeEvent<HTMLInputElement>) => accept(e.target.files?.[0])} /><div className="drop-icon"><UploadCloud size={23} /></div><div><h2>Drop CSV or click to browse</h2><p>Brand ID + Brand Name · up to 10 MB</p></div><button className="primary">Choose CSV</button></div> : <div className="compact-paste"><textarea value={brandNames} onChange={(e) => setBrandNames(e.target.value)} placeholder={"One brand per line…\npegaso\nb & p rods\nvolkswagen oe"} /><div className="compact-paste-footer"><div className={`id-mini ${ubqSource ? "ready" : ""}`}>{ubqSource ? <Check size={12} /> : <CircleHelp size={12} />}{ubqSource ? "UBQ IDs ready" : "Load UBQ below for IDs"}</div><span>{pastedNames.length} unique</span><button className="primary" disabled={!pastedNames.length} onClick={validatePasted}><WandSparkles size={15} />Validate {pastedNames.length || ""}</button></div></div>}
    </section>{error && <div className="error-banner"><CircleHelp size={17} />{error}</div>}
    <details className="optional-source"><summary><Database size={16} /><span><b>Optional: verify against a full UBQ export</b><small>Useful when the worklist contains names without trusted current IDs</small></span><ChevronDown size={16} /></summary><div><p>Load Brand ID, Brand Name, Seller Count. The large file is indexed for this session and is not added to the processing queue.</p><input ref={sourceInput} type="file" accept=".csv,text/csv" hidden onChange={(e) => acceptSource(e.target.files?.[0])} />{ubqSource ? <div className="source-loaded"><Check size={16} /><div><b>{ubqSource.filename}</b><span>{ubqSource.count.toLocaleString()} UBQ brands indexed</span></div><button className="text-button" onClick={() => sourceInput.current?.click()}>Replace</button></div> : <button className="secondary" disabled={sourceLoading} onClick={() => sourceInput.current?.click()}>{sourceLoading ? "Indexing UBQ…" : "Choose full UBQ export"}</button>}</div></details>
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
      reason: change.reason, evidence: ["Imported external AI review", ...change.evidence], decisionSource: "AI review JSON",
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

function ReviewQueue({ records, knownBrandIds, onUpdate, onSelect, query, onNavigate }: { records: BrandRecord[]; knownBrandIds: Set<string>; onUpdate: (id: string, changes: Partial<BrandRecord>, learn?: boolean) => void; onSelect: (r: BrandRecord) => void; query: string; onNavigate: (view: View) => void }) {
  const [filter, setFilter] = useState<"all" | "needs-review" | "reviewed">("all");
  const [checked, setChecked] = useState<string[]>([]);
  const visible = records.filter((r) => (filter === "all" || r.status === filter) && `${r.name} ${r.normalized} ${r.action}`.toLowerCase().includes(query.toLowerCase()));
  const needs = records.filter((r) => r.status === "needs-review").length;
  const verified = records.filter((r) => r.ubqVerified).length;
  const unverified = records.length - verified;
  const invalidMerges = records.filter((r) => r.action === "MERGE" && (!r.targetId?.startsWith("brand_") || !r.targetName)).length;
  const exportReady = needs === 0 && invalidMerges === 0 && unverified === 0;
  function bulk(action?: Action) { checked.forEach((id) => { const r = records.find((item) => item.id === id); if (r) onUpdate(id, { action: action || r.action, reason: action ? `Manually set to ${action}` : r.reason }, true); }); setChecked([]); }
  if (!records.length) return <><WorkflowStepper stage={2} onNavigate={onNavigate} /><PageHead eyebrow="STEP 2 OF 3" title="Process and review" body="Confirm recommendations before generating a file for the real bulk-upload tool." /><div className="panel"><EmptyState icon={FileClock} title="Import a CSV first" body="Start at step 1 with a CSV containing Brand ID and Brand Name." action={<button className="primary" onClick={() => onNavigate("imports")}>Go to Import CSV</button>} /></div></>;
  return <><WorkflowStepper stage={2} onNavigate={onNavigate} hasImport outputReady={exportReady} /><PageHead eyebrow="STEP 2 OF 3" title="Process and review" body={`${needs} brand${needs === 1 ? "" : "s"} still require a decision. High-confidence rows are already prepared.`} actions={<button className="primary" disabled={!exportReady} title={!exportReady ? "Resolve the remaining checks first" : "Continue to the output file"} onClick={() => onNavigate("output")}>Continue to output →</button>} />
    <div className={`readiness ${exportReady ? "complete" : ""}`}><div>{exportReady ? <Check size={17} /> : <ShieldCheck size={17} />}<span><b>{exportReady ? "Processing complete" : "Resolve these checks to continue"}</b><small>{verified ? `${verified} of ${records.length} rows have valid unmapped IDs` : "Return to Import CSV and use real draft_brand_… IDs"}</small></span></div><div><span>{unverified}<small>Invalid IDs</small></span><span>{needs}<small>Needs review</small></span><span>{invalidMerges}<small>Incomplete merges</small></span></div></div>
    <AiReviewAssist records={records} knownBrandIds={knownBrandIds} onUpdate={onUpdate} />
    <div className="review-toolbar"><div className="tabs"><button className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>All <span>{records.length}</span></button><button className={filter === "needs-review" ? "active" : ""} onClick={() => setFilter("needs-review")}>Needs review <span>{needs}</span></button><button className={filter === "reviewed" ? "active" : ""} onClick={() => setFilter("reviewed")}>Reviewed <span>{records.filter((r) => r.status === "reviewed").length}</span></button></div><button className="subtle">All actions <ChevronDown size={14} /></button></div>
    {checked.length > 0 && <div className="bulk-bar"><b>{checked.length} selected</b><button onClick={() => bulk()}>Approve</button><button onClick={() => bulk("MERGE")}>Merge</button><button onClick={() => bulk("SKIP")}>Skip</button><button onClick={() => bulk("DELETE")}>Delete</button><button className="icon-button" onClick={() => setChecked([])}><X size={16} /></button></div>}
    <div className="table-panel"><div className="data-table review-table"><div className="table-row table-head-row"><div><input type="checkbox" checked={visible.length > 0 && visible.every((r) => checked.includes(r.id))} onChange={(e) => setChecked(e.target.checked ? visible.map((r) => r.id) : [])} /></div><div>Unmapped brand</div><div>Normalized</div><div>Action</div><div>Source</div><div>Confidence</div><div>Status</div><div /></div>
      {visible.map((r) => <div className="table-row" key={r.id} onClick={() => onSelect(r)}><div onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={checked.includes(r.id)} onChange={(e) => setChecked(e.target.checked ? [...checked, r.id] : checked.filter((id) => id !== r.id))} /></div><div className="brand-cell"><b>{r.name}</b><span>{r.id}</span>{r.ubqVerified && <span className="ubq-badge"><Check size={10} />ID verified</span>}</div><div><b>{r.normalized}</b>{r.name !== r.normalized && <span className="normalized-note">Normalized</span>}</div><div><ActionPill action={r.action} />{r.targetName && <small>→ {r.targetName}</small>}</div><div><span className="source-pill">{r.decisionSource || "Legacy decision"}</span></div><div><Confidence value={r.confidence} /></div><div>{r.status === "needs-review" ? <span className="status review">Needs review</span> : r.status === "reviewed" ? <span className="status done"><Check size={12} />Reviewed</span> : <span className="status ready"><Sparkles size={12} />Auto-ready</span>}</div><div><button className="more"><MoreHorizontal size={17} /></button></div></div>)}
    </div>{!visible.length && <EmptyState icon={Search} title="No matching records" body="Try another search or queue filter." />}</div>
    <p className="table-caption">Showing {visible.length} of {records.length} brands · Select any row to edit its action, TargetBrandID, TargetBrandName, evidence, or notes.</p>
  </>;
}

function BulkOutput({ records, batch, onNavigate }: { records: BrandRecord[]; batch?: ImportBatch; onNavigate: (view: View) => void }) {
  const needs = records.filter((r) => r.status === "needs-review").length;
  const invalidIds = records.filter((r) => !r.ubqVerified).length;
  const invalidMerges = records.filter((r) => r.action === "MERGE" && (!r.targetId?.startsWith("brand_") || !r.targetName)).length;
  const ready = records.length > 0 && needs === 0 && invalidIds === 0 && invalidMerges === 0;
  const count = (action: Action) => records.filter((r) => r.action === action).length;
  return <><WorkflowStepper stage={3} onNavigate={onNavigate} hasImport={records.length > 0} outputReady={ready} />
    <PageHead eyebrow="STEP 3 OF 3" title="Bulk output CSV" body="Download the finished mapping file, then upload it in the real Bulk Upload Brand Mappings tool." />
    {!records.length ? <div className="panel"><EmptyState icon={FileUp} title="No processed import" body="Import a CSV first to begin the three-step workflow." action={<button className="primary" onClick={() => onNavigate("imports")}>Start with Import CSV</button>} /></div> : !ready ? <div className="output-blocked"><div className="output-status-icon"><FileClock size={24} /></div><h2>Your output needs attention</h2><p>Return to processing and resolve every check before downloading a bulk-upload file.</p><div className="output-checks"><span className={invalidIds ? "bad" : "good"}>{invalidIds ? <X size={14} /> : <Check size={14} />}Valid unmapped IDs <b>{invalidIds ? `${invalidIds} missing` : "Complete"}</b></span><span className={needs ? "bad" : "good"}>{needs ? <X size={14} /> : <Check size={14} />}Review decisions <b>{needs ? `${needs} remaining` : "Complete"}</b></span><span className={invalidMerges ? "bad" : "good"}>{invalidMerges ? <X size={14} /> : <Check size={14} />}MERGE targets <b>{invalidMerges ? `${invalidMerges} incomplete` : "Complete"}</b></span></div><button className="primary" onClick={() => onNavigate("review")}>Return to process & review</button></div> : <>
      <div className="output-success"><div className="output-status-icon"><Check size={25} /></div><div><span>READY FOR BULK UPLOAD</span><h2>{records.length.toLocaleString()} brand mappings passed every check</h2><p>The file contains only the five columns accepted by the real upload tool.</p></div><button className="primary output-download" onClick={() => download("brandmaster-bulk-brand-mappings.csv", toCsv(records))}><ArrowDownToLine size={17} />Download bulk output CSV</button></div>
      <section className="output-summary"><div><b>{records.length}</b><span>Total rows</span></div><div className="merge"><b>{count("MERGE")}</b><span>MERGE</span></div><div className="create"><b>{count("CREATE")}</b><span>CREATE</span></div><div className="skip"><b>{count("SKIP")}</b><span>SKIP</span></div><div className="delete"><b>{count("DELETE")}</b><span>DELETE</span></div></section>
      <section className="panel output-preview"><div className="panel-head"><div><h2>File preview</h2><p>{batch?.filename} → brandmaster-bulk-brand-mappings.csv</p></div><span className="status done"><Check size={12} />5 required columns</span></div><div className="output-table"><div><b>UnmappedBrandID</b><b>UnmappedBrandName</b><b>Action</b><b>TargetBrandID</b><b>TargetBrandName</b></div>{records.slice(0, 6).map((r) => <div key={r.id}><code>{r.id}</code><span>{r.name}</span><ActionPill action={r.action} /><code>{r.action === "MERGE" ? r.targetId : ""}</code><span>{r.action === "CREATE" || r.action === "MERGE" ? r.targetName : ""}</span></div>)}</div>{records.length > 6 && <p className="preview-more">Previewing 6 of {records.length.toLocaleString()} rows</p>}</section>
    </>}
  </>;
}

function DecisionDrawer({ record, brands, onClose, onSave }: { record: BrandRecord; brands: typeof SEED_BRANDS; onClose: () => void; onSave: (id: string, changes: Partial<BrandRecord>, learn?: boolean) => void }) {
  const [action, setAction] = useState<Action>(record.action); const [unmappedId, setUnmappedId] = useState(record.id); const [target, setTarget] = useState(record.targetId || ""); const [targetName, setTargetName] = useState(record.targetName || record.normalized); const [notes, setNotes] = useState(record.notes || "");
  return <><div className="drawer-scrim" onClick={onClose} /><aside className="drawer"><div className="drawer-head"><div><span>BRAND DECISION</span><h2>{record.name}</h2></div><button className="icon-button" onClick={onClose}><X size={20} /></button></div><div className="drawer-body">
    <div className="name-transform"><div><span>Original</span><b>{record.name}</b></div><strong>→</strong><div><span>Normalized</span><b>{record.normalized}</b></div></div>
    <label className="field identity-field"><span>UnmappedBrandID</span><input value={unmappedId} onChange={(e) => setUnmappedId(e.target.value.trim())} placeholder="draft_brand_..." /><small>{unmappedId.startsWith("draft_brand_") ? "Valid bulk-upload ID format" : "A real UBQ draft_brand_… ID is required before export."}</small></label>
    <section><h3>Recommendation</h3><div className="ai-recommendation"><div><Sparkles size={18} /><b>{record.decisionSource || "Local decision engine"}</b><Confidence value={record.confidence} /></div><ActionPill action={record.action} /><p>{record.reason}</p></div></section>
    <section><h3>Evidence</h3><div className="evidence-list">{record.evidence.map((item, i) => <div key={item}><span>{i === 0 ? <Database size={15} /> : <Search size={15} />}</span><div><b>{item}</b><p>{item.includes("Offline") ? "Connect an enrichment API in Settings for live source verification." : "Matched during local processing."}</p></div><Check size={15} /></div>)}</div></section>
    <section><h3>Your decision</h3><div className="action-picker">{(["MERGE", "CREATE", "SKIP", "DELETE"] as Action[]).map((a) => <button key={a} className={`${a.toLowerCase()} ${action === a ? "active" : ""}`} onClick={() => setAction(a)}><span>{a === "MERGE" ? "↗" : a === "CREATE" ? "+" : a === "SKIP" ? "–" : "×"}</span>{a}<Check size={14} /></button>)}</div>
      {action === "MERGE" && <div className="merge-fields"><label className="field"><span>Known target shortcut</span><select value={brands.some((b) => b.id === target) ? target : ""} onChange={(e) => { const brand = brands.find((b) => b.id === e.target.value); setTarget(brand?.id || ""); setTargetName(brand?.name || ""); }}><option value="">Choose or enter a target below…</option>{brands.map((b) => <option key={b.id} value={b.id}>{b.name} — {b.id}</option>)}</select></label><label className="field"><span>TargetBrandID</span><input value={target} onChange={(e) => setTarget(e.target.value.trim())} placeholder="brand_xxxxxxxxxxxxxxxxxxxxxx" /></label><label className="field"><span>TargetBrandName</span><input value={targetName} onChange={(e) => setTargetName(e.target.value)} placeholder="Canonical brand name" /></label></div>}
      {action === "CREATE" && <label className="field"><span>TargetBrandName</span><input value={targetName} onChange={(e) => setTargetName(e.target.value)} placeholder="Canonical brand name to create" /><small>TargetBrandID stays blank for CREATE.</small></label>}
      <label className="field"><span>Reviewer notes</span><textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Add context for the decision ledger…" /></label>
    </section></div><div className="drawer-footer"><p><kbd>⌘</kbd><kbd>↵</kbd> Save decision</p><button className="secondary" onClick={onClose}>Cancel</button><button className="primary" disabled={(action === "MERGE" && (!target.startsWith("brand_") || !targetName.trim())) || (action === "CREATE" && !targetName.trim())} onClick={() => onSave(record.id, { id: unmappedId, ubqVerified: unmappedId.startsWith("draft_brand_"), action, targetId: action === "MERGE" ? target : undefined, targetName: action === "MERGE" || action === "CREATE" ? targetName.trim() : undefined, notes, confidence: 100, reason: `Validated for bulk upload: ${action}` }, true)}>Save decision</button></div></aside></>;
}

function BrandDatabase({ data, query }: { data: AppData; query: string }) {
  const brands = [...data.rootBrands, ...SEED_BRANDS, ...data.customBrands, ...data.acaBrands, ...data.fpaBrands].filter((b) => `${b.name} ${b.aliases.join(" ")} ${b.category}`.toLowerCase().includes(query.toLowerCase()));
  return <><PageHead eyebrow="KNOWLEDGE BASE" title="Brand database" body={`${brands.length} canonical brands available for matching.`} actions={<button className="primary"><Plus size={16} />Add brand</button>} /><div className="table-panel"><div className="data-table brand-table"><div className="table-row table-head-row"><div>Brand</div><div>Brand ID</div><div>Category</div><div>Aliases</div><div>Country</div><div>Source</div></div>{brands.map((b) => <div className="table-row" key={b.id}><div className="brand-logo">{b.name.slice(0, 2).toUpperCase()}<span><b>{b.name}</b><small>{b.website || "Website not set"}</small></span></div><div><code>{b.id}</code></div><div><span className="category">{b.category}</span></div><div>{b.aliases.length}</div><div>{b.country || "—"}</div><div><span className="status done"><Check size={12} />FPA seed</span></div></div>)}</div></div></>;
}

function Aliases({ data }: { data: AppData }) {
  const brands = [...data.rootBrands, ...SEED_BRANDS, ...data.customBrands, ...data.acaBrands, ...data.fpaBrands]; const aliases = brands.flatMap((b) => b.aliases.map((a) => ({ alias: a, brand: b })));
  return <><PageHead eyebrow="KNOWLEDGE BASE" title="Brand aliases" body="Alternate names resolve to a single canonical catalog brand." actions={<button className="primary"><Plus size={16} />Add alias</button>} /><div className="table-panel"><div className="data-table alias-table"><div className="table-row table-head-row"><div>Alias</div><div>Canonical brand</div><div>Brand ID</div><div>Match type</div><div>Updated</div></div>{aliases.map(({ alias, brand }) => <div className="table-row" key={`${brand.id}-${alias}`}><div><b>{alias}</b></div><div>{brand.name}</div><div><code>{brand.id}</code></div><div><span className="category">Exact alias</span></div><div>Built in</div></div>)}</div></div></>;
}

function Ledger({ entries, records }: { entries: LedgerEntry[]; records: BrandRecord[] }) {
  const exportRecords = entries.length ? entries : records;
  return <><PageHead eyebrow="AUDIT TRAIL" title="Decision ledger" body="An immutable history of reviewed brand decisions." actions={<><button className="secondary" onClick={() => download("brandmaster-ledger.json", JSON.stringify(entries, null, 2), "application/json")}><ArrowDownToLine size={16} />JSON</button><button className="primary" onClick={() => download("brandmaster-decisions.csv", toCsv(exportRecords))}><ArrowDownToLine size={16} />Export CSV</button></>} />
    <div className="table-panel">{entries.length ? <div className="data-table ledger-table"><div className="table-row table-head-row"><div>Date</div><div>Brand</div><div>Action</div><div>Target brand</div><div>Confidence</div><div>Reviewer</div></div>{entries.map((e) => <div className="table-row" key={e.ledgerId}><div><b>{fmtDate(e.date)}</b><small>{fmtTime(e.date)}</small></div><div><b>{e.name}</b><small>{e.normalized}</small></div><div><ActionPill action={e.action} /></div><div>{e.targetName || "—"}</div><div><Confidence value={e.confidence} /></div><div><span className="reviewer-avatar">BM</span>{e.reviewer || "You"}</div></div>)}</div> : <EmptyState icon={History} title="Your ledger is empty" body="Review a recommendation and every decision will be recorded here." />}</div></>;
}

function Analytics({ records, ledger }: { records: BrandRecord[]; ledger: LedgerEntry[] }) {
  const high = records.filter((r) => r.confidence >= 90).length; const normalized = records.filter((r) => r.name !== r.normalized).length;
  return <><PageHead eyebrow="INSIGHTS" title="Validation analytics" body="Quality and throughput signals from your local workspace." /><section className="metrics-grid analytics-metrics"><MetricCard title="Total processed" value={records.length} delta="Across all imports" icon={Boxes} /><MetricCard title="High confidence" value={high} delta={`${records.length ? Math.round(high / records.length * 100) : 0}% auto-ready`} icon={ShieldCheck} tone="blue" /><MetricCard title="Names normalized" value={normalized} delta="Rules applied" icon={WandSparkles} tone="purple" /><MetricCard title="Manual decisions" value={ledger.length} delta="Learning examples" icon={Users} tone="amber" /></section><section className="dashboard-grid"><div className="panel chart-panel"><div className="panel-head"><div><h2>Action distribution</h2><p>Current recommendation mix</p></div></div>{records.length ? <ActionChart records={records} /> : <EmptyState icon={BarChart3} title="No analytics yet" body="Process a CSV to populate this report." />}</div><div className="panel"><div className="panel-head"><div><h2>Confidence health</h2><p>How much can be automated</p></div></div><div className="health-score"><div style={{ "--score": `${records.length ? records.reduce((s, r) => s + r.confidence, 0) / records.length : 0}%` } as React.CSSProperties}><b>{records.length ? Math.round(records.reduce((s, r) => s + r.confidence, 0) / records.length) : 0}</b><span>Average score</span></div><p><ShieldCheck size={16} />Recommendations at 90% or higher are ready for export. Everything else stays visible for human review.</p></div></div></section></>;
}

function ArtifactsView({ data, onNavigate }: { data: AppData; onNavigate: (view: View) => void }) {
  const totalRows = data.batches.reduce((sum, batch) => sum + batch.rows, 0);
  const ready = (batch: ImportBatch) => batch.records.length > 0 && batch.records.every((record) => Boolean(record.ubqVerified && record.status !== "needs-review" && (record.action !== "MERGE" || (record.targetId?.startsWith("brand_") && record.targetName))));
  return <><PageHead eyebrow="WORKSPACE DATA" title="Data & artifacts" body="Import history, generated bulk files, decisions, and offline reference sources live here—not in the validation workflow." actions={<button className="secondary" onClick={() => onNavigate("settings")}><Settings size={15} />Validation modules</button>} />
    <section className="artifact-stats"><div><FileUp size={17} /><span><b>{data.batches.length}</b><small>Imports</small></span></div><div><Boxes size={17} /><span><b>{totalRows.toLocaleString()}</b><small>Processed rows</small></span></div><div><ArrowDownToLine size={17} /><span><b>{data.batches.filter(ready).length}</b><small>Ready bulk files</small></span></div><div><History size={17} /><span><b>{data.ledger.length}</b><small>Manual decisions</small></span></div></section>
    <div className="artifact-layout"><section className="panel"><div className="panel-head"><div><h2>Import history</h2><p>Processing runs stored on this device</p></div></div>{data.batches.length ? <div className="artifact-list">{data.batches.map((batch, index) => { const isReady = ready(batch); const needs = batch.records.filter((record) => record.status === "needs-review").length; return <div key={batch.id}><div className="file-icon">CSV</div><div><b>{batch.filename}</b><p>{fmtDate(batch.createdAt)} at {fmtTime(batch.createdAt)} · {batch.rows.toLocaleString()} brands</p></div><span className={`status ${isReady ? "done" : "review"}`}>{isReady ? <><Check size={12} />Ready</> : `${needs} to review`}</span>{index === 0 && <button className="text-button" onClick={() => onNavigate("review")}>Open latest</button>}</div>; })}</div> : <EmptyState icon={Archive} title="No import history" body="Completed and in-progress validation runs will appear here." />}</section>
      <aside className="artifact-side"><section className="panel"><div className="panel-head"><div><h2>Bulk CSV artifacts</h2><p>Files ready for the real upload tool</p></div></div>{data.batches.length ? <div className="download-list">{data.batches.slice(0, 6).map((batch) => <div key={batch.id}><div><b>{batch.filename.replace(/\.csv$/i, "")}</b><small>{ready(batch) ? `${batch.rows.toLocaleString()} mappings` : "Complete review first"}</small></div><button className="icon-button" disabled={!ready(batch)} title={ready(batch) ? "Download bulk output" : "Not ready"} onClick={() => download(`brandmaster-${batch.filename.replace(/\.csv$/i, "")}-bulk.csv`, toCsv(batch.records))}><ArrowDownToLine size={16} /></button></div>)}</div> : <EmptyState icon={ArrowDownToLine} title="No artifacts" body="Validated bulk files will appear here." />}</section>
        <section className="panel"><div className="panel-head"><div><h2>Offline sources</h2><p>Stored in this browser profile</p></div></div><div className="source-summary"><div><span>Previous decisions</span><b>{Object.keys(data.learned).length.toLocaleString()}</b></div><div><span>Existing brands</span><b>{data.rootBrands.length.toLocaleString()}</b></div><div><span>ACA brands</span><b>{data.acaBrands.length.toLocaleString()}</b></div><div><span>FPA brands</span><b>{data.fpaBrands.length.toLocaleString()}</b></div><button className="text-button" onClick={() => onNavigate("settings")}>Manage sources →</button></div></section>
      </aside></div>
  </>;
}

function ModuleToggle({ label, body, enabled, onChange, locked = false, online = false, unavailable = false }: { label: string; body: string; enabled: boolean; onChange?: () => void; locked?: boolean; online?: boolean; unavailable?: boolean }) {
  return <button className={`module-row ${unavailable ? "unavailable" : ""}`} onClick={onChange} disabled={locked || unavailable}><span className={`module-check ${enabled ? "enabled" : ""}`}>{enabled && <Check size={13} />}</span><div><b>{label}</b><p>{body}</p></div>{unavailable ? <em>NOT CONNECTED</em> : online ? <em>ONLINE</em> : locked ? <em>REQUIRED</em> : null}</button>;
}

function ReferenceUploader({ source, count, onLoad }: { source: "ACA" | "FPA" | "ROOT"; count: number; onLoad: (brands: CatalogBrand[]) => void }) {
  const input = useRef<HTMLInputElement>(null); const [loading, setLoading] = useState(false); const [error, setError] = useState(""); const [filename, setFilename] = useState("");
  function accept(file?: File) { if (!file) return; setLoading(true); setError(""); const reader = new FileReader(); reader.onload = () => { const brands = parseReferenceCsv(String(reader.result), source); setLoading(false); if (!brands.length) { setError(source === "ACA" ? "Expected BrandID and BrandName columns." : source === "ROOT" ? "Expected aliases, id, name, and status columns." : "Expected aliases, id, and name columns with brand_ IDs."); return; } onLoad(brands); setFilename(file.name); }; reader.onerror = () => { setLoading(false); setError("This CSV could not be read."); }; reader.readAsText(file); }
  const title = source === "ROOT" ? "Existing Brand Table" : `${source} Brand Table`; const purpose = source === "ACA" ? "BRAND RECOGNITION" : source === "ROOT" ? "AUTHORITATIVE EXISTING BRANDS" : "MERGE TARGETS & ALIASES"; const schema = source === "ACA" ? "BrandID · BrandName · SubBrandName" : source === "ROOT" ? "aliases · id · name · status" : "aliases · id · name";
  return <div className={`reference-upload ${source === "ROOT" ? "root-upload" : ""} ${count ? "loaded" : ""}`}><div className="reference-icon">{count ? <Check size={18} /> : <Database size={18} />}</div><div className="reference-info"><span>{purpose}</span><b>{title}</b><p>{count ? `${count.toLocaleString()} ${source === "ACA" ? "recognized" : "canonical"} brands available offline` : "Not loaded"}</p>{filename && <small>{filename}</small>}<code>{schema}</code></div><input ref={input} type="file" accept=".csv,text/csv" hidden onChange={(e) => accept(e.target.files?.[0])} /><button className={count ? "secondary" : "primary"} onClick={() => input.current?.click()}>{loading ? "Validating…" : count ? "Replace" : "Add table"}</button>{error && <div className="reference-error"><CircleHelp size={14} />{error}</div>}</div>;
}

function DecisionUploader({ count, onLoad }: { count: number; onLoad: (decisions: AppData["learned"]) => void }) {
  const input = useRef<HTMLInputElement>(null); const [loading, setLoading] = useState(false); const [message, setMessage] = useState(""); const [error, setError] = useState("");
  function accept(file?: File) { if (!file) return; setLoading(true); setError(""); const reader = new FileReader(); reader.onload = () => { const result = parseDecisionCsv(String(reader.result)); setLoading(false); if (!result.imported) { setError("Expected listing_brand, action, merge_target, and fpa_brand_id columns."); return; } onLoad(result.decisions); setMessage(`${result.imported.toLocaleString()} imported${result.skipped ? ` · ${result.skipped} skipped` : ""}${result.conflicts ? ` · ${result.conflicts} conflicts excluded` : ""}`); }; reader.onerror = () => { setLoading(false); setError("This CSV could not be read."); }; reader.readAsText(file); }
  return <div className={`reference-upload decision-upload ${count ? "loaded" : ""}`}><div className="reference-icon">{count ? <Check size={18} /> : <History size={18} />}</div><div className="reference-info"><span>HIGHEST-PRIORITY VALIDATION SOURCE</span><b>Previous Decisions</b><p>{count ? `${count.toLocaleString()} total decisions available offline` : "Add reviewed CREATE, MERGE, SKIP, and DELETE decisions"}</p>{message && <small>{message}</small>}<code>Latest upload wins · matching older decisions are corrected · unrelated manual reviews remain</code></div><input ref={input} type="file" accept=".csv,text/csv" hidden onChange={(e) => accept(e.target.files?.[0])} /><button className={count ? "secondary" : "primary"} onClick={() => input.current?.click()}>{loading ? "Validating…" : count ? "Replace decisions CSV" : "Add decisions"}</button>{error && <div className="reference-error"><CircleHelp size={14} />{error}</div>}</div>;
}

function SettingsView({ data, onClear, onUpdateSettings, onSetReference, onAddDecisions }: { data: AppData; onClear: () => void; onUpdateSettings: (settings: Partial<ValidationSettings>) => void; onSetReference: (source: "ACA" | "FPA" | "ROOT", brands: CatalogBrand[]) => void; onAddDecisions: (decisions: AppData["learned"]) => void }) {
  const [confirm, setConfirm] = useState(false); const s = data.validationSettings;
  return <><PageHead eyebrow="OFFLINE DATA & VALIDATION" title="Reference tables" body="Load the catalog sources that make matching accurate. Files stay on this Mac and remain available offline." />
    <div className="module-layout"><div className="settings-content">
      <section className="reference-section"><div className="section-title"><div><h2>Brand data sources</h2><p>Previous decisions resolve known work first. The existing brand table is authoritative. ACA and FPA add recognition and aliases.</p></div><span className="offline-chip"><CloudOff size={13} />Stored offline</span></div><div className="reference-list"><DecisionUploader count={Object.keys(data.learned).length} onLoad={onAddDecisions} /><ReferenceUploader source="ROOT" count={data.rootBrands.length} onLoad={(brands) => onSetReference("ROOT", brands)} /><ReferenceUploader source="ACA" count={data.acaBrands.length} onLoad={(brands) => onSetReference("ACA", brands)} /><ReferenceUploader source="FPA" count={data.fpaBrands.length} onLoad={(brands) => onSetReference("FPA", brands)} /></div>{data.rootBrands.length > 0 && <div className="tables-ready"><Check size={16} /><div><b>Authoritative existing-brand validation is ready</b><p>{data.rootBrands.length.toLocaleString()} active existing brands, {Object.keys(data.learned).length.toLocaleString()} previous decisions, {data.acaBrands.length.toLocaleString()} ACA brands, and {data.fpaBrands.length.toLocaleString()} FPA brands are available to new imports.</p></div></div>}</section>
      <section><div className="section-title"><div><h2>Offline modules</h2><p>Fast, private, and available without an internet connection.</p></div><span className="offline-chip"><CloudOff size={13} />Always available</span></div>
        <div className="module-list"><ModuleToggle label="Normalize brands" body="Clean OEM wording, separators, punctuation, and whitespace." enabled locked /><ModuleToggle label="Previous decisions" body="Use prior reviews and manual overrides as final decisions." enabled={s.previousDecisions} onChange={() => onUpdateSettings({ previousDecisions: !s.previousDecisions })} /><ModuleToggle label="Alias table" body="Resolve aliases from the existing and FPA brand tables." enabled={s.aliasTable} onChange={() => onUpdateSettings({ aliasTable: !s.aliasTable })} /><ModuleToggle label="Existing brand table" body={`Authoritative exact and fuzzy matching against ${data.rootBrands.length.toLocaleString()} ACTIVE brands.`} enabled={s.rootBrandTable} onChange={() => onUpdateSettings({ rootBrandTable: !s.rootBrandTable })} /><ModuleToggle label="ACA brand table" body={`Exact and fuzzy recognition against ${data.acaBrands.length.toLocaleString()} locally loaded brands.`} enabled={s.acaTable} onChange={() => onUpdateSettings({ acaTable: !s.acaTable })} /><ModuleToggle label="FPA brand table" body={`Fallback matching against ${(SEED_BRANDS.length + data.fpaBrands.length).toLocaleString()} available brands.`} enabled={s.fpaTable} onChange={() => onUpdateSettings({ fpaTable: !s.fpaTable })} /><ModuleToggle label="Offline brand rules" body="Detect placeholders, OEM language, retailers, and generic text." enabled={s.offlineRules} onChange={() => onUpdateSettings({ offlineRules: !s.offlineRules })} /></div>
      </section>
      <section><div className="section-title"><div><h2>Online integrations</h2><p>No online connector is installed. These modules do not run and never appear in validation progress.</p></div><span className="connection-chip"><CloudOff size={13} />Not connected</span></div>
        <div className="module-list"><ModuleToggle label="Official website search" body="Unavailable until a real search connector is installed and tested." enabled={false} online unavailable /><ModuleToggle label="Marketplace search" body="eBay, Amazon, Walmart, RockAuto, RevZilla, and CMSNL are not connected." enabled={false} online unavailable /><ModuleToggle label="Google search" body="No Google or other search-provider API is connected." enabled={false} online unavailable /><ModuleToggle label="AI validator" body="No OpenAI request is made. Use Manual AI Assist in review if desired." enabled={false} online unavailable /></div>
        <div className="info-banner"><ShieldCheck size={17} /><span>Brandmaster currently performs offline validation only. It will not request or store an API key for unavailable integrations.</span></div>
      </section>
      <section><h2>Workspace data</h2><p>{data.batches.length} imports, {data.ledger.length} reviewed decisions, and {(data.rootBrands.length + data.acaBrands.length + data.fpaBrands.length).toLocaleString()} reference brands are stored locally.</p><div className="danger-row"><div><b>Clear local workspace</b><p>Remove imports, references, settings, ledger entries, and learned decisions.</p></div>{confirm ? <div className="confirm-actions"><button className="secondary" onClick={() => setConfirm(false)}>Cancel</button><button className="danger" onClick={() => { onClear(); setConfirm(false); }}><Trash2 size={15} />Clear everything</button></div> : <button className="danger-outline" onClick={() => setConfirm(true)}>Clear data</button>}</div></section>
    </div><aside className="engine-order"><span>EXECUTION ORDER</span><ol><li className="required">Normalize</li>{s.previousDecisions && <li>Previous decisions</li>}{s.aliasTable && <li>Alias table</li>}{s.rootBrandTable && <li>Existing brand table</li>}{s.acaTable && <li>ACA brand table</li>}{s.fpaTable && <li>FPA brand table</li>}{s.offlineRules && <li>Offline rules</li>}</ol><p>The first decisive local match stops processing. Only modules shown in this list actually run.</p></aside></div>
  </>;
}
