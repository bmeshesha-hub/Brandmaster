import assert from "node:assert/strict";
import test from "node:test";
import { buildAvailableMappingSeries, buildMappingActivitySeries, buildWeeklyTargetProgress, cumulativeMappingSeries, summarizeMappingActivity } from "../lib/analytics";
import { Action, BrandRecord } from "../lib/types";

const now = new Date(2026, 6, 14, 15, 0, 0);
const entry = (date: Date, action: Action, reviewer = "You") => ({ date: date.toISOString(), action, reviewer });
const record = (id: string, status: BrandRecord["status"]): BrandRecord => ({
  id,
  name: id,
  normalized: id,
  action: "CREATE",
  targetName: id,
  confidence: 90,
  reason: "test",
  evidence: [],
  status,
  decisionSource: "test",
});

test("groups reviewed effort into local daily and Monday-based weekly buckets", () => {
  const entries = [
    entry(new Date(2026, 6, 14, 9), "MERGE"),
    entry(new Date(2026, 6, 13, 12), "CREATE"),
    entry(new Date(2026, 6, 8, 12), "SKIP"),
  ];
  const days = buildMappingActivitySeries(entries, "day", now, 7);
  assert.equal(days.at(-1)?.total, 1);
  assert.equal(days.at(-1)?.counts.MERGE, 1);
  assert.equal(days.at(-2)?.counts.CREATE, 1);
  const weeks = buildMappingActivitySeries(entries, "week", now, 2);
  assert.equal(weeks.at(-1)?.total, 2);
  assert.equal(weeks.at(-2)?.counts.SKIP, 1);
  assert.equal(weeks.at(-1)?.start.getDay(), 1);
});

test("separates historical effort totals from current worklist completion", () => {
  const entries = [
    entry(new Date(2026, 6, 14, 9), "MERGE", "Alex"),
    entry(new Date(2026, 6, 14, 10), "MERGE", "Alex"),
    entry(new Date(2026, 6, 8, 12), "CREATE", "Sam"),
  ];
  const summary = summarizeMappingActivity(entries, [record("one", "reviewed"), record("two", "needs-review")], now);
  assert.equal(summary.totalEffort, 3);
  assert.equal(summary.today, 2);
  assert.equal(summary.thisWeek, 2);
  assert.equal(summary.lastWeek, 1);
  assert.equal(summary.reviewedRows, 1);
  assert.equal(summary.remainingRows, 1);
  assert.equal(summary.completionPercent, 50);
  assert.deepEqual(summary.reviewerEffort, [{ reviewer: "Alex", decisions: 2 }, { reviewer: "Sam", decisions: 1 }]);
});

test("builds cumulative action totals without changing raw bucket effort", () => {
  const entries = [entry(new Date(2026, 6, 13, 9), "CREATE"), entry(new Date(2026, 6, 14, 9), "MERGE")];
  const cumulative = cumulativeMappingSeries(buildMappingActivitySeries(entries, "day", now, 2));
  assert.equal(cumulative[0].total, 1);
  assert.equal(cumulative[1].total, 1);
  assert.equal(cumulative[1].cumulative.CREATE, 1);
  assert.equal(cumulative[1].cumulative.MERGE, 1);
  assert.equal(cumulative[1].cumulativeTotal, 2);
});

test("trims chart ranges to dates that contain available mapping activity", () => {
  const entries = [
    { date: "2026-04-10T12:00:00.000Z", action: "CREATE" as const, reviewer: "A" },
    { date: "2026-04-20T12:00:00.000Z", action: "MERGE" as const, reviewer: "A" },
  ];
  const month = buildAvailableMappingSeries(entries, "day", 30, new Date(2026, 3, 30));
  assert.equal(month[0].key, "2026-04-10");
  assert.equal(month.at(-1)?.key, "2026-04-20");
  assert.equal(month.length, 11);
  const week = buildAvailableMappingSeries(entries, "day", 7, new Date(2026, 3, 30));
  assert.equal(week.length, 1);
  assert.equal(week[0].key, "2026-04-20");
});

test("tracks a 600-brand Monday-Friday target at 120 brands per day", () => {
  const entries = [
    ...Array.from({ length: 120 }, () => entry(new Date(2026, 6, 13, 10), "CREATE")),
    ...Array.from({ length: 80 }, () => entry(new Date(2026, 6, 14, 10), "MERGE")),
    entry(new Date(2026, 6, 12, 10), "SKIP"),
    entry(new Date(2026, 6, 18, 10), "DELETE"),
  ];
  const progress = buildWeeklyTargetProgress(entries, now);
  assert.equal(progress.weekStart.getDay(), 1);
  assert.equal(progress.days.length, 5);
  assert.equal(progress.dailyTarget, 120);
  assert.deepEqual(progress.days.map((day) => day.completed), [120, 80, 0, 0, 0]);
  assert.equal(progress.completed, 200);
  assert.equal(progress.remaining, 400);
  assert.equal(progress.progressPercent, 33);
  assert.equal(progress.days[1].isToday, true);
});
