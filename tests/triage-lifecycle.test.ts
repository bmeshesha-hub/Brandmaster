import assert from "node:assert/strict";
import test from "node:test";
import { EMPTY_DATA } from "../lib/storage";
import { archiveFinishedTriage } from "../lib/triage-lifecycle";

function dataWith(status: "SUCCESS" | "FAILED" | undefined) {
  const data = structuredClone(EMPTY_DATA);
  data.batches = [{
    id: "batch-bef",
    filename: "work.csv",
    createdAt: "2026-07-22T10:00:00.000Z",
    rows: 1,
    owner: "Bef",
    records: [{ id: "draft_brand_1", name: "Example", normalized: "Example", action: "CREATE", targetName: "Example", confidence: 100, reason: "Reviewed", evidence: [], status: "reviewed", adminUploadStatus: status }],
  }];
  data.userWorkspaces.Bef = { activeBatchId: "batch-bef", activeView: "output", reviewFocusIds: ["draft_brand_1"], pinnedQueueIds: [], uploads: [], updatedAt: "2026-07-22T10:00:00.000Z" };
  return data;
}

test("a fully successful triage is archived and removed from the personal basket", () => {
  const result = archiveFinishedTriage(dataWith("SUCCESS"), "batch-bef", "Bef", "2026-07-22T11:00:00.000Z");
  assert.equal(result.batches[0].archivedAt, "2026-07-22T11:00:00.000Z");
  assert.equal(result.userWorkspaces.Bef.activeBatchId, undefined);
  assert.equal(result.userWorkspaces.Bef.activeView, "imports");
  assert.deepEqual(result.userWorkspaces.Bef.reviewFocusIds, []);
  assert.equal(result.batches[0].records[0].adminUploadStatus, "SUCCESS");
});

test("a triage with an unresolved or failed row remains active", () => {
  for (const status of [undefined, "FAILED"] as const) {
    const input = dataWith(status);
    const result = archiveFinishedTriage(input, "batch-bef", "Bef", "2026-07-22T11:00:00.000Z");
    assert.equal(result, input);
    assert.equal(result.userWorkspaces.Bef.activeBatchId, "batch-bef");
  }
});
