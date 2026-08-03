import assert from "node:assert/strict";
import test from "node:test";
import { classifyBrand } from "../lib/brand-engine";
import { enqueueLearningRuleReview } from "../lib/priority-queue";
import { EMPTY_DATA } from "../lib/storage";
import { AdminUpdateRun, LedgerEntry } from "../lib/types";
import { buildVerifiedLearningRegistry, learningRuleForInput, reactivateVerifiedQueuedLearning, rebuildLearningModeration, updateLearningOverride } from "../lib/verified-learning";

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

test("disabled rules cannot influence triage through VLR or legacy decision memory", () => {
  const ruleId = "learning:id:draft_brand_alpha";
  const learningOverrides = {
    [ruleId]: updateLearningOverride(undefined, ruleId, { status: "DISABLED" }, "DISABLED", "admin", "Bad historical rule.", "2026-08-03T12:00:00.000Z"),
  };
  const data = { ...EMPTY_DATA, ledger: [reviewed()], adminUpdateRuns: [run("VERIFIED")], learningOverrides };
  const match = learningRuleForInput(data, "draft_brand_alpha", "Alpha");
  assert.equal(match?.match, "INACTIVE_RULE");
  assert.equal(match?.rule.isActive, false);

  const classified = classifyBrand({ id: "draft_brand_alpha", name: "Alpha Original OE" }, data);
  assert.notEqual(classified.decisionSource, "Verified learning · exact BrandID");
  assert.notEqual(classified.decisionSource, "Previous reviewed BrandID decision");
});

test("a correction restores contradicted knowledge for review without silently auto-applying it", () => {
  const ruleId = "learning:id:draft_brand_alpha";
  const learningOverrides = {
    [ruleId]: updateLearningOverride(undefined, ruleId, { status: "ACTIVE", action: "CREATE", targetId: undefined, targetName: "Alpha" }, "CORRECTED", "admin", "Corrected after reviewing the current source.", "2026-08-03T12:00:00.000Z"),
  };
  const registry = buildVerifiedLearningRegistry({ ...EMPTY_DATA, ledger: [reviewed()], adminUpdateRuns: [run("CONFLICT", "Target was not found")], learningOverrides });
  const rule = registry.rules.find((candidate) => candidate.id === ruleId)!;
  assert.equal(rule.action, "CREATE");
  assert.equal(rule.trust, "REVIEWED");
  assert.equal(rule.isActive, true);
  assert.equal(rule.autoApplyEligible, false);
  assert.equal(rule.provenance[0].type, "CORRECTED");
});

test("excluding bad evidence preserves it in the audit trail and can make the rule stale", () => {
  const ruleId = "learning:id:draft_brand_alpha";
  const excludedEvidence = ["https://example.com/alpha", "Verified by refreshed UBQ", "Checked against ubq-new.csv"];
  const learningOverrides = {
    [ruleId]: updateLearningOverride(undefined, ruleId, { excludedEvidence }, "EVIDENCE_EXCLUDED", "admin", "Removed outdated evidence from active use.", "2026-08-03T12:00:00.000Z"),
  };
  const registry = buildVerifiedLearningRegistry({ ...EMPTY_DATA, ledger: [reviewed()], adminUpdateRuns: [run("VERIFIED")], learningOverrides });
  const rule = registry.rules.find((candidate) => candidate.id === ruleId)!;
  assert.equal(rule.evidence.length, 0);
  assert.equal(rule.excludedEvidenceCount, 3);
  assert.deepEqual(rule.excludedEvidenceValues.sort(), excludedEvidence.sort());
  assert.equal(rule.isActive, false);
  assert.match(rule.staleReasons.join(" "), /All supporting evidence/);
  assert.equal(rule.provenance.some((event) => event.type === "EVIDENCE_EXCLUDED"), true);
});

test("merged identities resolve to one active canonical rule", () => {
  const beta = { ...reviewed(), ledgerId: "ledger-2", id: "draft_brand_beta", name: "Alpha Genuine", normalized: "Alpha Genuine" };
  const sourceRuleId = "learning:id:draft_brand_alpha";
  const targetRuleId = "learning:id:draft_brand_beta";
  const learningOverrides = {
    [sourceRuleId]: updateLearningOverride(undefined, sourceRuleId, { status: "ARCHIVED", mergedIntoRuleId: targetRuleId }, "IDENTITY_MERGED", "admin", "Merged duplicate identity.", "2026-08-03T12:00:00.000Z"),
  };
  const data = { ...EMPTY_DATA, ledger: [reviewed(), beta], learningOverrides };
  const match = learningRuleForInput(data, "draft_brand_alpha", "Alpha");
  assert.equal(match?.match, "MERGED_IDENTITY");
  assert.equal(match?.rule.id, targetRuleId);
  assert.equal(match?.rule.names.includes("Alpha OE"), true);
});

