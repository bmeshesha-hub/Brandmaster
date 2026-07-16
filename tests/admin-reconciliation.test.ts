import assert from "node:assert/strict";
import test from "node:test";
import { adminRunFromRecords, reconcileAdminRuns } from "../lib/admin-reconciliation";
import { BrandRecord, CatalogBrand } from "../lib/types";

const base: Omit<BrandRecord, "id" | "name" | "normalized" | "action"> = { confidence: 100, reason: "Approved", evidence: [], status: "reviewed", decisionSource: "Manual" };
const roots: CatalogBrand[] = [{ id: "brand_bmw", name: "BMW", aliases: ["BMW OE"], category: "Automotive", source: "Root", rootStatus: "ACTIVE" }];

test("reconciliation keeps a UBQ action pending until a newer source import", () => {
  const record: BrandRecord = { ...base, id: "draft_brand_bmw", name: "BMW OE", normalized: "BMW", action: "MERGE", targetId: "brand_bmw", targetName: "BMW" };
  const run = adminRunFromRecords("bulk.csv", "Mike", [record], "batch", "2026-07-16T10:00:00.000Z");
  const unchanged = reconcileAdminRuns([run], { source: "UBQ", filename: "old.csv", importedAt: "2026-07-16T09:00:00.000Z", ubqIds: new Set(), rootBrands: roots });
  assert.equal(unchanged[0].items[0].status, "AWAITING_NEWER_DATA");
});

test("reconciliation distinguishes not-applied and verified UBQ merges", () => {
  const record: BrandRecord = { ...base, id: "draft_brand_bmw", name: "BMW OE", normalized: "BMW", action: "MERGE", targetId: "brand_bmw", targetName: "BMW" };
  const run = adminRunFromRecords("bulk.csv", "Mike", [record], "batch", "2026-07-16T10:00:00.000Z");
  const present = reconcileAdminRuns([run], { source: "UBQ", filename: "new.csv", importedAt: "2026-07-16T11:00:00.000Z", ubqIds: new Set([record.id]), rootBrands: roots });
  assert.equal(present[0].items[0].status, "NOT_APPLIED");
  const gone = reconcileAdminRuns([run], { source: "UBQ", filename: "new.csv", importedAt: "2026-07-16T11:00:00.000Z", ubqIds: new Set(), rootBrands: roots });
  assert.equal(gone[0].items[0].status, "VERIFIED");
  assert.equal(gone[0].items[0].actualTargetId, "brand_bmw");
});

test("reconciliation reports partial CREATE when UBQ changed before Root caught up", () => {
  const record: BrandRecord = { ...base, id: "draft_brand_new", name: "Newco", normalized: "Newco", action: "CREATE", targetName: "Newco" };
  const run = adminRunFromRecords("bulk.csv", "Bef", [record], "batch", "2026-07-16T10:00:00.000Z");
  const checked = reconcileAdminRuns([run], { source: "UBQ", filename: "new.csv", importedAt: "2026-07-16T11:00:00.000Z", ubqIds: new Set(), rootBrands: roots });
  assert.equal(checked[0].items[0].status, "PARTIALLY_APPLIED");
  const confirmed = reconcileAdminRuns(checked, { source: "ROOT", filename: "root.csv", importedAt: "2026-07-16T12:00:00.000Z", ubqIds: new Set(), rootBrands: [...roots, { id: "brand_new", name: "Newco", aliases: [], category: "Automotive", source: "Root" }] });
  assert.equal(confirmed[0].items[0].status, "VERIFIED");
  assert.equal(confirmed[0].items[0].actualTargetId, "brand_new");
});
