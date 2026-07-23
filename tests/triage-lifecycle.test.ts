import assert from "node:assert/strict";
import test from "node:test";
import { EMPTY_DATA } from "../lib/storage";
import { activeUserBatch, archiveFinishedTriage, archiveTerminalTriages, resolveWorkflowCheckpoint, triageWorklistForMode, triageWorklistWindow } from "../lib/triage-lifecycle";

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

test("a terminal legacy batch returns to Step 1 instead of Resume Finish", () => {
  const input = dataWith("SUCCESS");
  assert.equal(resolveWorkflowCheckpoint("output", input.batches[0]), "imports");
  const repaired = archiveTerminalTriages(input, "2026-07-22T11:00:00.000Z");
  assert.equal(repaired.batches[0].archivedAt, "2026-07-22T11:00:00.000Z");
  assert.equal(repaired.userWorkspaces.Bef.activeBatchId, undefined);
});

test("an unfinished reviewed batch restores Step 3 and an incomplete batch restores Step 2", () => {
  const source = dataWith(undefined).batches[0];
  const ready = { ...source, records: source.records.map((record) => ({ ...record, ubqVerified: true })) };
  assert.equal(resolveWorkflowCheckpoint(undefined, ready), "output");
  const incomplete = { ...ready, records: [{ ...ready.records[0], status: "needs-review" as const }] };
  assert.equal(resolveWorkflowCheckpoint("output", incomplete), "review");
});

test("orphan history never becomes the active Clean View run", () => {
  const input = dataWith(undefined);
  input.userWorkspaces.Bef.activeBatchId = undefined;
  assert.equal(activeUserBatch(input, "Bef"), undefined);
  input.userWorkspaces.Bef.activeBatchId = "batch-bef";
  assert.equal(activeUserBatch(input, "Bef")?.id, "batch-bef");
});

test("a stale active batch pointer is cleared during workspace repair", () => {
  const input = structuredClone(EMPTY_DATA);
  input.userWorkspaces.Bef = {
    activeBatchId: "missing-batch",
    activeView: "output",
    reviewFocusIds: ["missing-row"],
    pinnedQueueIds: [],
    uploads: [],
    updatedAt: "2026-07-20T10:00:00.000Z",
  };

  const repaired = archiveTerminalTriages(input, "2026-07-23T12:00:00.000Z");

  assert.equal(repaired.userWorkspaces.Bef.activeBatchId, undefined);
  assert.equal(repaired.userWorkspaces.Bef.activeView, "imports");
  assert.deepEqual(repaired.userWorkspaces.Bef.reviewFocusIds, []);
});

test("legacy oversized runs honor an explicit worklist limit", () => {
  const batch = dataWith(undefined).batches[0];
  batch.records = Array.from({ length: 30 }, (_, index) => ({
    ...batch.records[0],
    id: `draft_brand_${index + 1}`,
    name: `Brand ${index + 1}`,
  }));
  batch.rows = batch.records.length;

  const window = triageWorklistWindow(batch, 10);

  assert.equal(window.records.length, 10);
  assert.equal(window.rows, 10);
  assert.equal(batch.records.length, 30);
});

test("Clean View exposes up to twenty brands by default", () => {
  const batch = dataWith(undefined).batches[0];
  batch.records = Array.from({ length: 25 }, (_, index) => ({
    ...batch.records[0],
    id: `draft_brand_${index + 1}`,
    name: `Brand ${index + 1}`,
  }));
  batch.rows = batch.records.length;

  const window = triageWorklistWindow(batch);

  assert.equal(window.records.length, 20);
  assert.equal(window.rows, 20);
  assert.equal(batch.records.length, 25);
});

test("Advanced View exposes the complete batch without the Clean View limit", () => {
  const batch = dataWith(undefined).batches[0];
  batch.records = Array.from({ length: 75 }, (_, index) => ({
    ...batch.records[0],
    id: `draft_brand_${index + 1}`,
    name: `Brand ${index + 1}`,
  }));
  batch.rows = batch.records.length;

  const advanced = triageWorklistForMode(batch, false, 20);
  const clean = triageWorklistForMode(batch, true, 20);

  assert.equal(advanced.records.length, 75);
  assert.equal(advanced.rows, 75);
  assert.equal(clean.records.length, 20);
  assert.equal(clean.rows, 20);
});
