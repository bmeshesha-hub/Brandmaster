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
