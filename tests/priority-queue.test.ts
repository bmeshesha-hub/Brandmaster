import assert from "node:assert/strict";
import test from "node:test";
import { completePriorityQueueFromBatch, markPriorityQueueExported, removePriorityQueueItems, resetPriorityQueueItems } from "../lib/priority-queue";
import { BrandRecord, PriorityQueueItem } from "../lib/types";

test("records final bulk outcomes on linked high-priority queue items", () => {
  const items: PriorityQueueItem[] = [
    { id: "priority:UBQ:1", brandId: "draft_brand_1", name: "Alpha OE", source: "UBQ", status: "IN_REVIEW", assignedTo: "reviewer", createdAt: "2026-07-15T10:00:00.000Z", createdBy: "lead", updatedAt: "2026-07-15T10:00:00.000Z" },
    { id: "priority:UBQ:2", brandId: "draft_brand_2", name: "Noise", source: "UBQ", status: "IN_REVIEW", assignedTo: "reviewer", createdAt: "2026-07-15T10:00:00.000Z", createdBy: "lead", updatedAt: "2026-07-15T10:00:00.000Z" },
  ];
  const base = { normalized: "Alpha", confidence: 100, reason: "Reviewed", evidence: [], status: "reviewed" as const, decisionSource: "Manual" };
  const records: BrandRecord[] = [
    { ...base, id: "draft_brand_1", name: "Alpha OE", action: "MERGE", targetId: "brand_alpha", targetName: "Alpha", priorityQueueId: items[0].id },
    { ...base, id: "draft_brand_2", name: "Noise", normalized: "Noise", action: "SKIP", priorityQueueId: items[1].id },
  ];
  const completed = completePriorityQueueFromBatch(items, records, "2026-07-15T12:00:00.000Z");
  assert.equal(completed[0].status, "COMPLETED");
  assert.equal(completed[0].finalAction, "MERGE");
  assert.equal(completed[0].finalTargetId, "brand_alpha");
  assert.equal(completed[0].finalTargetName, "Alpha");
  assert.equal(completed[1].finalAction, "SKIP");
  assert.equal(completed[1].finalTargetId, undefined);
  assert.equal(completed[0].activity?.[0].type, "READY");
});

test("records successful Admin uploads without changing the ready decision", () => {
  const item: PriorityQueueItem = { id: "priority:UBQ:1", brandId: "draft_brand_1", name: "Alpha", source: "UBQ", status: "COMPLETED", finalAction: "CREATE", finalTargetName: "Alpha", createdAt: "2026-07-15T09:00:00.000Z", createdBy: "Bef", updatedAt: "2026-07-15T12:00:00.000Z" };
  const exported = markPriorityQueueExported([item], [item.id], "Mike", "brandmaster-bulk.csv", "2026-07-15T13:00:00.000Z")[0];
  assert.equal(exported.status, "COMPLETED");
  assert.equal(exported.finalAction, "CREATE");
  assert.equal(exported.exportedBy, "Mike");
  assert.equal(exported.exportFilename, "brandmaster-bulk.csv");
  assert.equal(exported.activity?.[0].type, "EXPORTED");
});

test("starts selected high-priority work over without affecting other queue items", () => {
  const items: PriorityQueueItem[] = [
    { id: "priority:UBQ:1", brandId: "draft_brand_1", name: "Alpha", source: "UBQ", status: "COMPLETED", assignedTo: "reviewer", assignedAt: "2026-07-15T10:00:00.000Z", completedAt: "2026-07-15T12:00:00.000Z", finalAction: "MERGE", finalTargetId: "brand_alpha", finalTargetName: "Alpha", finalReason: "Done", createdAt: "2026-07-15T09:00:00.000Z", createdBy: "lead", updatedAt: "2026-07-15T12:00:00.000Z" },
    { id: "priority:UBQ:2", brandId: "draft_brand_2", name: "Beta", source: "UBQ", status: "ASSIGNED", assignedTo: "other", createdAt: "2026-07-15T09:00:00.000Z", createdBy: "lead", updatedAt: "2026-07-15T10:00:00.000Z" },
  ];
  const reset = resetPriorityQueueItems(items, [items[0].id], "2026-07-15T13:00:00.000Z");
  assert.equal(reset[0].status, "UNASSIGNED");
  assert.equal(reset[0].assignedTo, undefined);
  assert.equal(reset[0].completedAt, undefined);
  assert.equal(reset[0].finalAction, undefined);
  assert.equal(reset[0].finalTargetId, undefined);
  assert.equal(reset[0].updatedAt, "2026-07-15T13:00:00.000Z");
  assert.deepEqual(reset[1], items[1]);
});

test("removes only selected obsolete high-priority items", () => {
  const items: PriorityQueueItem[] = [
    { id: "priority:1", brandId: "draft_1", name: "One", source: "UBQ", status: "UNASSIGNED", createdAt: "2026-07-15T09:00:00.000Z", createdBy: "lead", updatedAt: "2026-07-15T09:00:00.000Z" },
    { id: "priority:2", brandId: "draft_2", name: "Two", source: "UBQ", status: "UNASSIGNED", createdAt: "2026-07-15T09:00:00.000Z", createdBy: "lead", updatedAt: "2026-07-15T09:00:00.000Z" },
  ];
  assert.deepEqual(removePriorityQueueItems(items, ["priority:1"]), [items[1]]);
});
