"use client";

import { Activity, ArrowLeft, BarChart3, CheckCircle2, Clock3, RefreshCw, ShieldCheck, Users } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Snapshot = {
  schemaVersion: string;
  generatedAt: string;
  workspaceUpdatedAt: string;
  totals: { decisions: number; today: number; thisWeek: number; create: number; merge: number; skip: number; delete: number };
  queue: { total: number; available: number; assigned: number; inReview: number; blocked: number; ready: number; exported: number };
  delivery: { confirmed: number; failed: number; awaiting: number };
  contributors: { name: string; decisions: number }[];
  weekly: { date: string; label: string; total: number; CREATE: number; MERGE: number; SKIP: number; DELETE: number }[];
};

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
const number = (value: number) => value.toLocaleString();

export default function PublicAnalyticsPage() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  async function load() {
    setLoading(true); setError("");
    try {
      const response = await fetch(`${basePath}/analytics-snapshot.json`, { cache: "no-store" });
      if (!response.ok) throw new Error("Snapshot unavailable");
      setSnapshot(await response.json() as Snapshot);
    } catch { setError("The published progress snapshot is temporarily unavailable."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, []);
  const maxWeek = useMemo(() => Math.max(1, ...(snapshot?.weekly || []).map((week) => week.total)), [snapshot]);

  return <main className="public-analytics-page">
    <header className="public-analytics-header"><Link href="/" className="public-brand"><Image unoptimized src={`${basePath}/brandmaster-logo.jpeg`} width={46} height={46} alt="Brandmaster" /><span><b>brandmaster</b><small>PUBLIC PROGRESS</small></span></Link><div><span><ShieldCheck size={15} />Read-only analytics</span><button onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? "spinning" : ""} size={15} />Refresh snapshot</button></div></header>
    <div className="public-analytics-content">
      <section className="public-analytics-intro"><div><small>BRAND MAPPING PERFORMANCE</small><h1>Team progress at a glance</h1><p>A public, read-only summary of Brandmaster mapping effort. Private brand names, IDs, source tables, and reviewer notes are never published.</p></div>{snapshot && <aside><Clock3 size={18} /><span><small>DATA THROUGH</small><b>{new Date(snapshot.workspaceUpdatedAt).toLocaleString()}</b></span></aside>}</section>
      {loading && !snapshot ? <div className="public-analytics-state"><RefreshCw className="spinning" /><h2>Loading published analytics…</h2></div> : error ? <div className="public-analytics-state error"><BarChart3 /><h2>{error}</h2><button onClick={() => void load()}>Try again</button></div> : snapshot && <>
        <section className="public-kpis"><article><span><BarChart3 /></span><small>TOTAL RECORDED</small><b>{number(snapshot.totals.decisions)}</b><p>mapping decisions</p></article><article><span><Activity /></span><small>THIS WEEK</small><b>{number(snapshot.totals.thisWeek)}</b><p>{number(snapshot.totals.today)} today</p></article><article><span><CheckCircle2 /></span><small>CONFIRMED DELIVERY</small><b>{number(snapshot.delivery.confirmed)}</b><p>{number(snapshot.delivery.awaiting)} awaiting confirmation</p></article><article><span><Users /></span><small>QUEUE PROGRESS</small><b>{number(snapshot.queue.exported)}</b><p>{number(snapshot.queue.available + snapshot.queue.assigned + snapshot.queue.inReview + snapshot.queue.blocked + snapshot.queue.ready)} active</p></article></section>
        <section className="public-analytics-grid"><article className="public-panel public-trend"><header><div><h2>Mapping actions over time</h2><p>Weekly saved decisions in the published snapshot</p></div><strong>{number(snapshot.totals.decisions)}<small>total</small></strong></header>{snapshot.weekly.length ? <div className="public-bars">{snapshot.weekly.map((week) => <div key={week.date}><span><i style={{ height: `${Math.max(week.total ? 6 : 1, week.total / maxWeek * 100)}%` }}><em>{week.total || ""}</em></i></span><b>{week.label}</b></div>)}</div> : <p className="public-empty">No published mapping activity yet.</p>}<footer><span className="create">CREATE <b>{number(snapshot.totals.create)}</b></span><span className="merge">MERGE <b>{number(snapshot.totals.merge)}</b></span><span className="skip">SKIP <b>{number(snapshot.totals.skip)}</b></span><span className="delete">DELETE <b>{number(snapshot.totals.delete)}</b></span></footer></article>
          <article className="public-panel public-queue"><header><div><h2>Current team queue</h2><p>Aggregated work status only</p></div></header>{[["Available", snapshot.queue.available], ["Assigned", snapshot.queue.assigned], ["In review", snapshot.queue.inReview], ["Ready", snapshot.queue.ready], ["Blocked", snapshot.queue.blocked]].map(([label, value]) => <div key={String(label)}><span>{label}</span><i><em style={{ width: `${snapshot.queue.total ? Number(value) / snapshot.queue.total * 100 : 0}%` }} /></i><b>{number(Number(value))}</b></div>)}</article></section>
        <section className="public-analytics-grid lower"><article className="public-panel public-actions"><header><div><h2>Action mix</h2><p>How recorded decisions were resolved</p></div></header>{[["New brand", snapshot.totals.create, "create"], ["Alias / merge", snapshot.totals.merge, "merge"], ["Skipped", snapshot.totals.skip, "skip"], ["Deleted", snapshot.totals.delete, "delete"]].map(([label, value, kind]) => <div className={String(kind)} key={String(label)}><span>{label}</span><b>{number(Number(value))}</b></div>)}</article><article className="public-panel public-contributors"><header><div><h2>Team contribution</h2><p>Saved review decisions by contributor</p></div></header>{snapshot.contributors.length ? snapshot.contributors.map((person) => <div key={person.name}><span>{person.name.slice(0, 2).toUpperCase()}</span><p><b>{person.name}</b><i><em style={{ width: `${person.decisions / snapshot.contributors[0].decisions * 100}%` }} /></i></p><strong>{number(person.decisions)}</strong></div>) : <p className="public-empty">No contributor totals published yet.</p>}</article></section>
        <div className="public-privacy-note"><ShieldCheck size={19} /><span><b>Safe public snapshot</b><p>This page contains aggregate counts only. Editing, synchronization, detailed decisions, brand records, and source tables remain in the private team workspace.</p></span></div>
      </>}
      <Link className="public-back" href="/"><ArrowLeft size={15} />Open the private team workspace</Link>
    </div>
  </main>;
}
