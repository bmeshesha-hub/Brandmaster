import assert from "node:assert/strict";
import test from "node:test";
import { updateExportInclusion } from "../lib/export-worklist";
import { BrandRecord } from "../lib/types";

const closed: BrandRecord = {
  id: "draft_brand_1", name: "Alpha", normalized: "Alpha", action: "SKIP", confidence: 100,
  reason: "Closed without mapping", evidence: [], status: "reviewed", decisionSource: "Manual",
  excludedFromExport: false, triageResolution: "ALREADY_DONE", triageResolutionNote: "Previously closed",
  triageResolvedAt: "2026-08-03T10:00:00.000Z", triageResolvedBy: "Bef", adminUploadedAt: "2026-08-03T10:00:00.000Z",
};

test("including a visibly checked row clears hidden terminal fields that excluded it from CSV", () => {
  const restored = updateExportInclusion([closed], [closed.id], false)[0];
  assert.equal(restored.excludedFromExport, false);
  assert.equal(restored.triageResolution, undefined);
  assert.equal(restored.triageResolvedAt, undefined);
  assert.equal(restored.adminUploadedAt, undefined);
});

test("bulk inclusion updates only the selected rows", () => {
  const other = { ...closed, id: "draft_brand_2", name: "Beta" };
  const restored = updateExportInclusion([closed, other], [closed.id], false);
  assert.equal(restored[0].triageResolution, undefined);
  assert.equal(restored[1].triageResolution, "ALREADY_DONE");
});
