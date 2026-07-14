import assert from "node:assert/strict";
import test from "node:test";
import { buildMappingActivitySeries, cumulativeMappingSeries, summarizeMappingActivity } from "../lib/analytics";
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
