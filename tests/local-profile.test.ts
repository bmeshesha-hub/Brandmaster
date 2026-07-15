import assert from "node:assert/strict";
import test from "node:test";
import { localProfileIdentity, migrateAppIdentity, normalizeLocalUsername, validLocalUsername } from "../lib/local-profile";
import { EMPTY_DATA } from "../lib/storage";

test("normalizes and validates a local eBay username", () => {
  assert.equal(normalizeLocalUsername("  @bmeshesha  "), "bmeshesha");
  assert.equal(validLocalUsername("bmeshesha"), true);
  assert.equal(validLocalUsername("name with spaces"), false);
  assert.equal(localProfileIdentity({ username: "bmeshesha", deviceId: "A7K2", createdAt: "2026-07-15T00:00:00.000Z" }), "bmeshesha · A7K2");
  assert.equal(localProfileIdentity({ username: "bmeshesha", deviceId: "A7K2", createdAt: "2026-07-15T00:00:00.000Z", verifiedLogin: "bmeshesha" }), "bmeshesha");
});

test("migrates local attribution to a verified GitHub identity", () => {
  const migrated = migrateAppIdentity({
    ...EMPTY_DATA,
    batches: [{ id: "batch", filename: "brands.csv", createdAt: "2026-07-15T00:00:00.000Z", rows: 1, records: [{ id: "draft_brand_1", name: "Alpha", normalized: "Alpha", action: "CREATE", targetName: "Alpha", confidence: 100, reason: "Reviewed", evidence: [], status: "reviewed", reviewer: "Local user", decisionSource: "Manual" }] }],
    ledger: [{ id: "draft_brand_1", ledgerId: "ledger-1", date: "2026-07-15T00:00:00.000Z", name: "Alpha", normalized: "Alpha", action: "CREATE", targetName: "Alpha", confidence: 100, reason: "Reviewed", evidence: [], status: "reviewed", reviewer: "You", decisionSource: "Manual" }],
    priorityQueue: [{ id: "priority-1", brandId: "draft_brand_1", name: "Alpha", source: "UBQ", status: "ASSIGNED", assignedTo: "Local user", createdAt: "2026-07-15T00:00:00.000Z", createdBy: "Local user", updatedAt: "2026-07-15T00:00:00.000Z" }],
    rootChanges: { brand_1: { id: "brand_1", type: "UPDATE", after: { id: "brand_1", name: "Alpha", aliases: [], category: "Automotive" }, changedFields: ["name"], updatedAt: "2026-07-15T00:00:00.000Z", adminUpdatedBy: "You" } },
  }, ["Local user", "You"], "bmeshesha");
  assert.equal(migrated.batches[0].records[0].reviewer, "bmeshesha");
  assert.equal(migrated.ledger[0].reviewer, "bmeshesha");
  assert.equal(migrated.priorityQueue[0].assignedTo, "bmeshesha");
  assert.equal(migrated.priorityQueue[0].createdBy, "bmeshesha");
  assert.equal(migrated.rootChanges.brand_1.adminUpdatedBy, "bmeshesha");
});
