import { Action, AppData, BrandRecord, CatalogBrand, HistoricalMappingEntry, LedgerEntry } from "./types";

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
export function analyticsDate(value: string) {
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

/**
 * Returns reviewer decisions saved after a published analytics checkpoint.
 * This is intentionally bounded by the checkpoint so hosted pages can show
 * unsynced local work without rebuilding or double-counting the full ledger.
 */
export function mappingActivityAfter(
  entries: MappingActivityEntry[],
  checkpoint: string,
  now = new Date(),
) {
  const checkpointTime = new Date(checkpoint).getTime();
  const nowTime = now.getTime();
  if (Number.isNaN(checkpointTime)) return [];
  return entries.filter((entry) => {
    const time = analyticsDate(entry.date).getTime();
    return !Number.isNaN(time) && time > checkpointTime && time <= nowTime;
  });
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
  teamActivity: Array<{ at: string; type?: string; count?: number; batchId?: string; by?: string; message?: string }> = [],
  progressSnapshots: AppData["teamProgressSnapshots"] = [],
  reviewedBatchRecords: BrandRecord[] = [],
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
  const activity = [...byCompletion.values(), ...ledgerCompletions];
  // Immutable reviewer checkpoints preserve completed effort if a damaged or
  // stale workspace copy later omits its individual ledger rows. Use them as
  // a per-day, per-reviewer floor so existing ledger entries are never counted
  // twice and the missing rows retain their reviewer attribution.
  const actualByReviewerDay = new Map<string, number>();
  activity.forEach((entry) => {
    const date = bucketKey(startOfDay(analyticsDate(entry.date)));
    const reviewer = canonicalAnalyticsReviewer(entry.reviewer || "Unattributed");
    const key = `${date}\u0000${reviewer}`;
    actualByReviewerDay.set(key, (actualByReviewerDay.get(key) || 0) + 1);
  });
  const checkpointByReviewerDay = new Map<string, { date: string; reviewer: string; count: number }>();
  progressSnapshots.filter((snapshot) => snapshot.immutable && snapshot.source === "reviewer-decisions" && snapshot.delta > 0)
    .forEach((snapshot) => {
      const reviewer = canonicalAnalyticsReviewer(snapshot.reviewer || "Unattributed");
      // Use the event timestamp when available. The stored date was derived
      // from UTC in some older clients, while ledger dates are bucketed in the
      // viewer's local timezone; grouping both by the same event instant keeps
      // a checkpoint from duplicating its matching ledger rows near midnight.
      const date = snapshot.cutoffAt || snapshot.date;
      const parsedDate = analyticsDate(date);
      if (Number.isNaN(parsedDate.getTime())) return;
      const key = `${bucketKey(startOfDay(parsedDate))}\u0000${reviewer}`;
      const existing = checkpointByReviewerDay.get(key);
      if (existing) existing.count += snapshot.delta;
      else checkpointByReviewerDay.set(key, { date, reviewer, count: snapshot.delta });
    });
  const checkpointPlaceholders = new Map<string, MappingActivityEntry[]>();
  checkpointByReviewerDay.forEach((checkpoint, key) => {
    const missing = Math.max(0, checkpoint.count - (actualByReviewerDay.get(key) || 0));
    for (let index = 0; index < missing; index += 1) {
      const placeholder: MappingActivityEntry = { date: checkpoint.date, action: "SKIP", reviewer: checkpoint.reviewer };
      activity.push(placeholder);
      checkpointPlaceholders.set(key, [...(checkpointPlaceholders.get(key) || []), placeholder]);
    }
  });
  // Reviewed batch records are a durable per-brand source when an older or
  // compacted workspace is missing ledger rows/checkpoints. Replace generic
  // checkpoint placeholders with real batch actions where possible, then add
  // only the remaining per-day/reviewer/action shortfall.
  const baselineByReviewerDayAction = new Map<string, number>();
  [...byCompletion.values(), ...ledgerCompletions].forEach((entry) => {
    const date = analyticsDate(entry.date);
    if (Number.isNaN(date.getTime())) return;
    const reviewer = canonicalAnalyticsReviewer(entry.reviewer || "Unattributed");
    const key = `${bucketKey(startOfDay(date))}\u0000${reviewer}\u0000${entry.action}`;
    baselineByReviewerDayAction.set(key, (baselineByReviewerDayAction.get(key) || 0) + 1);
  });
  const batchRowsByReviewerDay = new Map<string, { reviewer: string; rows: Array<{ date: string; action: Action }> }>();
  reviewedBatchRecords
    .filter((record) => record.status === "reviewed" && ACTIONS.includes(record.action))
    .forEach((record) => {
      const date = record.reviewedAt || record.approvedAt;
      if (!date || Number.isNaN(analyticsDate(date).getTime())) return;
      const reviewer = canonicalAnalyticsReviewer(record.reviewer || record.secondReviewedBy || record.firstReviewedBy || record.approvedBy);
      const dayKey = `${bucketKey(startOfDay(analyticsDate(date)))}\u0000${reviewer}`;
      const existing = batchRowsByReviewerDay.get(dayKey);
      if (existing) existing.rows.push({ date, action: record.action });
      else batchRowsByReviewerDay.set(dayKey, { reviewer, rows: [{ date, action: record.action }] });
    });
  batchRowsByReviewerDay.forEach((batch, dayKey) => {
    const baselineByAction = new Map<Action, number>();
    const missingRows: Array<{ date: string; action: Action; reviewer: string }> = [];
    batch.rows.forEach((row) => {
      const actionKey = `${dayKey}\u0000${row.action}`;
      const alreadyRecorded = baselineByAction.get(row.action) || 0;
      const baselineCount = baselineByReviewerDayAction.get(actionKey) || 0;
      baselineByAction.set(row.action, alreadyRecorded + 1);
      if (alreadyRecorded >= baselineCount) missingRows.push({ date: row.date, action: row.action, reviewer: batch.reviewer });
    });
    const placeholders = checkpointPlaceholders.get(dayKey) || [];
    const replaced = new Set(placeholders.slice(0, Math.min(placeholders.length, missingRows.length)));
    if (replaced.size) {
      for (let index = activity.length - 1; index >= 0; index -= 1) {
        if (replaced.has(activity[index])) activity.splice(index, 1);
      }
    }
    activity.push(...missingRows);
  });
  // REVIEWED acknowledgements are a last fallback for compacted workspaces.
  // Reconcile per batch/day/reviewer; a global total placed on the newest
  // event date can shift hundreds of older decisions into the wrong week.
  const acknowledgementsByBatch = new Map<string, { date: string; reviewer: string; summary: number; rows: number }>();
  teamActivity
    .filter((entry) => entry.type === "REVIEWED" && Number.isFinite(entry.count) && Number(entry.count) > 0 && !Number.isNaN(analyticsDate(entry.at).getTime()))
    .forEach((entry) => {
      const reviewer = canonicalAnalyticsReviewer(entry.by || "Team review acknowledgement");
      const batchId = entry.batchId || `unbatched:${entry.at}:${reviewer}`;
      const key = `${bucketKey(startOfDay(analyticsDate(entry.at)))}\u0000${reviewer}\u0000${batchId}`;
      const existing = acknowledgementsByBatch.get(key);
      const acknowledgement = existing || { date: entry.at, reviewer, summary: 0, rows: 0 };
      if (/approved\s+\d+\s+decisions?/i.test(entry.message || "")) acknowledgement.summary = Math.max(acknowledgement.summary, Number(entry.count));
      else acknowledgement.rows += Number(entry.count);
      acknowledgementsByBatch.set(key, acknowledgement);
    });
  const acknowledgedByReviewerDay = new Map<string, { date: string; reviewer: string; count: number }>();
  acknowledgementsByBatch.forEach((acknowledgement, key) => {
    const reviewerDay = key.slice(0, key.lastIndexOf("\u0000"));
    const existing = acknowledgedByReviewerDay.get(reviewerDay);
    const count = Math.max(acknowledgement.summary, acknowledgement.rows);
    if (existing) existing.count += count;
    else acknowledgedByReviewerDay.set(reviewerDay, { date: acknowledgement.date, reviewer: acknowledgement.reviewer, count });
  });
  const actualByReviewerDayFinal = new Map<string, number>();
  activity.forEach((entry) => {
    const date = analyticsDate(entry.date);
    if (Number.isNaN(date.getTime())) return;
    const reviewer = canonicalAnalyticsReviewer(entry.reviewer || "Unattributed");
    const key = `${bucketKey(startOfDay(date))}\u0000${reviewer}`;
    actualByReviewerDayFinal.set(key, (actualByReviewerDayFinal.get(key) || 0) + 1);
  });
  acknowledgedByReviewerDay.forEach((acknowledgement, key) => {
    const missing = Math.max(0, acknowledgement.count - (actualByReviewerDayFinal.get(key) || 0));
    for (let index = 0; index < missing; index += 1) activity.push({ date: acknowledgement.date, action: "SKIP", reviewer: acknowledgement.reviewer });
  });
  return activity;
}

/** Build the cached Team Progress payload at an explicit checkpoint only. */
export function buildProtectedTeamProgressSnapshot(
  historicalMappings: HistoricalMappingEntry[],
  ledger: Array<MappingActivityEntry & { id?: string; ledgerId?: string }> = [],
  teamActivity: Array<{ at: string; type?: string; count?: number }> = [],
  now = new Date(),
  weeklyTarget = TEAM_WEEKLY_TARGET,
  progressSnapshots: AppData["teamProgressSnapshots"] = [],
  reviewedBatchRecords: BrandRecord[] = [],
): ProtectedTeamProgressSnapshot {
  const activity = buildProtectedTeamProgressActivity(historicalMappings, ledger, teamActivity, progressSnapshots, reviewedBatchRecords);
  return {
    activity,
    target: buildWeeklyTargetProgress(activity, now, weeklyTarget),
    updatedAt: now.toISOString(),
  };
}
