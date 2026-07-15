import assert from "node:assert/strict";
import test from "node:test";
import { completePriorityQueueFromBatch } from "../lib/priority-queue";
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
});
