import { Action, AdminUpdateRun, BrandRecord, HistoricalMappingEntry, LedgerEntry, ManualFpaIdReference } from "./types";

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

export interface WeeklyTargetProgress {
  weekStart: Date;
  weekEnd: Date;
  weeklyTarget: number;
  dailyTarget: number;
  completed: number;
  remaining: number;
  progressPercent: number;
  days: Array<{
    key: string;
    label: string;
    date: Date;
    completed: number;
    target: number;
    progressPercent: number;
    isToday: boolean;
    isFuture: boolean;
  }>;
}

const ACTIONS: Action[] = ["CREATE", "MERGE", "SKIP", "DELETE"];

export function canonicalAnalyticsReviewer(value?: string) {
  const reviewer = value?.trim() || "Unattributed";
  return /^@?bmeshesha(?:\s*·.*)?$/i.test(reviewer) ? "Bef" : reviewer;
}

export function completionActivityForReviewer(entries: MappingActivityEntry[], reviewer: string) {
  const identity = canonicalAnalyticsReviewer(reviewer);
  return entries.filter((entry) => canonicalAnalyticsReviewer(entry.reviewer) === identity);
}

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
  validEntries.forEach((entry) => {
    const reviewer = canonicalAnalyticsReviewer(entry.reviewer || "You");
    reviewers.set(reviewer, (reviewers.get(reviewer) || 0) + 1);
  });
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

export function buildWeeklyTargetProgress(
  entries: MappingActivityEntry[],
  now = new Date(),
  weeklyTarget = 600,
  workdays = 5,
): WeeklyTargetProgress {
  const weekStart = startOfMappingWeek(now);
  const weekEnd = addDays(weekStart, workdays);
  const dailyTarget = weeklyTarget / workdays;
  const today = startOfDay(now);
  const days = Array.from({ length: workdays }, (_, index) => {
    const date = addDays(weekStart, index);
    const next = addDays(date, 1);
    const completed = countBetween(entries, date, next);
    return {
      key: bucketKey(date),
      label: date.toLocaleDateString(undefined, { weekday: "short" }),
      date,
      completed,
      target: dailyTarget,
      progressPercent: Math.min(100, Math.round(completed / dailyTarget * 100)),
      isToday: date.getTime() === today.getTime(),
      isFuture: date > today,
    };
  });
  const completed = days.reduce((sum, day) => sum + day.completed, 0);
  return {
    weekStart,
    weekEnd,
    weeklyTarget,
    dailyTarget,
    completed,
    remaining: Math.max(0, weeklyTarget - completed),
    progressPercent: Math.min(100, Math.round(completed / weeklyTarget * 100)),
    days,
  };
}

/** Counts completed manual tasks and submitted UBQ Admin work once per brand/day. */
export function buildWeeklyCompletionActivity(
  historicalMappings: HistoricalMappingEntry[],
  manualFpaIds: ManualFpaIdReference[],
  adminUpdateRuns: AdminUpdateRun[],
): MappingActivityEntry[] {
  const byCompletion = new Map<string, MappingActivityEntry>();
  const latestNotDoneById = new Map(manualFpaIds.filter((entry) => entry.ubq === true).map((entry) => [entry.sourceBrandId, entry.importedAt]));
  historicalMappings.filter((entry) => entry.ubq !== true && (!entry.sourceBrandId || !latestNotDoneById.has(entry.sourceBrandId) || entry.date > latestNotDoneById.get(entry.sourceBrandId)!)).forEach((entry) => {
    const identity = entry.sourceBrandId || `name:${entry.normalized}`;
    const day = new Date(entry.date).toLocaleDateString("en-CA");
    byCompletion.set(`${identity}:${day}`, { date: entry.date, action: entry.action, reviewer: canonicalAnalyticsReviewer(entry.reviewer || "Imported from manual task") });
  });
  adminUpdateRuns.filter((run) => run.source === "UBQ").forEach((run) => run.items.filter((item) => !["NOT_APPLIED", "CONFLICT", "CANNOT_VERIFY"].includes(item.status)).forEach((item) => {
    const day = new Date(run.exportedAt).toLocaleDateString("en-CA");
    const key = `${item.sourceId}:${day}`;
    if (!byCompletion.has(key)) byCompletion.set(key, { date: run.exportedAt, action: item.action, reviewer: canonicalAnalyticsReviewer(run.exportedBy) });
  }));
  return [...byCompletion.values()];
}
