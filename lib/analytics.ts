import { Action, BrandRecord, CatalogBrand, HistoricalMappingEntry, LedgerEntry } from "./types";

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

export interface ProtectedTeamProgressSnapshot {
  activity: MappingActivityEntry[];
  target: WeeklyTargetProgress;
  updatedAt: string;
}

const ACTIONS: Action[] = ["CREATE", "MERGE", "SKIP", "DELETE"];
export const TEAM_WEEKLY_TARGET = 700;

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

// CSV history commonly stores dates as YYYY-MM-DD. JavaScript interprets that
// form as UTC, which shifts activity to the previous local day in western
// time zones. Treat date-only values as local calendar dates.
function analyticsDate(value: string) {
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
  return dateOnly ? new Date(`${value.trim()}T00:00:00`) : new Date(value);
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
    const date = analyticsDate(entry.date);
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
  const dated = entries.map((entry) => ({ entry, date: analyticsDate(entry.date) })).filter(({ date }) => !Number.isNaN(date.getTime()));
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
    const date = analyticsDate(entry.date);
    return !Number.isNaN(date.getTime()) && date >= start && date < end;
  }).length;
}

export function summarizeMappingActivity(entries: MappingActivityEntry[], records: BrandRecord[], now = new Date()) {
  const todayStart = startOfDay(now);
  const tomorrow = addDays(todayStart, 1);
  const thisWeekStart = startOfMappingWeek(now);
  const nextWeekStart = addDays(thisWeekStart, 7);
  const lastWeekStart = addDays(thisWeekStart, -7);
  const validEntries = entries.filter((entry) => !Number.isNaN(analyticsDate(entry.date).getTime()));
  const reviewedRows = records.filter((record) => record.status === "reviewed").length;
  const uniqueActiveDays = new Set(validEntries.map((entry) => bucketKey(startOfDay(analyticsDate(entry.date))))).size;
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
  weeklyTarget = TEAM_WEEKLY_TARGET,
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

/** Root delivery evidence kept separate from reviewer effort. */
export function buildRootBulkMappingActivity(rootBrands: CatalogBrand[]): MappingActivityEntry[] {
  return rootBrands.flatMap((brand) => {
    if (!brand.bulkMappingAt) return [];
    const raw = brand.bulkMappingAt.trim();
    const date = /^\d{13}$/.test(raw) ? new Date(Number(raw)) : analyticsDate(raw);
    return Number.isNaN(date.getTime())
      ? []
      : [{ date: date.toISOString(), action: "MERGE" as const, reviewer: "Root table" }];
  });
}

/**
 * Protected Team Progress source.
 *
 * Only saved reviewer decisions are allowed here: imported review history and
 * the live review ledger. Queue state, UBQ/Root state, cleanup state, and Admin
 * reconciliation are intentionally not accepted as inputs. This keeps a
 * delivery change from changing the amount of work credited to the team.
 */
export function buildProtectedTeamProgressActivity(
  historicalMappings: HistoricalMappingEntry[],
  ledger: Array<MappingActivityEntry & { id?: string; ledgerId?: string }> = [],
): MappingActivityEntry[] {
  const byCompletion = new Map<string, MappingActivityEntry>();
  const ledgerCompletions: MappingActivityEntry[] = [];
  // UBQ/Manual FPA snapshots describe current queue presence. They must never
  // revoke effort that was already completed and recorded in team history.
  // Keep imported history, then add every live review-history decision.
  historicalMappings.filter((entry) => !Number.isNaN(analyticsDate(entry.date).getTime())).forEach((entry) => {
    const identity = entry.sourceBrandId || `name:${entry.normalized}`;
    const day = analyticsDate(entry.date).toLocaleDateString("en-CA");
    byCompletion.set(`${identity}:${day}`, { date: entry.date, action: entry.action, reviewer: canonicalAnalyticsReviewer(entry.reviewer || "Imported from manual task") });
  });
  ledger.filter((entry) => ACTIONS.includes(entry.action) && !Number.isNaN(analyticsDate(entry.date).getTime())).forEach((entry) => {
    // Review History is one row per ledger decision. Use ledgerId so repeated
    // decisions for the same source brand are not collapsed in Team Progress.
    ledgerCompletions.push({ date: entry.date, action: entry.action, reviewer: canonicalAnalyticsReviewer(entry.reviewer || "Unattributed") });
  });
  // Root/UBQ outcomes and Admin results intentionally do not contribute
  // reviewer effort. A 100-row review remains 100 rows of effort even when
  // only 90 rows later reach Root or succeed in Admin.
  return [...byCompletion.values(), ...ledgerCompletions];
}

/** Build the cached Team Progress payload at an explicit checkpoint only. */
export function buildProtectedTeamProgressSnapshot(
  historicalMappings: HistoricalMappingEntry[],
  ledger: Array<MappingActivityEntry & { id?: string; ledgerId?: string }> = [],
  now = new Date(),
  weeklyTarget = TEAM_WEEKLY_TARGET,
): ProtectedTeamProgressSnapshot {
  const activity = buildProtectedTeamProgressActivity(historicalMappings, ledger);
  return {
    activity,
    target: buildWeeklyTargetProgress(activity, now, weeklyTarget),
    updatedAt: now.toISOString(),
  };
}
