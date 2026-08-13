import assert from "node:assert/strict";
import test from "node:test";
import { buildOfflineRootReport, normalizeRootRows } from "../lib/offline-root-cleanup";

test("offline processor normalizes Root JSON and emits conservative changes", () => {
  const brands = normalizeRootRows([{ id: "a", name: "Toyota", aliases: ["Toyota"] }, { id: "b", name: "TOYOTA", aliases: [] }, { id: "c", name: "Unknown", aliases: [] }]);
  const report = buildOfflineRootReport(brands);
  assert.equal(report.inputRows, 3);
  assert.equal(report.issueCounts.DUPLICATE, 1);
  assert.equal(report.issueCounts.JUNK, 1);
  assert.equal(report.suggestedChanges.length, 2);
});

test("review decision payload is not mistaken for a Root table", () => {
  assert.throws(() => normalizeRootRows({ schemaVersion: "brandmaster.ai-review.v1", decisions: [] }), /rootBrands, brands, or rows/);
});
