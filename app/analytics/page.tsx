"use client";

import { Activity, ArrowLeft, BarChart3, CheckCircle2, Clock3, Gauge, RefreshCw, ShieldCheck, Target } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { startOfMappingWeek } from "@/lib/analytics";
import type { PublicAnalyticsSnapshot } from "@/lib/public-analytics";

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
const number = (value: number) => value.toLocaleString();
const STALE_AFTER_MS = 15 * 60 * 1000;
type PublicWeek = PublicAnalyticsSnapshot["weekly"][number];
type MappingAction = "CREATE" | "SKIP" | "MERGE" | "DELETE";

const mappingLayers: Array<{ action: MappingAction; label: string; color: string; fill: string }> = [
  { action: "CREATE", label: "New brand", color: "#3665f3", fill: "#dce7ff" },
  { action: "SKIP", label: "Skipped", color: "#f18c32", fill: "#ffead7" },
  { action: "MERGE", label: "Alias / merge", color: "#9768df", fill: "#eadfff" },
  { action: "DELETE", label: "Deleted", color: "#d94f5c", fill: "#f9dce0" },
];

function MappingActionsChart({ weeks }: { weeks: PublicWeek[] }) {
  const width = 920;
  const height = 310;
  const left = 58;
  const right = 18;
  const top = 20;
  const bottom = 42;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const running: Record<MappingAction, number> = { CREATE: 0, SKIP: 0, MERGE: 0, DELETE: 0 };
  const points = weeks.map((week) => {
    mappingLayers.forEach(({ action }) => { running[action] += week[action]; });
    return { ...week, cumulative: { ...running } };
  });
  const totalAt = (point: (typeof points)[number], layerIndex: number) =>
    mappingLayers.slice(0, layerIndex + 1).reduce((sum, layer) => sum + point.cumulative[layer.action], 0);
  const max = Math.max(1, ...points.map((point) => totalAt(point, mappingLayers.length - 1)));
  const xAt = (index: number) => left + (points.length > 1 ? index / (points.length - 1) : 0.5) * plotWidth;
  const yAt = (value: number) => top + plotHeight - value / max * plotHeight;
  const linePath = (layerIndex: number) => points.map((point, index) =>
    `${index ? "L" : "M"}${xAt(index).toFixed(1)},${yAt(totalAt(point, layerIndex)).toFixed(1)}`).join(" ");
  const areaPath = (layerIndex: number) => {
    if (!points.length) return "";
    const upper = points.map((point, index) =>
      `${index ? "L" : "M"}${xAt(index).toFixed(1)},${yAt(totalAt(point, layerIndex)).toFixed(1)}`).join(" ");
    const lower = [...points].reverse().map((point, reverseIndex) => {
      const index = points.length - reverseIndex - 1;
      const value = layerIndex ? totalAt(point, layerIndex - 1) : 0;
      return `L${xAt(index).toFixed(1)},${yAt(value).toFixed(1)}`;
    }).join(" ");
    return `${upper} ${lower} Z`;
  };

  if (!points.length) return <p className="public-empty">No published mapping activity yet.</p>;

  return <div className="public-mapping-plot">
    <div className="public-mapping-legend">{mappingLayers.map((layer) =>
      <span key={layer.action}><i style={{ background: layer.color }} />{layer.label}</span>)}</div>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Cumulative brand mapping actions over the last twelve available weeks">
      {[0, .25, .5, .75, 1].map((ratio) => {
        const y = yAt(max * ratio);
        return <g key={ratio}><line x1={left} x2={width - right} y1={y} y2={y} /><text x={left - 10} y={y + 4}>{number(Math.round(max * ratio))}</text></g>;
      })}
      {mappingLayers.map((layer, layerIndex) => <g key={layer.action}>
        <path className="area" d={areaPath(layerIndex)} fill={layer.fill} />
        <path className="line" d={linePath(layerIndex)} stroke={layer.color} />
        {points.map((point, index) => <circle key={point.date} cx={xAt(index)} cy={yAt(totalAt(point, layerIndex))} r="3" fill={layer.color}>
          <title>{`${point.label}: ${layer.label} ${number(point.cumulative[layer.action])}`}</title>
        </circle>)}
      </g>)}
      {points.map((point, index) => <text className="x-label" key={point.date} x={xAt(index)} y={height - 12}>{point.label}</text>)}
    </svg>
  </div>;
}

