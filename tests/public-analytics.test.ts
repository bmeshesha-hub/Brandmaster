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
    },
  };

  const snapshot = buildPublicAnalyticsSnapshot(workspace);
  assert.equal(snapshot.schemaVersion, "brandmaster.public-analytics.v2");
  assert.equal(snapshot.target.completed, 1);
  assert.equal(snapshot.totals.thisWeek, 1);
  assert.equal(snapshot.totals.today, 1);
  assert.equal(snapshot.confidence.average, 80);
  assert.equal(snapshot.confidence.evaluated, 1);
  assert.equal(snapshot.generatedAt, at);
  assert.doesNotMatch(JSON.stringify(snapshot), /Shae|Bef|reviewer|contributors/i);
});