test("registry rebuild archives old proposals and disables contradicted rules", () => {
  const data = {
    ...EMPTY_DATA,
    learned: { "Old import": { action: "SKIP" as const, reason: "Imported without verification", reviewedAt: "2025-01-01T00:00:00.000Z", origin: "imported" as const } },
    ledger: [reviewed()],
    adminUpdateRuns: [run("CONFLICT", "Target was not found")],
    sourceMeta: { UBQ: { filename: "current.csv", updatedAt: "2026-08-03T00:00:00.000Z", rowCount: 1 } },
  };
  const rebuilt = rebuildLearningModeration(data, "admin", "2026-08-03T12:00:00.000Z");
  assert.equal(rebuilt.summary.archived, 1);
  assert.equal(rebuilt.summary.disabled, 1);
  assert.equal(rebuilt.overrides["learning:name:old import"].status, "ARCHIVED");
  assert.equal(rebuilt.overrides["learning:id:draft_brand_alpha"].status, "DISABLED");
});

test("a verified MERGE becomes stale when its Root target disappears", () => {
  const data = { ...EMPTY_DATA, ledger: [reviewed()], adminUpdateRuns: [run("VERIFIED")], rootBrands: [{ id: "brand_other", name: "Other", aliases: [], category: "Automotive", source: "Root" as const }] };
  const rule = buildVerifiedLearningRegistry(data).rules[0];
  assert.equal(rule.isActive, false);
  assert.equal(rule.autoApplyEligible, false);
  assert.match(rule.staleReasons.join(" "), /Root table/);
});

test("sending a VLR correction to the team queue intentionally reopens matching completed work", () => {
  const completed = {
    id: "priority:mapping%3Aalpha", taskKey: "mapping:alpha", brandId: "draft_brand_alpha", name: "Alpha OE", source: "UBQ" as const,
    status: "COMPLETED" as const, externalStatus: "VERIFIED" as const, completedAt: "2026-08-01T00:00:00.000Z", verifiedAt: "2026-08-02T00:00:00.000Z",
    finalAction: "MERGE" as const, finalTargetId: "brand_old", finalTargetName: "Old Alpha", finalReason: "Old decision",
    createdAt: "2026-08-01T00:00:00.000Z", createdBy: "Bef", updatedAt: "2026-08-02T00:00:00.000Z", activity: [],
  };
  const queue = enqueueLearningRuleReview([completed], {
    ruleId: "learning:id:draft_brand_alpha", brandId: "draft_brand_alpha", name: "Alpha OE", action: "MERGE", targetId: "brand_alpha", targetName: "Alpha",
    note: "The old target is wrong.", evidence: ["Current catalog"], createdBy: "Bef", at: "2026-08-03T12:00:00.000Z",
  });
  assert.equal(queue.length, 1);
  assert.equal(queue[0].status, "UNASSIGNED");
  assert.equal(queue[0].externalStatus, "NOT_STARTED");
  assert.equal(queue[0].finalAction, undefined);
  assert.equal(queue[0].learningRuleId, "learning:id:draft_brand_alpha");
  assert.equal(queue[0].requestedTargetId, "brand_alpha");
  assert.equal(queue[0].activity?.[0].type, "REOPENED");
});

test("a queued VLR correction reactivates only after newer UBQ verification", () => {
  const ruleId = "learning:id:draft_brand_alpha";
  const disabled = updateLearningOverride(undefined, ruleId, { status: "DISABLED", action: "CREATE", targetName: "Alpha" }, "SENT_TO_QUEUE", "Bef", "Needs Admin correction.", "2026-08-03T10:00:00.000Z");
  const pendingData = { ...EMPTY_DATA, learningOverrides: { [ruleId]: disabled }, priorityQueue: [{
    id: "priority:mapping%3Aalpha", brandId: "draft_brand_alpha", name: "Alpha OE", source: "UBQ" as const, status: "COMPLETED" as const,
    externalStatus: "EXPORTED_PENDING_VERIFICATION" as const, finalAction: "CREATE" as const, finalTargetName: "Alpha", learningRuleId: ruleId,
    createdAt: "2026-08-03T10:00:00.000Z", createdBy: "Bef", updatedAt: "2026-08-03T11:00:00.000Z",
  }] };
  assert.equal(reactivateVerifiedQueuedLearning(pendingData, "UBQ import").reactivated, 0);

  const verifiedData = { ...pendingData, priorityQueue: pendingData.priorityQueue.map((item) => ({ ...item, externalStatus: "VERIFIED" as const })) };
  const result = reactivateVerifiedQueuedLearning(verifiedData, "UBQ import · current.csv", "2026-08-04T12:00:00.000Z");
  assert.equal(result.reactivated, 1);
  assert.equal(result.overrides[ruleId].status, "ACTIVE");
  assert.equal(result.overrides[ruleId].events[0].type, "ACTIVATED");
  assert.match(result.overrides[ruleId].events[0].note, /newer UBQ/);
});
