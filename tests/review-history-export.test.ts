import assert from "node:assert/strict";
import test from "node:test";
import { latestReviewHistoryEntries, matchesReviewHistoryQuery, reviewHistoryProgressCsv } from "../lib/review-history-export";
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
    "Brand,DATE,ACTION",
    '"1av","2026-03-17","Alias"',
    '"2crave","2026-03-13","New Brand"',
    '"4 seasons","2026-04-15","Skipped"',
  ].join("\n"));
});

test("finds review history from pasted spreadsheet rows and exact draft IDs", () => {
  const reviewed = { ...entry("nr-auto", "2026-07-20T14:00:00.000Z", "CREATE"), id: "draft_brand_St6oq6vFJC8ZUkwcLwo83j" };
  const pasted = [
    "another brand\t308\t3\t\t\t\t\t\tYes\tdraft_brand_other",
    "nr-auto\t308\t3\t\t\t\t\t\tYes\tdraft_brand_St6oq6vFJC8ZUkwcLwo83j",
  ].join("\n");
  assert.equal(matchesReviewHistoryQuery(reviewed, pasted), true);
  assert.equal(matchesReviewHistoryQuery(reviewed, "draft_brand_missing"), false);
  assert.equal(matchesReviewHistoryQuery(reviewed, "NR-AUTO"), true);
});

test("rebuild selection keeps only the newest decision per UnmappedBrandID", () => {
  const older = { ...entry("nr-auto", "2026-07-19T14:00:00.000Z", "SKIP"), ledgerId: "older" };
  const newer = { ...entry("nr-auto", "2026-07-20T14:00:00.000Z", "CREATE"), ledgerId: "newer" };
  assert.deepEqual(latestReviewHistoryEntries([older, newer]).map((item) => item.ledgerId), ["newer"]);
});
