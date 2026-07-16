import assert from "node:assert/strict";
import test from "node:test";
import { decideGitHubSync, mergeWorkspaceSnapshots } from "../lib/github-workspace";
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
