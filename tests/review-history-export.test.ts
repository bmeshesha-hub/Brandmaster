import assert from "node:assert/strict";
import test from "node:test";
import { reviewHistoryProgressCsv } from "../lib/review-history-export";
import { LedgerEntry } from "../lib/types";

function entry(normalized: string, date: string, action: LedgerEntry["action"]): LedgerEntry {
  return {
    ledgerId: `${normalized}-${action}`,
    date,
    id: "draft_brand_test",
    name: normalized,
    normalized,
    action,
    confidence: 100,
    reason: "Reviewed",
    evidence: [],
    status: "reviewed",
  };
}

test("exports review history in compact mapping-progress format", () => {
  const csv = reviewHistoryProgressCsv([
    entry("1AV", "2026-03-17T14:00:00.000Z", "MERGE"),
    entry("2Crave", "2026-03-13T09:00:00.000Z", "CREATE"),
    entry("4 Seasons", "2026-04-15T12:00:00.000Z", "SKIP"),
  ]);
  assert.equal(csv, [
    "normalized_brand,mapped_dt,action",
    '"1av","2026-03-17","Alias"',
    '"2crave","2026-03-13","New Brand"',
    '"4 seasons","2026-04-15","Skipped"',
  ].join("\n"));
});
