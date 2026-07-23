import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { applyNotDoneSnapshot, isNotDoneSnapshot, NotDoneSnapshot } from "../lib/not-done-snapshot";
import { EMPTY_DATA } from "../lib/storage";

const SNAPSHOT: NotDoneSnapshot = {
  schemaVersion: "brandmaster.not-done.v1",
  filename: "current-manual-fpa.csv",
  capturedAt: "2026-07-23T17:06:58.000Z",
  rows: [{ id: "draft_brand_current", name: "Current Brand", listingCount: 25, sellerCount: 3 }],
};

test("the bundled Manual FPA snapshot contains only exact current not-done IDs", () => {
  const payload = JSON.parse(fs.readFileSync("public/manual-fpa-current.json", "utf8")) as unknown;
  assert.equal(isNotDoneSnapshot(payload), true);
  if (!isNotDoneSnapshot(payload)) return;
  assert.equal(payload.rows.length, 1904);
  assert.equal(new Set(payload.rows.map((row) => row.id)).size, 1904);
  assert.equal(payload.rows.every((row) => row.id.startsWith("draft_brand_") && Boolean(row.name.trim())), true);
});

test("a current not-done snapshot retires stale flags and reopens older completion", () => {
  const data = {
    ...EMPTY_DATA,
    manualFpaIds: [{
      id: "manual-fpa:draft_brand_old",
      brand: "Old Brand",
      normalized: "Old Brand",
      sourceBrandId: "draft_brand_old",
      ubq: true,
      sourceFilename: "old.csv",
      importedAt: "2026-07-22T12:00:00.000Z",
    }],
    priorityQueue: [{
      id: "task-current",
      brandId: "draft_brand_current",
      name: "Current Brand",
      source: "UBQ" as const,
      status: "COMPLETED" as const,
      finalAction: "CREATE" as const,
      completedAt: "2026-07-23T16:30:00.000Z",
      createdAt: "2026-07-23T15:00:00.000Z",
      createdBy: "Bef",
      updatedAt: "2026-07-23T16:30:00.000Z",
    }],
  };
  const result = applyNotDoneSnapshot(data, SNAPSHOT);
  assert.equal(result.manualFpaIds.find((reference) => reference.sourceBrandId === "draft_brand_old")?.ubq, false);
  assert.equal(result.manualFpaIds.find((reference) => reference.sourceBrandId === "draft_brand_current")?.ubq, true);
  assert.equal(result.priorityQueue[0].status, "UNASSIGNED");
  assert.equal(result.priorityQueue[0].finalAction, undefined);
  assert.equal(result.sourceMeta.MANUAL_FPA?.rowCount, 1);
});

test("the snapshot never reopens work completed after its capture time", () => {
  const data = {
    ...EMPTY_DATA,
    priorityQueue: [{
      id: "task-current",
      brandId: "draft_brand_current",
      name: "Current Brand",
      source: "UBQ" as const,
      status: "COMPLETED" as const,
      finalAction: "CREATE" as const,
      completedAt: "2026-07-23T17:30:00.000Z",
      createdAt: "2026-07-23T17:10:00.000Z",
      createdBy: "Bef",
      updatedAt: "2026-07-23T17:30:00.000Z",
    }],
  };
  const result = applyNotDoneSnapshot(data, SNAPSHOT);
  assert.equal(result.priorityQueue[0].status, "COMPLETED");
  assert.equal(result.priorityQueue[0].finalAction, "CREATE");
});

test("a newer user-uploaded Manual FPA source overrides the bundled snapshot", () => {
  const data = {
    ...EMPTY_DATA,
    sourceMeta: {
      MANUAL_FPA: { filename: "newer.csv", updatedAt: "2026-07-23T18:00:00.000Z", rowCount: 2 },
    },
  };
  assert.equal(applyNotDoneSnapshot(data, SNAPSHOT), data);
});
