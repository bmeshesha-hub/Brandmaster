import assert from "node:assert/strict";
import test from "node:test";
import { applyAdminUploadResultsToRecords, parseAdminUploadResults, summarizeAdminUploadResults } from "../lib/admin-upload-results";
import { BrandRecord } from "../lib/types";

test("parses the real Admin bulk result report", () => {
  const csv = `"RowNumber","UnmappedBrandID","UnmappedBrandName","Action","TargetBrandID","TargetBrandName","Status","ErrorMessage","CreatedBrandID"\n"1","draft_brand_1","onlinechoices*","SKIP","","","SUCCESS","",""\n"2","draft_brand_2","wheelspart","CREATE","","wheelspart","SUCCESS","","brand_EqgzrjYkeFuv2tCj2TioPi"`;
  const result = parseAdminUploadResults(csv);
  assert.equal(result.error, undefined);
  assert.equal(result.rows.length, 2);
  assert.equal(result.rows.every((row) => row.status === "SUCCESS"), true);
  assert.equal(result.rows.find((row) => row.unmappedBrandName === "wheelspart")?.createdBrandId, "brand_EqgzrjYkeFuv2tCj2TioPi");
});

test("separates successful, failed, missing, and unrelated result rows", () => {
  const csv = `UnmappedBrandID,UnmappedBrandName,Status,ErrorMessage\ndraft_brand_1,Alpha,SUCCESS,\ndraft_brand_2,Beta,FAILED,Target missing\ndraft_brand_other,Other,SUCCESS,`;
  const parsed = parseAdminUploadResults(csv);
  const summary = summarizeAdminUploadResults(["draft_brand_1", "draft_brand_2", "draft_brand_3"], parsed.rows);
  assert.equal(summary.successful.length, 1);
  assert.equal(summary.failed[0].errorMessage, "Target missing");
  assert.deepEqual(summary.missingIds, ["draft_brand_3"]);
  assert.equal(summary.unrelated, 1);
});

test("applies successes and returns only failed rows to review", () => {
  const base = { normalized: "", confidence: 100, reason: "Approved", evidence: [], status: "reviewed" as const, decisionSource: "Manual", action: "CREATE" as const };
  const records: BrandRecord[] = [{ ...base, id: "draft_brand_1", name: "Alpha" }, { ...base, id: "draft_brand_2", name: "Beta" }, { ...base, id: "draft_brand_3", name: "Gamma" }];
  const parsed = parseAdminUploadResults(`UnmappedBrandID,Status,ErrorMessage\ndraft_brand_1,SUCCESS,\ndraft_brand_2,FAILED,Target missing`);
  const applied = applyAdminUploadResultsToRecords(records, records.map((record) => record.id), parsed.rows, "results.csv", "2026-07-16T20:00:00.000Z", true);
  assert.equal(applied.successful[0].id, "draft_brand_1");
  assert.equal(applied.failed[0].status, "needs-review");
  assert.equal(applied.failed[0].adminUploadMessage, "Target missing");
  assert.deepEqual(applied.pending.map((record) => record.id), ["draft_brand_3"]);
});

test("recognizes a missing UBQ document and lets the reviewer mark it done", () => {
  const message = "The requested brand or product could not be found. Please verify the provided values and try again. MonstorError{errorKind=DOCUMENT_NOT_FOUND}";
  const parsed = parseAdminUploadResults(`UnmappedBrandID,UnmappedBrandName,Status,ErrorMessage\ndraft_brand_missing,Gone,FAILED,"${message}"`);
  assert.equal(parsed.rows[0].status, "NOT_FOUND");
  const summary = summarizeAdminUploadResults(["draft_brand_missing"], parsed.rows);
  assert.equal(summary.notFound.length, 1);
  assert.equal(summary.failed.length, 0);
  const record: BrandRecord = { id: "draft_brand_missing", name: "Gone", normalized: "Gone", confidence: 100, reason: "Approved", evidence: [], status: "reviewed", decisionSource: "Manual", action: "SKIP" };
  const pending = applyAdminUploadResultsToRecords([record], [record.id], parsed.rows, "results.csv", "2026-07-17T12:00:00.000Z", false);
  assert.equal(pending.pending.length, 1);
  const done = applyAdminUploadResultsToRecords([record], [record.id], parsed.rows, "results.csv", "2026-07-17T12:00:00.000Z", false, true);
  assert.equal(done.successful.length, 0);
  assert.equal(done.resolved.length, 1);
  assert.equal(done.resolved[0].triageResolution, "NOT_FOUND_IN_UBQ");
  assert.match(done.resolved[0].adminUploadMessage || "", /no longer present in UBQ/i);
});

test("recognizes already-existing Admin rows and closes them as completed elsewhere", () => {
  const parsed = parseAdminUploadResults(`UnmappedBrandID,UnmappedBrandName,Status,ErrorMessage\ndraft_brand_done,Bardhal,FAILED,"The requested brand or product already exists. Please verify the provided values and try again."`);
  assert.equal(parsed.rows[0].status, "ALREADY_EXISTS");
  const summary = summarizeAdminUploadResults(["draft_brand_done"], parsed.rows);
  assert.equal(summary.alreadyExists.length, 1);
  assert.equal(summary.failed.length, 0);
  const record: BrandRecord = { id: "draft_brand_done", name: "Bardhal", normalized: "Bardhal", confidence: 100, reason: "Approved", evidence: [], status: "reviewed", decisionSource: "Manual", action: "CREATE" };
  const done = applyAdminUploadResultsToRecords([record], [record.id], parsed.rows, "results.csv", "2026-07-22T14:25:00.000Z", false, true, "Bef");
  assert.equal(done.resolved.length, 1);
  assert.equal(done.resolved[0].triageResolution, "ALREADY_DONE");
  assert.equal(done.resolved[0].triageResolvedBy, "Bef");
  assert.equal(done.successful.length, 0);
});
