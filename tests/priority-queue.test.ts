import assert from "node:assert/strict";
import test from "node:test";
import { completePriorityQueueFromBatch, markPriorityQueueExported, normalizePriorityQueueItems, planPriorityImports, priorityImportDisposition, priorityQueueScore, priorityTaskKey, reconcilePriorityQueueWithUbq, removePriorityQueueItems, resetPriorityQueueItems } from "../lib/priority-queue";
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
  assert.equal(exported.externalStatus, "EXPORTED_PENDING_VERIFICATION");
  assert.equal(exported.activity?.[0].type, "EXPORTED");
});

test("deduplicates paste, CSV, and UBQ versions of the same normalized mapping task", () => {
  const createdAt = "2026-07-15T09:00:00.000Z";
  const items: PriorityQueueItem[] = [
    { id: "paste", brandId: "missing_id_00001", name: "BMW OE", source: "PASTE", status: "UNASSIGNED", createdAt, createdBy: "Mike", updatedAt: createdAt },
    { id: "ubq", brandId: "draft_brand_bmw", name: "BMW", source: "UBQ", status: "ASSIGNED", assignedTo: "Bef", createdAt, createdBy: "Bef", updatedAt: "2026-07-15T10:00:00.000Z" },
  ];
  const normalized = normalizePriorityQueueItems(items);
  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].source, "UBQ");
  assert.equal(normalized[0].brandId, "draft_brand_bmw");
  assert.equal(normalized[0].assignedTo, "Bef");
  assert.equal(priorityTaskKey("CSV", "missing_id_1", "BMW Original OE"), priorityTaskKey("UBQ", "draft_brand_bmw", "BMW"));
  assert.notEqual(priorityTaskKey("ROOT", "brand_bmw", "BMW"), priorityTaskKey("UBQ", "draft_brand_bmw", "BMW"));
});

test("verifies completed UBQ work only after the row disappears from a refreshed export", () => {
  const item: PriorityQueueItem = { id: "task", brandId: "draft_brand_1", name: "Alpha", source: "UBQ", status: "COMPLETED", finalAction: "CREATE", externalStatus: "EXPORTED_PENDING_VERIFICATION", createdAt: "2026-07-15T09:00:00.000Z", createdBy: "Mike", updatedAt: "2026-07-15T10:00:00.000Z" };
  assert.equal(reconcilePriorityQueueWithUbq([item], new Set([item.brandId]), "new UBQ")[0].externalStatus, "EXPORTED_PENDING_VERIFICATION");
  const verified = reconcilePriorityQueueWithUbq([item], new Set(), "new UBQ", "2026-07-16T10:00:00.000Z")[0];
  assert.equal(verified.externalStatus, "VERIFIED");
  assert.equal(verified.verifiedBy, "new UBQ");
  assert.equal(verified.activity?.[0].type, "VERIFIED");
});

test("reopens a verified task when the brand regresses into a newer UBQ export", () => {
  const item: PriorityQueueItem = { id: "task", brandId: "draft_brand_1", name: "Alpha", source: "UBQ", status: "COMPLETED", externalStatus: "VERIFIED", verifiedAt: "2026-07-16T10:00:00.000Z", verifiedBy: "old UBQ", createdAt: "2026-07-15T09:00:00.000Z", createdBy: "Mike", updatedAt: "2026-07-16T10:00:00.000Z" };
  const regressed = reconcilePriorityQueueWithUbq([item], new Set([item.brandId]), "new UBQ", "2026-07-18T10:00:00.000Z")[0];
  assert.equal(regressed.status, "UNASSIGNED");
  assert.equal(regressed.externalStatus, "NOT_STARTED");
  assert.equal(regressed.verifiedAt, undefined);
  assert.match(regressed.activity?.[0].message || "", /Regression detected/);
});

