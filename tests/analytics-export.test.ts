import assert from "node:assert/strict";
import test from "node:test";
import { analyticsExcelXml } from "../lib/analytics-export";
import { BrandRecord } from "../lib/types";

test("builds an Excel-readable analytics workbook with Admin outcomes", () => {
  const record: BrandRecord = { id: "draft_brand_1", name: "A & B", normalized: "A B", action: "CREATE", targetName: "A & B", confidence: 100, reason: "Approved", evidence: [], status: "reviewed", decisionSource: "Manual", adminUploadStatus: "SUCCESS", adminUploadedAt: "2026-07-16T20:00:00.000Z" };
  const workbook = analyticsExcelXml([{ date: "2026-07-16T19:00:00.000Z", action: "CREATE", reviewer: "Bef" }], [record], [], "2026-07-16T21:00:00.000Z");
  assert.match(workbook, /Worksheet ss:Name="Summary"/);
  assert.match(workbook, /Worksheet ss:Name="Admin Outcomes"/);
  assert.match(workbook, /A &amp; B/);
  assert.match(workbook, /Admin successful/);
});
