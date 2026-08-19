import assert from "node:assert/strict";
import test from "node:test";
import { buildAvailableMappingSeries, buildMappingActivitySeries, buildRootBulkMappingActivity, buildWeeklyCompletionActivity, buildWeeklyTargetProgress, canonicalAnalyticsReviewer, completionActivityForReviewer, cumulativeMappingSeries, summarizeMappingActivity } from "../lib/analytics";
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

test("combines the repository username bmeshesha with the Bef analytics identity", () => {
  assert.equal(canonicalAnalyticsReviewer("bmeshesha"), "Bef");
  assert.equal(canonicalAnalyticsReviewer("@BMESHESHA"), "Bef");
  const summary = summarizeMappingActivity([
    entry(new Date(2026, 6, 14, 9), "CREATE", "Bef"),
    entry(new Date(2026, 6, 14, 10), "MERGE", "bmeshesha"),
  ], [], now);
  assert.deepEqual(summary.reviewerEffort, [{ reviewer: "Bef", decisions: 2 }]);
});

test("separates one reviewer's weekly completion from the team total", () => {
  const team = [
    entry(new Date(2026, 6, 14, 9), "CREATE", "Bef"),
    entry(new Date(2026, 6, 14, 10), "MERGE", "bmeshesha"),
    entry(new Date(2026, 6, 14, 11), "SKIP", "Mike"),
  ];
  assert.equal(completionActivityForReviewer(team, "Bef").length, 2);
  assert.equal(completionActivityForReviewer(team, "Mike").length, 1);
  assert.equal(team.length, 3);
});

test("labels unattributed historical work as imported from manual task", () => {
  const activity = buildWeeklyCompletionActivity([{
    id: "historical-1",
    brand: "Example",
    normalized: "example",
    action: "CREATE",
    originalAction: "New Brand",
    date: new Date(2026, 6, 14, 9).toISOString(),
  }], [], []);
  assert.equal(activity[0]?.reviewer, "Imported from manual task");
});

test("analytics completion cards and weekly target use the same deduplicated rows", () => {
  const date = new Date(2026, 6, 14, 9).toISOString();
  const activity = buildWeeklyCompletionActivity([{
    id: "historical-deduplicated",
    brand: "Example",
    normalized: "example",
    sourceBrandId: "draft_brand_example",
    action: "CREATE",
    originalAction: "New Brand",
    date,
  }], [], [{
    id: "admin-run",
    filename: "upload.csv",
    exportedAt: date,
    exportedBy: "Bef",
    source: "UBQ",
    items: [{
      id: "admin-item",
      source: "UBQ",
      sourceId: "draft_brand_example",
      originalName: "Example",
      action: "CREATE",
      status: "VERIFIED",
      detail: "Verified",
    }],
  }]);
  const target = buildWeeklyTargetProgress(activity, now);
  const cards = summarizeMappingActivity(activity, [], now);
  assert.equal(activity.length, 1);
  assert.equal(target.completed, cards.thisWeek);
  assert.equal(target.days.find((day) => day.isToday)?.completed, cards.today);
});

test("counts current Brand Master ledger work even when Admin reconciliation fails", () => {
  const date = new Date(2026, 6, 14, 11).toISOString();
  const activity = buildWeeklyCompletionActivity([], [], [{
    id: "failed-admin", filename: "upload.csv", exportedAt: date, exportedBy: "Bef", source: "UBQ",
    items: [{ id: "failed-item", source: "UBQ", sourceId: "draft_brand_1", originalName: "Example", action: "CREATE", status: "CONFLICT", detail: "Admin page failed" }],
  }], [{ id: "draft_brand_1", date, action: "CREATE", reviewer: "Mike" }]);
  assert.equal(activity.length, 1);
  assert.equal(activity[0]?.reviewer, "Mike");
});

test("keeps Root delivery evidence separate from reviewer effort", () => {
  const date = new Date(2026, 6, 14, 11).toISOString();
  const effort = buildWeeklyCompletionActivity([], [], [], [
    { id: "draft_brand_1", ledgerId: "ledger-1", date, action: "CREATE", reviewer: "Bef" },
  ]);
  const root = buildRootBulkMappingActivity([
    { id: "brand_1", name: "Example", aliases: [], category: "Automotive", source: "Root", bulkMappingAt: date },
  ]);
  assert.equal(effort.length, 1);
  assert.equal(root.length, 1);
  assert.equal(buildWeeklyTargetProgress(effort, now).completed, 1);
  assert.equal(buildWeeklyTargetProgress(root, now).completed, 1);
});

test("does not count Admin reconciliation rows as new mapping work", () => {
  const date = new Date(2026, 6, 14, 11).toISOString();
  const activity = buildWeeklyCompletionActivity([], [], [{
    id: "admin-only", filename: "upload.csv", exportedAt: date, exportedBy: "Bef", source: "UBQ",
    items: [{ id: "admin-item", source: "UBQ", sourceId: "draft_brand_2", originalName: "Example", action: "CREATE", status: "VERIFIED", detail: "Verified" }],
  }]);
  assert.equal(activity.length, 0);
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

test("tracks a 700-brand Monday-Friday target at 140 brands per day", () => {
  const entries = [
    ...Array.from({ length: 140 }, () => entry(new Date(2026, 6, 13, 10), "CREATE")),
    ...Array.from({ length: 80 }, () => entry(new Date(2026, 6, 14, 10), "MERGE")),
    entry(new Date(2026, 6, 12, 10), "SKIP"),
    entry(new Date(2026, 6, 18, 10), "DELETE"),
  ];
  const progress = buildWeeklyTargetProgress(entries, now);
  assert.equal(progress.weekStart.getDay(), 1);
  assert.equal(progress.days.length, 5);
  assert.equal(progress.dailyTarget, 140);
  assert.deepEqual(progress.days.map((day) => day.completed), [140, 80, 0, 0, 0]);
  assert.equal(progress.completed, 220);
  assert.equal(progress.remaining, 480);
  assert.equal(progress.progressPercent, 31);
  assert.equal(progress.days[1].isToday, true);
});
