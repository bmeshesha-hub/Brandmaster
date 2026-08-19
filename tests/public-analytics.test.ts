import assert from "node:assert/strict";
import test from "node:test";
import { buildPublicAnalyticsSnapshot } from "../lib/public-analytics";
import { EMPTY_DATA } from "../lib/storage";
import { SharedWorkspaceSnapshot } from "../lib/types";

test("public analytics is group-only and uses the shared completion target source", () => {
  const at = "2026-07-23T16:00:00.000Z";
  const workspace: SharedWorkspaceSnapshot = {
    schemaVersion: "brandmaster.workspace.v1",
    exportedAt: at,
    sync: { lastSyncedAt: at, lastSyncedBy: "Shae", history: [] },
    ubq: null,
    data: {
      ...structuredClone(EMPTY_DATA),
      historicalMappings: [
        { id: "history-1", brand: "Alpha", normalized: "Alpha", sourceBrandId: "draft_alpha", action: "CREATE", originalAction: "New Brand", date: at, reviewer: "Shae", sourceFilename: "manual.csv", importedAt: at },
      ],
      ledger: [
        { id: "draft_beta", ledgerId: "ledger-1", date: at, name: "Beta", normalized: "Beta", action: "SKIP", confidence: 80, reason: "Needs evidence", evidence: [], status: "reviewed", reviewer: "Bef", decisionSource: "Manual" },
      ],
      rootBrands: [
        { id: "brand_root_bulk", name: "Root bulk", aliases: [], category: "Root", source: "Root", bulkMappingAt: at },
      ],
    },
  };

  const snapshot = buildPublicAnalyticsSnapshot(workspace);
  assert.equal(snapshot.schemaVersion, "brandmaster.public-analytics.v2");
  assert.equal(snapshot.target.weekly, 700);
  assert.equal(snapshot.target.daily, 140);
  assert.equal(snapshot.target.completed, 3);
  assert.equal(snapshot.totals.thisWeek, 3);
  assert.equal(snapshot.totals.today, 3);
  assert.equal(snapshot.totals.mappedToday, 2);
  assert.equal(snapshot.totals.mappedThisWeek, 2);
  assert.equal(snapshot.activity?.at(-1)?.total, 2);
  assert.equal(snapshot.activity?.at(-1)?.CREATE, 1);
  assert.equal(snapshot.activity?.at(-1)?.SKIP, 1);
  assert.equal(snapshot.confidence.average, 80);
  assert.equal(snapshot.confidence.evaluated, 1);
  assert.equal(snapshot.generatedAt, at);
  assert.doesNotMatch(JSON.stringify(snapshot), /Shae|Bef|reviewer|contributors/i);
});
