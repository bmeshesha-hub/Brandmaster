import assert from "node:assert/strict";
import test from "node:test";
import { classifyBrand } from "../lib/brand-engine";
import { EMPTY_DATA } from "../lib/storage";
import { AdminUpdateRun, LedgerEntry } from "../lib/types";
import { buildVerifiedLearningRegistry, learningRuleForInput } from "../lib/verified-learning";

function reviewed(action: LedgerEntry["action"] = "MERGE"): LedgerEntry {
  return {
    ledgerId: "ledger-1", date: "2026-08-01T10:00:00.000Z", id: "draft_brand_alpha", name: "Alpha OE", normalized: "Alpha",
    action, targetId: action === "MERGE" ? "brand_alpha" : undefined, targetName: action === "MERGE" || action === "CREATE" ? "Alpha" : undefined,
    confidence: 96, reason: "Reviewed with evidence", evidence: ["https://example.com/alpha"], status: "reviewed", reviewer: "Bef", decisionSource: "Manual override", workflowSource: "IMPORT",
  };
}

function run(status: AdminUpdateRun["items"][number]["status"], detail = "Verified by refreshed UBQ"): AdminUpdateRun {
  return {
    id: "run-1", filename: "admin.csv", exportedAt: "2026-08-01T11:00:00.000Z", exportedBy: "Bef", source: "UBQ",
    items: [{ id: "item-1", source: "UBQ", sourceId: "draft_brand_alpha", originalName: "Alpha OE", action: "MERGE", targetId: "brand_alpha", targetName: "Alpha", status, detail, lastCheckedAt: "2026-08-02T10:00:00.000Z", checkedAgainst: "ubq-new.csv" }],
  };
}

test("promotes reviewed decisions through Admin accepted and source verified trust", () => {
  const reviewedRegistry = buildVerifiedLearningRegistry({ ...EMPTY_DATA, ledger: [reviewed()] });
  assert.equal(reviewedRegistry.rules[0].trust, "REVIEWED");
  assert.equal(reviewedRegistry.rules[0].autoApplyEligible, false);

  const accepted = buildVerifiedLearningRegistry({ ...EMPTY_DATA, ledger: [reviewed()], adminUpdateRuns: [run("AWAITING_NEWER_DATA")] });
  assert.equal(accepted.rules[0].trust, "ADMIN_ACCEPTED");

  const verified = buildVerifiedLearningRegistry({ ...EMPTY_DATA, ledger: [reviewed()], adminUpdateRuns: [run("VERIFIED")] });
  assert.equal(verified.rules[0].trust, "SOURCE_VERIFIED");
  assert.equal(verified.rules[0].autoApplyEligible, true);
  assert.equal(verified.rules[0].confirmationCount, 1);
  assert.equal(verified.evidence.some((item) => item.type === "SOURCE_RECONCILIATION"), true);
});

test("contradictions block reuse and corrections remain visible", () => {
  const correction = { ...reviewed("CREATE"), ledgerId: "ledger-2", date: "2026-08-02T09:00:00.000Z", targetId: undefined, targetName: "Alpha" };
  const contradicted = buildVerifiedLearningRegistry({ ...EMPTY_DATA, ledger: [reviewed(), correction], adminUpdateRuns: [run("NOT_APPLIED", "Still present in UBQ")] });
  const rule = learningRuleForInput({ ...EMPTY_DATA, ledger: [reviewed()], adminUpdateRuns: [run("NOT_APPLIED", "Still present in UBQ")] }, "draft_brand_alpha", "Alpha")!.rule;
  assert.equal(rule.trust, "CONTRADICTED");
  assert.equal(rule.autoApplyEligible, false);
  assert.equal(contradicted.stats.corrections > 0, true);
});

test("source-verified exact BrandIDs auto-apply while contradicted rules return to review", () => {
  const root = { id: "brand_alpha", name: "Alpha", aliases: ["Alpha OE"], category: "Automotive", source: "Root" as const, rootStatus: "ACTIVE" };
  const verified = classifyBrand({ id: "draft_brand_alpha", name: "Alpha Original OE" }, { ...EMPTY_DATA, ledger: [reviewed()], adminUpdateRuns: [run("VERIFIED")], rootBrands: [root] });
  assert.equal(verified.action, "MERGE");
  assert.equal(verified.status, "ready");
  assert.equal(verified.decisionSource, "Verified learning · exact BrandID");

  const blocked = classifyBrand({ id: "draft_brand_alpha", name: "Alpha Original OE" }, { ...EMPTY_DATA, ledger: [reviewed()], adminUpdateRuns: [run("CONFLICT", "Target was not found")], rootBrands: [root] });
  assert.equal(blocked.action, "SKIP");
  assert.equal(blocked.status, "needs-review");
  assert.equal(blocked.decisionSource, "Contradicted learning rule");
});

test("verified families suggest matching normalized variants without auto-applying", () => {
  const root = { id: "brand_alpha", name: "Alpha", aliases: ["Alpha OE"], category: "Automotive", source: "Root" as const, rootStatus: "ACTIVE" };
  const suggestion = classifyBrand({ id: "draft_brand_alpha_new", name: "Alpha Genuine OE" }, { ...EMPTY_DATA, ledger: [reviewed()], adminUpdateRuns: [run("VERIFIED")], rootBrands: [root] });
  assert.equal(suggestion.action, "MERGE");
  assert.equal(suggestion.status, "needs-review");
  assert.equal(suggestion.decisionSource, "Verified family suggestion");
});

test("calibrates confidence against resolved Admin outcomes", () => {
  const registry = buildVerifiedLearningRegistry({ ...EMPTY_DATA, ledger: [reviewed()], adminUpdateRuns: [run("VERIFIED")] });
  assert.deepEqual(registry.calibration[0], { label: "90–100%", minimum: 90, maximum: 100, total: 1, verified: 1, contradicted: 0, pending: 0, successRate: 100 });
});
