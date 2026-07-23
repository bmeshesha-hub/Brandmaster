import assert from "node:assert/strict";
import test from "node:test";
import { findCompletedBrandDetails } from "../lib/completed-brands";
import { EMPTY_DATA } from "../lib/storage";
import { AppData, BrandRecord } from "../lib/types";

const record: BrandRecord = {
  id: "draft_brand_1",
  name: "BMW Original OE",
  normalized: "BMW",
  action: "MERGE",
  targetId: "brand_bmw",
  targetName: "BMW",
  confidence: 100,
  reason: "Matched",
  evidence: [],
  status: "reviewed",
  decisionSource: "Manual",
  adminUploadStatus: "SUCCESS",
  adminUploadedAt: "2026-07-22T12:00:00.000Z",
};

test("finds confirmed completed brands using normalized submitted names", () => {
  const data: AppData = {
    ...EMPTY_DATA,
    batches: [{ id: "batch", filename: "done.csv", createdAt: "2026-07-22T10:00:00.000Z", rows: 1, records: [record] }],
  };
  assert.deepEqual(findCompletedBrandDetails(data, [{ name: " bmw oe " }]), [{
    brand: "bmw oe",
    action: "MERGE",
    date: "2026-07-22T12:00:00.000Z",
  }]);
});

test("returns one detail per submitted brand and prefers confirmed Admin outcomes", () => {
  const data: AppData = {
    ...EMPTY_DATA,
    batches: [{ id: "batch", filename: "done.csv", createdAt: "2026-07-22T10:00:00.000Z", rows: 1, records: [record] }],
    priorityQueue: [{
      id: "queue",
      brandId: record.id,
      name: record.name,
      source: "UBQ",
      status: "COMPLETED",
      finalAction: "SKIP",
      completedAt: "2026-07-23T12:00:00.000Z",
      createdAt: "2026-07-21T12:00:00.000Z",
      createdBy: "Bef",
      updatedAt: "2026-07-23T12:00:00.000Z",
    }],
  };
  assert.deepEqual(findCompletedBrandDetails(data, [{ name: "BMW" }, { name: "bmw original oe" }]), [{
    brand: "BMW",
    action: "MERGE",
    date: "2026-07-22T12:00:00.000Z",
  }]);
});

test("reports queue-only completion and ignores unfinished work", () => {
  const data: AppData = {
    ...EMPTY_DATA,
    priorityQueue: [
      { id: "done", brandId: "draft_brand_done", name: "Done Brand", source: "UBQ", status: "COMPLETED", finalAction: "CREATE", completedAt: "2026-07-22T12:00:00.000Z", createdAt: "2026-07-21T12:00:00.000Z", createdBy: "Mike", updatedAt: "2026-07-22T12:00:00.000Z" },
      { id: "open", brandId: "draft_brand_open", name: "Open Brand", source: "UBQ", status: "ASSIGNED", createdAt: "2026-07-21T12:00:00.000Z", createdBy: "Mike", updatedAt: "2026-07-22T12:00:00.000Z" },
    ],
  };
  assert.deepEqual(findCompletedBrandDetails(data, [{ name: "Done Brand" }, { name: "Open Brand" }]), [{
    brand: "Done Brand",
    action: "CREATE",
    date: "2026-07-22T12:00:00.000Z",
  }]);
});
