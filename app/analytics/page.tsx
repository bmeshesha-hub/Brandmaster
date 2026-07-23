"use client";

import { Activity, ArrowLeft, BarChart3, CheckCircle2, Clock3, Gauge, RefreshCw, ShieldCheck, Target } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { PublicAnalyticsSnapshot } from "@/lib/public-analytics";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
const number = (value: number) => value.toLocaleString();

export default function PublicAnalyticsPage() {
  const [snapshot, setSnapshot] = useState<PublicAnalyticsSnapshot | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  async function load() {
    setLoading(true); setError("");
    try {
      const response = await fetch(`${basePath}/analytics-snapshot.json`, { cache: "no-store" });
      if (!response.ok) throw new Error("Snapshot unavailable");
      const next = await response.json() as PublicAnalyticsSnapshot;
      if (next.schemaVersion !== "brandmaster.public-analytics.v2") throw new Error("Snapshot needs regeneration");
      setSnapshot(next);
    } catch { setError("The published team snapshot is unavailable or needs a new successful Save & pull."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  const maxWeek = useMemo(() => Math.max(1, ...(snapshot?.weekly || []).map((week) => week.total)), [snapshot]);

  return <main className="public-analytics-page">
    <header className="public-analytics-header"><Link href="/" className="public-brand"><Image unoptimized src={`${basePath}/brandmaster-logo.jpeg`} width={46} height={46} alt="Brandmaster" /><span><b>brandmaster</b><small>TEAM PROGRESS</small></span></Link><div><span><ShieldCheck size={15} />Aggregate snapshot</span><button onClick={() => void load()} disabled={loading} title="Reload the latest published snapshot"><RefreshCw className={loading ? "spinning" : ""} size={15} />Reload snapshot</button></div></header>
    <div className="public-analytics-content">
      <section className="public-analytics-intro"><div><small>GROUP PERFORMANCE · NO MEMBER RANKING</small><h1>Team progress at a glance</h1><p>A read-only view of what the group has processed, completed, and verified. It contains no individual contribution totals and stays fixed until the next successful team sync.</p></div>{snapshot && <aside><Clock3 size={18} /><span><small>LAST SUCCESSFUL SYNC</small><b>{new Date(snapshot.workspaceUpdatedAt).toLocaleString()}</b></span></aside>}</section>
      {loading && !snapshot ? <div className="public-analytics-state"><RefreshCw className="spinning" /><h2>Loading the published team snapshot…</h2></div> : error ? <div className="public-analytics-state error"><BarChart3 /><h2>{error}</h2><button onClick={() => void load()}>Try again</button></div> : snapshot && <>
        <section className="public-kpis">
          <article><span><BarChart3 /></span><small>BRANDS PROCESSED</small><b>{number(snapshot.totals.processed)}</b><p>verified, deduplicated completion records</p></article>
          <article><span><Activity /></span><small>TEAM COMPLETED THIS WEEK</small><b>{number(snapshot.target.completed)} / {number(snapshot.target.weekly)}</b><p>{number(snapshot.totals.today)} today · {number(snapshot.target.remaining)} remaining</p></article>
          <article><span><Gauge /></span><small>BRAND CONFIDENCE</small><b>{snapshot.confidence.average}%</b><p>{snapshot.confidence.highPercent}% high confidence · {number(snapshot.confidence.evaluated)} evaluated</p></article>
          <article><span><CheckCircle2 /></span><small>CONFIRMED DELIVERY</small><b>{number(snapshot.delivery.confirmed)}</b><p>{number(snapshot.delivery.awaiting)} awaiting confirmation · {number(snapshot.delivery.failed)} failed</p></article>
        </section>

        <section className="public-panel public-target">
          <header><div><h2>Weekly team target</h2><p>One shared measure of completed group work</p></div><strong>{snapshot.target.progressPercent}%<small>{number(snapshot.target.completed)} of {number(snapshot.target.weekly)}</small></strong></header>
          <div className="public-target-progress"><i><em style={{ width: `${snapshot.target.progressPercent}%` }} /></i><b>{number(snapshot.target.remaining)} remaining</b></div>
          <div className="public-target-days">{snapshot.target.days.map((day) => <div key={day.label}><span>{day.label}</span><b>{number(day.completed)}</b><small>/ {number(day.target)}</small></div>)}</div>
        </section>

        <section className="public-analytics-grid"><article className="public-panel public-trend"><header><div><h2>Completed decisions over time</h2><p>Weekly group output in this published snapshot</p></div><strong>{number(snapshot.totals.decisions)}<small>recorded decisions</small></strong></header>{snapshot.weekly.length ? <div className="public-bars">{snapshot.weekly.map((week) => <div key={week.date}><span><i style={{ height: `${Math.max(week.total ? 6 : 1, week.total / maxWeek * 100)}%` }}><em>{week.total || ""}</em></i></span><b>{week.label}</b></div>)}</div> : <p className="public-empty">No published mapping activity yet.</p>}<footer><span className="create">CREATE <b>{number(snapshot.totals.create)}</b></span><span className="merge">MERGE <b>{number(snapshot.totals.merge)}</b></span><span className="skip">SKIP <b>{number(snapshot.totals.skip)}</b></span><span className="delete">DELETE <b>{number(snapshot.totals.delete)}</b></span></footer></article>
          <article className="public-panel public-queue"><header><div><h2>Current team queue</h2><p>Group workload without member attribution</p></div></header>{[["Available", snapshot.queue.available], ["Assigned", snapshot.queue.assigned], ["In review", snapshot.queue.inReview], ["Ready", snapshot.queue.ready], ["Blocked", snapshot.queue.blocked]].map(([label, value]) => <div key={String(label)}><span>{label}</span><i><em style={{ width: `${snapshot.queue.total ? Number(value) / snapshot.queue.total * 100 : 0}%` }} /></i><b>{number(Number(value))}</b></div>)}</article></section>

        <section className="public-analytics-grid lower"><article className="public-panel public-actions"><header><div><h2>What the team decided</h2><p>Aggregate action mix across saved work</p></div></header>{[["New brand", snapshot.totals.create, "create"], ["Alias / merge", snapshot.totals.merge, "merge"], ["Skipped", snapshot.totals.skip, "skip"], ["Deleted", snapshot.totals.delete, "delete"]].map(([label, value, kind]) => <div className={String(kind)} key={String(label)}><span>{label}</span><b>{number(Number(value))}</b></div>)}</article>
          <article className="public-panel public-confidence"><header><div><h2>Decision confidence</h2><p>Aggregate confidence of saved live brand decisions</p></div></header><div className="public-confidence-score"><Gauge size={28} /><span><b>{snapshot.confidence.average}%</b><small>average confidence</small></span></div><div className="public-confidence-bands"><span className="high"><b>{number(snapshot.confidence.high)}</b><small>High · 90–100</small></span><span className="medium"><b>{number(snapshot.confidence.medium)}</b><small>Medium · 70–89</small></span><span className="low"><b>{number(snapshot.confidence.low)}</b><small>Low · below 70</small></span></div></article>
        </section>
        <div className="public-privacy-note"><ShieldCheck size={19} /><span><b>Group effort only</b><p>This static snapshot publishes aggregate progress, confidence, workload, and action totals. Member names, rankings, brand records, IDs, reviewer notes, and source rows remain private.</p></span><Target size={22} /></div>
      </>}
      <Link className="public-back" href="/"><ArrowLeft size={15} />Open the private team workspace</Link>
    </div>
  </main>;
}
