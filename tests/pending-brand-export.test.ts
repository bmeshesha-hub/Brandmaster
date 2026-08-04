import assert from "node:assert/strict";
import test from "node:test";
import { pendingBrandAdminCsv, pendingBrandRows, pendingBrandWorkflowCsv } from "../lib/pending-brand-export";
import { BrandRecord, PriorityQueueItem } from "../lib/types";

const base: BrandRecord = {
  id: "draft_brand_1", name: "Alpha OE", normalized: "Alpha", action: "MERGE", targetId: "brand_alpha", targetName: "Alpha",
  confidence: 100, reason: "Reviewed", evidence: [], status: "reviewed", reviewer: "Bef", reviewedAt: "2026-08-01T10:00:00.000Z", decisionSource: "Manual override",
};

test("separates upload-ready rows from rows reopened for a second review", () => {
  const reopened: BrandRecord = { ...base, id: "draft_brand_2", name: "Beta", status: "needs-review", priorityQueueId: "queue-2" };
  const firstReview: BrandRecord = { ...base, id: "draft_brand_3", name: "Gamma", status: "needs-review", reviewedAt: undefined };
  const queue: PriorityQueueItem = { id: "queue-2", brandId: reopened.id, name: reopened.name, source: "UBQ", status: "IN_REVIEW", assignedTo: "Mike", createdAt: "2026-08-01T09:00:00.000Z", createdBy: "Bef", updatedAt: "2026-08-02T12:00:00.000Z" };
  const rows = pendingBrandRows([base, reopened, firstReview], [queue]);
  assert.deepEqual(rows.map((row) => row.status), ["WAITING_FOR_SECOND_REVIEW", "WAITING_FOR_UPLOAD"]);
  assert.equal(rows[0].assignedTo, "Mike");
});

test("keeps second-review rows out of the locked Admin CSV", () => {
  const reopened: BrandRecord = { ...base, id: "draft_brand_2", name: "Beta", status: "needs-review" };
  const rows = pendingBrandRows([base, reopened]);
  const admin = pendingBrandAdminCsv(rows);
  assert.equal(admin.split("\n").length, 2);
  assert.match(admin, /"draft_brand_1"/);
  assert.doesNotMatch(admin, /draft_brand_2/);
  assert.match(pendingBrandWorkflowCsv(rows), /Waiting for second review/);
});

test("rejects incomplete mappings and completed or excluded rows", () => {
  const incompleteMerge = { ...base, id: "draft_brand_bad", targetId: undefined };
  const completed = { ...base, id: "draft_brand_done", adminUploadStatus: "SUCCESS" as const };
  const excluded = { ...base, id: "draft_brand_excluded", excludedFromExport: true };
  assert.deepEqual(pendingBrandRows([incompleteMerge, completed, excluded]), []);
});
