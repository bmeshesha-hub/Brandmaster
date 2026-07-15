import { Action, BrandRecord, LedgerEntry } from "./types";

export type MappingGranularity = "day" | "week";
export type MappingActivityEntry = Pick<LedgerEntry, "date" | "action" | "reviewer">;

export interface MappingBucket {
  key: string;
  label: string;
  start: Date;
  end: Date;
  counts: Record<Action, number>;
  total: number;
}

const ACTIONS: Action[] = ["CREATE", "MERGE", "SKIP", "DELETE"];

function startOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

export function startOfMappingWeek(value: Date) {
  const start = startOfDay(value);
  const day = start.getDay();
  start.setDate(start.getDate() - (day === 0 ? 6 : day - 1));
  return start;
}

function addDays(value: Date, days: number) {
  const next = new Date(value);
  next.setDate(next.getDate() + days);
  return next;
}

function bucketKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function emptyCounts(): Record<Action, number> {
  return { CREATE: 0, MERGE: 0, SKIP: 0, DELETE: 0 };
}

export function buildMappingActivitySeries(
  entries: MappingActivityEntry[],
  granularity: MappingGranularity,
  now = new Date(),
  requestedBuckets?: number,
): MappingBucket[] {
  const bucketCount = requestedBuckets || (granularity === "day" ? 14 : 12);
  const span = granularity === "day" ? 1 : 7;
  const anchor = granularity === "day" ? startOfDay(now) : startOfMappingWeek(now);
  const first = addDays(anchor, -(bucketCount - 1) * span);
  const buckets = Array.from({ length: bucketCount }, (_, index) => {
    const start = addDays(first, index * span);
    const end = addDays(start, span);
    const label = granularity === "day"
      ? start.toLocaleDateString(undefined, { month: "short", day: "numeric" })
      : start.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return { key: bucketKey(start), label, start, end, counts: emptyCounts(), total: 0 } satisfies MappingBucket;
  });
  const byKey = new Map(buckets.map((bucket) => [bucket.key, bucket]));
  entries.forEach((entry) => {
    const date = new Date(entry.date);
    if (Number.isNaN(date.getTime())) return;
    const entryStart = granularity === "day" ? startOfDay(date) : startOfMappingWeek(date);
    const bucket = byKey.get(bucketKey(entryStart));
    if (!bucket || date < bucket.start || date >= bucket.end) return;
    bucket.counts[entry.action] += 1;
    bucket.total += 1;
  });
  return buckets;
}

export function buildAvailableMappingSeries(
  entries: MappingActivityEntry[],
  granularity: MappingGranularity,
  rangeDays?: number,
  now = new Date(),
): MappingBucket[] {
  const dated = entries.map((entry) => ({ entry, date: new Date(entry.date) })).filter(({ date }) => !Number.isNaN(date.getTime()));
  if (!dated.length) return [];
  const throughToday = dated.filter(({ date }) => date < addDays(startOfDay(now), 1));
  const available = throughToday.length ? throughToday : dated;
  const latest = new Date(Math.max(...available.map(({ date }) => date.getTime())));
  const earliest = new Date(Math.min(...available.map(({ date }) => date.getTime())));
  const availableDays = Math.max(1, Math.round((startOfDay(latest).getTime() - startOfDay(earliest).getTime()) / 86_400_000) + 1);
  const visibleDays = rangeDays ? Math.min(rangeDays, availableDays) : availableDays;
  const cutoff = addDays(startOfDay(latest), -(visibleDays - 1));
  const visible = available.filter(({ date }) => date >= cutoff && date < addDays(startOfDay(latest), 1)).map(({ entry }) => entry);
  const bucketCount = granularity === "day"
    ? visibleDays
    : Math.round((startOfMappingWeek(latest).getTime() - startOfMappingWeek(cutoff).getTime()) / (7 * 86_400_000)) + 1;
  const buckets = buildMappingActivitySeries(visible, granularity, latest, bucketCount);
  const first = buckets.findIndex((bucket) => bucket.total > 0);
  const last = buckets.findLastIndex((bucket) => bucket.total > 0);
  return first < 0 ? [] : buckets.slice(first, last + 1);
}

function countBetween(entries: MappingActivityEntry[], start: Date, end: Date) {
  return entries.filter((entry) => {
    const date = new Date(entry.date);
    return !Number.isNaN(date.getTime()) && date >= start && date < end;
  }).length;
}

export function summarizeMappingActivity(entries: MappingActivityEntry[], records: BrandRecord[], now = new Date()) {
  const todayStart = startOfDay(now);
  const tomorrow = addDays(todayStart, 1);
  const thisWeekStart = startOfMappingWeek(now);
  const nextWeekStart = addDays(thisWeekStart, 7);
  const lastWeekStart = addDays(thisWeekStart, -7);
  const validEntries = entries.filter((entry) => !Number.isNaN(new Date(entry.date).getTime()));
  const reviewedRows = records.filter((record) => record.status === "reviewed").length;
  const uniqueActiveDays = new Set(validEntries.map((entry) => bucketKey(startOfDay(new Date(entry.date))))).size;
  const reviewers = new Map<string, number>();
  validEntries.forEach((entry) => reviewers.set(entry.reviewer?.trim() || "You", (reviewers.get(entry.reviewer?.trim() || "You") || 0) + 1));
  const reviewerEffort = [...reviewers.entries()].map(([reviewer, decisions]) => ({ reviewer, decisions })).sort((a, b) => b.decisions - a.decisions || a.reviewer.localeCompare(b.reviewer));
  return {
    totalEffort: validEntries.length,
    today: countBetween(validEntries, todayStart, tomorrow),
    thisWeek: countBetween(validEntries, thisWeekStart, nextWeekStart),
    lastWeek: countBetween(validEntries, lastWeekStart, thisWeekStart),
    reviewedRows,
    remainingRows: Math.max(0, records.length - reviewedRows),
    completionPercent: records.length ? Math.round(reviewedRows / records.length * 100) : 0,
    activeDays: uniqueActiveDays,
    averagePerActiveDay: uniqueActiveDays ? Math.round(validEntries.length / uniqueActiveDays) : 0,
    reviewerEffort,
  };
}

export function cumulativeMappingSeries(buckets: MappingBucket[]) {
  const running = emptyCounts();
  return buckets.map((bucket) => {
    ACTIONS.forEach((action) => { running[action] += bucket.counts[action]; });
    return { ...bucket, cumulative: { ...running }, cumulativeTotal: ACTIONS.reduce((sum, action) => sum + running[action], 0) };
  });
}
