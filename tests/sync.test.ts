import assert from "node:assert/strict";
import test from "node:test";
import { decideGitHubSync, mergeWorkspaceSnapshots, protectActiveTriage, shouldProtectTriage } from "../lib/github-workspace";
import { EMPTY_DATA } from "../lib/storage";
import { SharedWorkspaceSnapshot } from "../lib/types";

function snapshot(): SharedWorkspaceSnapshot {
  return {
    schemaVersion: "brandmaster.workspace.v1",
    exportedAt: "2026-07-15T12:00:00.000Z",
    data: structuredClone(EMPTY_DATA),
    ubq: null,
  };
}

test("sync state requires a pull when no local revision is known", () => {
  assert.equal(decideGitHubSync("remote-1", null), "pull");
  assert.equal(decideGitHubSync(null, null), "create");
  assert.equal(decideGitHubSync("remote-1", "remote-1"), "push");
  assert.equal(decideGitHubSync("remote-2", "remote-1"), "conflict");
});

test("three-way merge keeps unrelated teammate and local changes", () => {
  const base = snapshot();
  const local = structuredClone(base);
  const remote = structuredClone(base);
  local.data.validationSettings.offlineRules = false;
  remote.data.validationSettings.aliasTable = false;

  const result = mergeWorkspaceSnapshots(base, local, remote);

  assert.equal(result.workspace.data.validationSettings.offlineRules, false);
  assert.equal(result.workspace.data.validationSettings.aliasTable, false);
  assert.equal(result.localChanges, 1);
  assert.equal(result.remoteChanges, 1);
});

test("closed-without-mapping queue tombstone survives a teammate's older snapshot", () => {
  const task = { id: "priority:UBQ:closed", brandId: "draft_brand_closed", name: "Already done", source: "UBQ" as const, status: "ASSIGNED" as const, assignedTo: "Bef", createdAt: "2026-07-21T10:00:00.000Z", createdBy: "Bef", updatedAt: "2026-07-21T10:00:00.000Z" };
  const base = snapshot();
  base.data.priorityQueue = [task];
  const local = structuredClone(base);
  local.data.priorityQueue[0] = { ...task, status: "COMPLETED", assignedTo: undefined, resolvedWithoutMappingAt: "2026-07-21T11:00:00.000Z", resolvedWithoutMappingBy: "Bef", triageResolution: "ALREADY_DONE", updatedAt: "2026-07-21T11:00:00.000Z" };
  const remote = structuredClone(base);

  const merged = mergeWorkspaceSnapshots(base, local, remote).workspace.data.priorityQueue[0];
  assert.equal(merged.resolvedWithoutMappingAt, "2026-07-21T11:00:00.000Z");
  assert.equal(merged.triageResolution, "ALREADY_DONE");
  assert.equal(merged.assignedTo, undefined);
});

test("timer sync cannot delete or roll back the active user's triage batch", () => {
  const base = snapshot();
  const activeBatch = {
    id: "batch-bef-active",
    filename: "bef-work.csv",
    createdAt: "2026-07-16T10:00:00.000Z",
    rows: 1,
    owner: "Bef",
    workflowSource: "IMPORT" as const,
    records: [{ id: "draft_brand_1", name: "Newton", normalized: "Newton", action: "MERGE" as const, targetId: "brand_newton", targetName: "Newton Commercial", confidence: 100, reason: "Reviewed", evidence: [], status: "reviewed" as const, ubqVerified: true }],
  };
  base.data.batches = [activeBatch];
  base.data.userWorkspaces.Bef = { activeBatchId: activeBatch.id, pinnedQueueIds: [], uploads: [], updatedAt: "2026-07-16T10:00:00.000Z" };
  const local = structuredClone(base);
  local.data.batches[0].records[0].targetName = "Newton Commercial Ltd";
  const remote = structuredClone(base);
  remote.data.batches = [];
  remote.data.userWorkspaces.Bef.activeBatchId = undefined;

  const merged = mergeWorkspaceSnapshots(base, local, remote).workspace;
  const protectedWorkspace = protectActiveTriage(local, merged, "Bef");

  assert.equal(protectedWorkspace.data.userWorkspaces.Bef.activeBatchId, activeBatch.id);
  assert.equal(protectedWorkspace.data.batches.find((batch) => batch.id === activeBatch.id)?.records[0].targetName, "Newton Commercial Ltd");
});

test("active triage protection does not restore an intentionally cleared local batch", () => {
  const local = snapshot();
  local.data.userWorkspaces.Bef = { pinnedQueueIds: [], uploads: [], updatedAt: "2026-07-16T11:00:00.000Z" };
  const merged = snapshot();
  const protectedWorkspace = protectActiveTriage(local, merged, "Bef");
  assert.deepEqual(protectedWorkspace.data.batches, []);
});

test("background workspace application pauses only for an unreleased active Step 2 or Step 3 batch", () => {
  assert.equal(shouldProtectTriage("review", "batch-1", null), true);
  assert.equal(shouldProtectTriage("output", "batch-1", null), true);
  assert.equal(shouldProtectTriage("imports", "batch-1", null), true);
  assert.equal(shouldProtectTriage("review", undefined, null), false);
  assert.equal(shouldProtectTriage("output", "batch-1", "batch-1"), false);
  assert.equal(shouldProtectTriage("output", "batch-1", "batch-old"), true);
});