test("reopens a name-only pasted task when it returns in the latest UBQ", () => {
  const item: PriorityQueueItem = { id: "task", brandId: "missing_id_1", name: "Alpha_OEM", source: "PASTE", status: "COMPLETED", externalStatus: "VERIFIED", verifiedAt: "2026-07-16T10:00:00.000Z", verifiedBy: "old UBQ", createdAt: "2026-07-15T09:00:00.000Z", createdBy: "Mike", updatedAt: "2026-07-16T10:00:00.000Z" };
  const regressed = reconcilePriorityQueueWithUbq([item], new Set(["draft_brand_alpha"]), "new UBQ", "2026-07-18T10:00:00.000Z", new Set(["alpha"]));
  assert.equal(regressed[0].status, "UNASSIGNED");
  assert.equal(regressed[0].externalStatus, "NOT_STARTED");
  assert.match(regressed[0].activity?.[0].message || "", /returned in the latest UBQ/i);
});

test("priority score favors high-volume authoritative and blocked work", () => {
  const low: PriorityQueueItem = { id: "low", brandId: "missing_id_1", name: "Low", source: "PASTE", status: "ASSIGNED", createdAt: "2026-07-18T09:00:00.000Z", createdBy: "Mike", updatedAt: "2026-07-18T09:00:00.000Z" };
  const high: PriorityQueueItem = { ...low, id: "high", brandId: "brand_high", source: "ROOT", status: "BLOCKED", listingCount: 500 };
  assert.ok(priorityQueueScore(high, new Date("2026-07-18T10:00:00.000Z").getTime()) > priorityQueueScore(low, new Date("2026-07-18T10:00:00.000Z").getTime()));
});

test("classifies repeat imports without reopening protected team work", () => {
  const base: PriorityQueueItem = { id: "task", brandId: "draft_brand_1", name: "Alpha", source: "UBQ", status: "ASSIGNED", assignedTo: "Mike", createdAt: "2026-07-18T09:00:00.000Z", createdBy: "Mike", updatedAt: "2026-07-18T09:00:00.000Z" };
  assert.equal(priorityImportDisposition(undefined, "Bef"), "NEW");
  assert.equal(priorityImportDisposition(base, "Mike"), "YOUR_ACTIVE_WORK");
  assert.equal(priorityImportDisposition(base, "Bef"), "TEAMMATE_ACTIVE_WORK");
  assert.equal(priorityImportDisposition({ ...base, status: "COMPLETED" }, "Mike"), "READY_FOR_EXPORT");
  assert.equal(priorityImportDisposition({ ...base, status: "COMPLETED", exportedAt: "2026-07-19T10:00:00.000Z", externalStatus: "EXPORTED_PENDING_VERIFICATION" }, "Mike"), "AWAITING_VERIFICATION");
  assert.equal(priorityImportDisposition({ ...base, status: "COMPLETED", externalStatus: "VERIFIED" }, "Mike"), "VERIFIED_COMPLETE");
  assert.equal(priorityImportDisposition({ ...base, status: "COMPLETED", resolvedWithoutMappingAt: "2026-07-19T11:00:00.000Z" }, "Mike"), "RESOLVED_WITHOUT_MAPPING");
});

test("preflight accounts for all submitted rows before filtering protected work", () => {
  const createdAt = "2026-07-18T09:00:00.000Z";
  const protectedRows: PriorityQueueItem[] = Array.from({ length: 7 }, (_, index) => ({
    id: `task-${index}`,
    brandId: `missing_id_${index}`,
    name: `Existing ${index}`,
    source: "PASTE" as const,
    status: "ASSIGNED" as const,
    assignedTo: "Bef",
    createdAt,
    createdBy: "Bef",
    updatedAt: createdAt,
  }));
  const submitted = [
    ...protectedRows.map((item) => ({ id: item.brandId, name: item.name })),
    { id: "missing_id_new", name: "New Brand" },
  ];
  const plan = planPriorityImports(submitted, protectedRows, "Bef");
  assert.equal(plan.length, 8);
  assert.equal(plan.filter((item) => item.accepted).length, 1);
  assert.equal(plan.filter((item) => !item.accepted).length, 7);
  assert.match(plan[0].reason, /Already assigned/);
  assert.match(plan[7].reason, /ready to import/);
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
