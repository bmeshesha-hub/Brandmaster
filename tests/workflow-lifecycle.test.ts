import assert from "node:assert/strict";
import test from "node:test";
import { applyAdminUploadResultsToRecords, parseAdminUploadResults } from "../lib/admin-upload-results";
import { toCsv } from "../lib/brand-engine";
import { BrandRecord } from "../lib/types";
import {
  confirmExportRun,
  createExportRun,
  isPendingExportRun,
  isPendingWorkflowStage,
  markRecordsDownloaded,
  normalizeWorkflowRecord,
  pendingExportRunIds,
  requestSecondReview,
  saveWorkflowReview,
  saveWorkflowReviews,
  stableExportChecksum,
  workflowStage,
} from "../lib/workflow-lifecycle";

const brand = (id = "draft_brand_alpha"): BrandRecord => ({
  id,
  name: "Alpha",
  normalized: "Alpha",
  action: "CREATE",
  targetName: "Alpha",
  confidence: 97,
  reason: "Distinct brand",
  evidence: ["Reviewed"],
  status: "needs-review",
  decisionSource: "Manual",
  ubqVerified: true,
});

test("migrates legacy reviewed records into the canonical lifecycle", () => {
  const migrated = normalizeWorkflowRecord({ ...brand(), status: "reviewed", reviewer: "Amina", reviewedAt: "2026-08-01T10:00:00.000Z" });
  assert.equal(workflowStage(migrated), "READY_TO_UPLOAD");
  assert.equal(migrated.firstReviewedBy, "Amina");
  assert.equal(migrated.approvedBy, "Amina");
});

test("requires a different teammate for an explicit second review", () => {
  const first = saveWorkflowReview(brand(), "Amina", "2026-08-01T10:00:00.000Z").record;
  const requested = requestSecondReview(first, "Amina", "Target may be wrong", "2026-08-01T11:00:00.000Z");
  assert.equal(workflowStage(requested), "SECOND_REVIEW");
  assert.equal(requested.firstReviewedBy, "Amina");

  const selfApproval = saveWorkflowReview(requested, "Amina", "2026-08-01T12:00:00.000Z");
  assert.match(selfApproval.error || "", /another teammate/i);
  assert.equal(workflowStage(selfApproval.record), "SECOND_REVIEW");

  const peerApproval = saveWorkflowReview(requested, "Ben", "2026-08-01T12:15:00.000Z");
  assert.equal(peerApproval.error, undefined);
  assert.equal(workflowStage(peerApproval.record), "READY_TO_UPLOAD");
  assert.equal(peerApproval.record.secondReviewedBy, "Ben");
  assert.equal(peerApproval.record.approvedBy, "Ben");
});

test("approves a selected worklist atomically", () => {
  const records = [brand("draft_brand_alpha"), brand("draft_brand_beta")];
  const result = saveWorkflowReviews(records, records.map((record) => record.id), "Amina", "2026-08-01T10:00:00.000Z");

  assert.equal(result.error, undefined);
  assert.equal(result.reviewed.length, 2);
  assert.equal(result.records.every((record) => workflowStage(record) === "READY_TO_UPLOAD"), true);
  assert.equal(records.every((record) => record.status === "needs-review"), true);
});

test("does not partially approve a worklist when second review is blocked", () => {
  const ready = brand("draft_brand_alpha");
  const first = saveWorkflowReview(brand("draft_brand_beta"), "Amina", "2026-08-01T10:00:00.000Z").record;
  const secondReview = requestSecondReview(first, "Amina", "Independent check", "2026-08-01T11:00:00.000Z");
  const records = [ready, secondReview];
  const result = saveWorkflowReviews(records, records.map((record) => record.id), "Amina", "2026-08-01T12:00:00.000Z");

  assert.match(result.error || "", /another teammate/i);
  assert.equal(result.reviewed.length, 0);
  assert.equal(result.records, records);
  assert.equal(result.records[0].status, "needs-review");
});

test("runs the reviewed brand through an immutable export and Admin confirmation", () => {
  const first = saveWorkflowReview(brand(), "Amina", "2026-08-01T10:00:00.000Z").record;
  const requested = requestSecondReview(first, "Amina", "Independent check", "2026-08-01T11:00:00.000Z");
  const approved = saveWorkflowReview(requested, "Ben", "2026-08-01T12:00:00.000Z").record;
  const run = createExportRun("batch-1", "brands.csv", [approved], "Ben", "2026-08-01T12:05:00.000Z");

  assert.equal(run.rowCount, 1);
  assert.deepEqual(run.rowIds, [approved.id]);
  assert.equal(run.checksum, stableExportChecksum([approved]));
  assert.equal(toCsv([approved]).trim().split("\n").length, 2);

  const downloaded = markRecordsDownloaded([approved], run.rowIds)[0];
  assert.equal(workflowStage(downloaded), "DOWNLOADED");
  const result = parseAdminUploadResults(`UnmappedBrandID,Status,ErrorMessage\n${approved.id},SUCCESS,`);
  const applied = applyAdminUploadResultsToRecords([downloaded], run.rowIds, result.rows, "admin-results.csv", "2026-08-01T12:10:00.000Z", true, false, "Ben");
  assert.equal(workflowStage(applied.records[0]), "ADMIN_CONFIRMED");

  const confirmed = confirmExportRun(run, applied.successful.map((record) => record.id), [], "admin-results.csv", "Ben", "2026-08-01T12:10:00.000Z");
  assert.equal(confirmed.status, "ADMIN_CONFIRMED");
  assert.deepEqual(confirmed.successfulIds, [approved.id]);
  assert.equal(isPendingExportRun(confirmed), false);
  assert.equal(isPendingWorkflowStage(workflowStage(applied.records[0])), false);
});

test("regenerates only unresolved rows and removes the run after the final Admin confirmation", () => {
  const records = [brand("draft_brand_alpha"), brand("draft_brand_beta")].map((record) => saveWorkflowReview(record, "Amina", "2026-08-01T10:00:00.000Z").record);
  const run = createExportRun("batch-2", "brands.csv", records, "Amina", "2026-08-01T10:05:00.000Z");
  const partial = confirmExportRun(run, [records[0].id], [records[1].id], "first-result.csv", "Amina", "2026-08-01T10:10:00.000Z");

  assert.equal(partial.status, "PARTIALLY_CONFIRMED");
  assert.equal(isPendingExportRun(partial), true);
  assert.deepEqual(pendingExportRunIds(partial), [records[1].id]);

  const complete = confirmExportRun(partial, [records[1].id], [], "second-result.csv", "Amina", "2026-08-01T10:20:00.000Z");
  assert.equal(complete.status, "ADMIN_CONFIRMED");
  assert.deepEqual(complete.successfulIds, records.map((record) => record.id));
  assert.deepEqual(complete.failedIds, []);
  assert.deepEqual(pendingExportRunIds(complete), []);
  assert.equal(isPendingExportRun(complete), false);
});