export default function PublicAnalyticsPage() {
  const [snapshot, setSnapshot] = useState<PublicAnalyticsSnapshot | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [lastCheckedAt, setLastCheckedAt] = useState<Date | null>(null);
  const [clockNow, setClockNow] = useState(Date.now());
  async function load() {
    setLoading(true); setError("");
    try {
      // The release timestamp bypasses an older cache-first service worker that
      // may still control an already-open Pages tab.
      const response = await fetch(`${basePath}/analytics-snapshot.json?release=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Snapshot unavailable");
      const next = await response.json() as PublicAnalyticsSnapshot;
      if (next.schemaVersion !== "brandmaster.public-analytics.v2") throw new Error("Snapshot needs regeneration");
      setSnapshot(next);
    } catch { setError("The published team snapshot is unavailable or needs a new successful Save & pull."); }
    finally {
      const checkedAt = new Date();
      setLastCheckedAt(checkedAt);
      setClockNow(checkedAt.getTime());
      setLoading(false);
    }
  }
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const snapshotDate = snapshot ? new Date(snapshot.workspaceUpdatedAt) : null;
  const snapshotAgeMs = snapshotDate ? Math.max(0, clockNow - snapshotDate.getTime()) : 0;
  const snapshotStale = Boolean(snapshotDate && snapshotAgeMs > STALE_AFTER_MS);
  const snapshotWeekIsCurrent = Boolean(snapshotDate && startOfMappingWeek(snapshotDate).getTime() === startOfMappingWeek(new Date(clockNow)).getTime());
  const snapshotWeekLabel = snapshotDate ? startOfMappingWeek(snapshotDate).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
  const freshnessLabel = snapshotAgeMs < 60_000 ? "less than a minute old"
    : snapshotAgeMs < 3_600_000 ? `${Math.floor(snapshotAgeMs / 60_000)} minutes old`
    : snapshotAgeMs < 86_400_000 ? `${Math.floor(snapshotAgeMs / 3_600_000)} hours old`
    : `${Math.floor(snapshotAgeMs / 86_400_000)} days old`;

  return <main className="public-analytics-page">
    <header className="public-analytics-header"><Link href="/" className="public-brand"><Image unoptimized src={`${basePath}/brandmaster-logo.jpeg`} width={46} height={46} alt="Brandmaster" /><span><b>brandmaster</b><small>TEAM PROGRESS</small></span></Link><div><span><ShieldCheck size={15} />Aggregate snapshot</span></div></header>
    <div className="public-analytics-content">
      <section className="public-analytics-intro"><div><small>GROUP PERFORMANCE · NO MEMBER RANKING</small><h1>Team progress at a glance</h1><p>A read-only view of what the group has processed, completed, and verified. It contains no individual contribution totals and stays fixed until the next successful team sync.</p></div>{snapshot && <aside className={snapshotStale ? "stale" : "fresh"}><Clock3 size={18} /><span><small>{snapshotStale ? "STALE TEAM SNAPSHOT" : "TEAM SNAPSHOT CURRENT"}</small><b>Data synced {snapshotDate?.toLocaleString()}</b><em>{freshnessLabel}{lastCheckedAt ? ` · checked ${lastCheckedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}</em></span><button onClick={() => void load()} disabled={loading} title="Check for the latest snapshot published by Save & pull"><RefreshCw className={loading ? "spinning" : ""} size={15} />{loading ? "Checking…" : "Refresh"}</button></aside>}</section>
      {loading && !snapshot ? <div className="public-analytics-state"><RefreshCw className="spinning" /><h2>Loading the published team snapshot…</h2></div> : error && !snapshot ? <div className="public-analytics-state error"><BarChart3 /><h2>{error}</h2><button onClick={() => void load()}>Try again</button></div> : snapshot && <>
        {(snapshotStale || error) && <section className={`public-snapshot-warning ${error ? "error" : ""}`}><Clock3 size={20} /><div><b>{error ? "The latest snapshot could not be checked" : `Published data is ${freshnessLabel}`}</b><p>{snapshotWeekIsCurrent ? "Values may be behind the private team workspace." : `The totals below describe the week of ${snapshotWeekLabel}, not the current week.`} Save &amp; pull from the private workspace publishes current team data; Refresh then checks that published snapshot.</p></div><button onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? "spinning" : ""} size={15} />Check again</button></section>}
        <section className="public-kpis">
          <article><span><BarChart3 /></span><small>BRANDS PROCESSED</small><b>{number(snapshot.totals.processed)}</b><p>verified, deduplicated completion records</p></article>
          <article><span><Activity /></span><small>TEAM COMPLETED · {snapshotWeekIsCurrent ? "THIS WEEK" : `WEEK OF ${snapshotWeekLabel.toUpperCase()}`}</small><b>{number(snapshot.target.completed)} / {number(snapshot.target.weekly)}</b><p>{snapshotWeekIsCurrent ? `${number(snapshot.totals.today)} today · ${number(snapshot.target.remaining)} remaining` : `Snapshot period · ${number(snapshot.target.remaining)} short of target`}</p></article>
          <article><span><Gauge /></span><small>BRAND CONFIDENCE</small><b>{snapshot.confidence.average}%</b><p>{snapshot.confidence.highPercent}% high confidence · {number(snapshot.confidence.evaluated)} evaluated</p></article>
          <article><span><CheckCircle2 /></span><small>CONFIRMED DELIVERY</small><b>{number(snapshot.delivery.confirmed)}</b><p>{number(snapshot.delivery.awaiting)} awaiting confirmation · {number(snapshot.delivery.failed)} failed</p></article>
        </section>

        <section className="public-panel public-target">
          <header><div><h2>Weekly team target{snapshotWeekIsCurrent ? "" : ` · week of ${snapshotWeekLabel}`}</h2><p>{snapshotWeekIsCurrent ? "One shared measure of completed group work" : "Historical snapshot period—not the current team week"}</p></div><strong>{snapshot.target.progressPercent}%<small>{number(snapshot.target.completed)} of {number(snapshot.target.weekly)}</small></strong></header>
          <div className="public-target-progress"><i><em style={{ width: `${snapshot.target.progressPercent}%` }} /></i><b>{number(snapshot.target.remaining)} remaining</b></div>
          <div className="public-target-days">{snapshot.target.days.map((day) => <div key={day.label}><span>{day.label}</span><b>{number(day.completed)}</b><small>/ {number(day.target)}</small></div>)}</div>
        </section>

        <section className="public-panel public-mapping-chart">
          <header><div><h2>Brand mapping actions over time</h2><p>Cumulative group mapping activity across the last 12 available weeks</p></div></header>
          <div className="public-mapping-chart-body">
            <MappingActionsChart weeks={snapshot.weekly} />
            <aside className="public-mapping-stats">
              <article><small>TOTAL MAPPED</small><b>{number(snapshot.totals.decisions)}</b></article>
              <article><small>{snapshotWeekIsCurrent ? "LAST WEEK" : "PRIOR SNAPSHOT WEEK"}</small><b>{number(snapshot.totals.mappedLastWeek ?? snapshot.weekly.at(-2)?.total ?? 0)}</b></article>
              <article><small>{snapshotWeekIsCurrent ? "THIS WEEK" : `WEEK OF ${snapshotWeekLabel.toUpperCase()}`}</small><b>{number(snapshot.totals.mappedThisWeek ?? snapshot.weekly.at(-1)?.total ?? 0)}</b></article>
              <article><small>{snapshotWeekIsCurrent ? "MAPPED TODAY" : "LAST SNAPSHOT DAY"}</small><b>{number(snapshot.totals.mappedToday ?? snapshot.totals.today)}</b></article>
            </aside>
          </div>
        </section>

        <section className="public-analytics-grid public-summary-grid"><article className="public-panel public-queue"><header><div><h2>Current team queue</h2><p>Group workload without member attribution</p></div></header>{[["Available", snapshot.queue.available], ["Assigned", snapshot.queue.assigned], ["In review", snapshot.queue.inReview], ["Ready", snapshot.queue.ready], ["Blocked", snapshot.queue.blocked]].map(([label, value]) => <div key={String(label)}><span>{label}</span><i><em style={{ width: `${snapshot.queue.total ? Number(value) / snapshot.queue.total * 100 : 0}%` }} /></i><b>{number(Number(value))}</b></div>)}</article>
          <article className="public-panel public-actions"><header><div><h2>What the team mapped</h2><p>Aggregate action mix across saved work</p></div></header>{[["New brand", snapshot.totals.create, "create"], ["Alias / merge", snapshot.totals.merge, "merge"], ["Skipped", snapshot.totals.skip, "skip"], ["Deleted", snapshot.totals.delete, "delete"]].map(([label, value, kind]) => <div className={String(kind)} key={String(label)}><span>{label}</span><b>{number(Number(value))}</b></div>)}</article>
          <article className="public-panel public-confidence"><header><div><h2>Decision confidence</h2><p>Aggregate confidence of saved live brand decisions</p></div></header><div className="public-confidence-score"><Gauge size={28} /><span><b>{snapshot.confidence.average}%</b><small>average confidence</small></span></div><div className="public-confidence-bands"><span className="high"><b>{number(snapshot.confidence.high)}</b><small>High · 90–100</small></span><span className="medium"><b>{number(snapshot.confidence.medium)}</b><small>Medium · 70–89</small></span><span className="low"><b>{number(snapshot.confidence.low)}</b><small>Low · below 70</small></span></div></article>
        </section>
        <div className="public-privacy-note"><ShieldCheck size={19} /><span><b>Group effort only</b><p>This static snapshot publishes aggregate progress, confidence, workload, and action totals. Member names, rankings, brand records, IDs, reviewer notes, and source rows remain private.</p></span><Target size={22} /></div>
      </>}
      <Link className="public-back" href="/"><ArrowLeft size={15} />Open the private team workspace</Link>
    </div>
  </main>;
}
