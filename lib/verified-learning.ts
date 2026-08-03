import { Action, AppData, LedgerEntry, LearningModerationEventType, LearningOverrideStatus, LearningRuleOverride } from "./types";

export type LearningTrust = "PROPOSED" | "REVIEWED" | "ADMIN_ACCEPTED" | "SOURCE_VERIFIED" | "CONTRADICTED";
export type LearningEvidenceType = "MARKETPLACE" | "OFFICIAL_WEBSITE" | "CATALOG" | "ADMIN_RESULT" | "SOURCE_RECONCILIATION" | "REVIEW_NOTE";

export interface LearningEvidence {
  value: string;
  type: LearningEvidenceType;
  firstSeenAt: string;
}

export interface LearningRule {
  id: string;
  sourceBrandId?: string;
  normalizedName: string;
  names: string[];
  action: Action;
  targetId?: string;
  targetName?: string;
  trust: LearningTrust;
  confidence: number;
  evidence: LearningEvidence[];
  reviewCount: number;
  confirmationCount: number;
  correctionCount: number;
  lastUpdatedAt: string;
  reviewer?: string;
  contradictionReason?: string;
  moderationStatus: LearningOverrideStatus;
  staleReasons: string[];
  isActive: boolean;
  mergedIntoRuleId?: string;
  excludedEvidenceCount: number;
  excludedEvidenceValues: string[];
  overrideNote?: string;
  provenance: { id: string; at: string; by?: string; type: string; note: string }[];
  autoApplyEligible: boolean;
}

export interface LearningFamily {
  id: string;
  targetId?: string;
  targetName: string;
  action: "CREATE" | "MERGE";
  variants: string[];
  normalizedVariants: string[];
  verifiedVariants: number;
  reviewedVariants: number;
  correctionCount: number;
}

export interface LearningCalibrationBucket {
  label: string;
  minimum: number;
  maximum: number;
  total: number;
  verified: number;
  contradicted: number;
  pending: number;
  successRate?: number;
}

export interface VerifiedLearningRegistry {
  rules: LearningRule[];
  families: LearningFamily[];
  evidence: LearningEvidence[];
  calibration: LearningCalibrationBucket[];
  stats: {
    proposed: number;
    reviewed: number;
    adminAccepted: number;
    sourceVerified: number;
    contradicted: number;
    autoApplyEligible: number;
    corrections: number;
    disabled: number;
    archived: number;
    stale: number;
  };
}

type LearningEvent = {
  identity: string;
  sourceBrandId?: string;
  normalizedName: string;
  name: string;
  action: Action;
  targetId?: string;
  targetName?: string;
  trust: LearningTrust;
  at: string;
  confidence: number;
  evidence: string[];
  reviewer?: string;
  contradictionReason?: string;
};

const trustRank: Record<Exclude<LearningTrust, "CONTRADICTED">, number> = { PROPOSED: 0, REVIEWED: 1, ADMIN_ACCEPTED: 2, SOURCE_VERIFIED: 3 };
const nameKey = (value: string) => value.trim().toLowerCase().replace(/[™®©]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const signature = (value: Pick<LearningEvent, "action" | "targetId" | "targetName">) => `${value.action}:${value.targetId || nameKey(value.targetName || "")}`;
const identityKey = (sourceBrandId: string | undefined, normalizedName: string) => sourceBrandId?.startsWith("draft_brand_") ? `id:${sourceBrandId}` : `name:${nameKey(normalizedName)}`;

function evidenceType(value: string, trust?: LearningTrust): LearningEvidenceType {
  if (trust === "SOURCE_VERIFIED") return "SOURCE_RECONCILIATION";
  if (trust === "ADMIN_ACCEPTED" || /admin/i.test(value)) return "ADMIN_RESULT";
  if (/ebay|amazon|walmart|marketplace/i.test(value)) return "MARKETPLACE";
  if (/catalog|part number|application guide|tecdoc|aces|pies/i.test(value)) return "CATALOG";
  if (/^https?:\/\//i.test(value)) return "OFFICIAL_WEBSITE";
  return "REVIEW_NOTE";
}

function decisionMatches(left: Pick<LearningEvent, "action" | "targetId" | "targetName">, right: Pick<LearningEvent, "action" | "targetId" | "targetName">) {
  return signature(left) === signature(right);
}

function ledgerForAdminItem(ledger: LedgerEntry[], sourceId: string, action: Action, targetId?: string, targetName?: string) {
  return ledger.filter((entry) => entry.id === sourceId && decisionMatches(entry, { action, targetId, targetName })).sort((left, right) => right.date.localeCompare(left.date))[0];
}

function eventsFromData(data: AppData) {
  const events: LearningEvent[] = [];
  data.ledger.filter((entry) => entry.workflowSource !== "ROOT").forEach((entry) => events.push({
    identity: identityKey(entry.id, entry.normalized), sourceBrandId: entry.id.startsWith("draft_brand_") ? entry.id : undefined,
    normalizedName: entry.normalized, name: entry.name, action: entry.action, targetId: entry.targetId, targetName: entry.targetName,
    trust: "REVIEWED", at: entry.date, confidence: entry.confidence, evidence: entry.evidence, reviewer: entry.reviewer,
  }));
  Object.entries(data.learned).forEach(([normalizedName, decision]) => events.push({
    identity: identityKey(undefined, normalizedName), normalizedName, name: normalizedName, action: decision.action, targetId: decision.targetId, targetName: decision.targetName,
    trust: decision.verification === "ADMIN_VERIFIED" ? "SOURCE_VERIFIED" : decision.origin === "imported" ? "PROPOSED" : "REVIEWED",
    at: decision.verifiedAt || decision.reviewedAt, confidence: decision.verification === "ADMIN_VERIFIED" ? 100 : 90, evidence: [decision.reason],
  }));
  data.adminUpdateRuns.forEach((run) => run.items.forEach((item) => {
    const matchedLedger = ledgerForAdminItem(data.ledger, item.sourceId, item.action, item.targetId, item.targetName);
    const trust: LearningTrust = item.status === "VERIFIED" ? "SOURCE_VERIFIED"
      : ["NOT_APPLIED", "CONFLICT", "CANNOT_VERIFY"].includes(item.status) ? "CONTRADICTED"
        : item.status === "AWAITING_NEWER_DATA" || item.status === "PARTIALLY_APPLIED" ? "ADMIN_ACCEPTED" : "PROPOSED";
    const normalizedName = matchedLedger?.normalized || item.originalName;
    events.push({
      identity: identityKey(item.source === "UBQ" ? item.sourceId : undefined, normalizedName),
      sourceBrandId: item.source === "UBQ" && item.sourceId.startsWith("draft_brand_") ? item.sourceId : undefined,
      normalizedName, name: item.originalName, action: item.action, targetId: item.actualTargetId || item.targetId, targetName: item.actualTargetName || item.targetName,
      trust, at: item.lastCheckedAt || run.exportedAt, confidence: matchedLedger?.confidence || (trust === "SOURCE_VERIFIED" ? 100 : 90),
      evidence: [...(matchedLedger?.evidence || []), item.detail, item.checkedAgainst ? `Checked against ${item.checkedAgainst}` : `Admin run ${run.filename}`], reviewer: matchedLedger?.reviewer || run.exportedBy,
      contradictionReason: trust === "CONTRADICTED" ? item.detail : undefined,
    });
  }));
  return events;
}

function buildRule(identity: string, input: LearningEvent[]): LearningRule {
  const events = [...input].sort((left, right) => left.at.localeCompare(right.at));
  const latest = events.at(-1)!;
  const currentSignature = signature(latest);
  const currentEvents = events.filter((event) => signature(event) === currentSignature);
  const latestContradiction = [...currentEvents].reverse().find((event) => event.trust === "CONTRADICTED");
  const latestPositive = [...currentEvents].reverse().find((event) => event.trust !== "CONTRADICTED");
  const contradicted = Boolean(latestContradiction && (!latestPositive || latestContradiction.at >= latestPositive.at));
  const positiveTrust = currentEvents.filter((event): event is LearningEvent & { trust: Exclude<LearningTrust, "CONTRADICTED"> } => event.trust !== "CONTRADICTED").sort((left, right) => trustRank[right.trust] - trustRank[left.trust])[0]?.trust || "PROPOSED";
  const trust: LearningTrust = contradicted ? "CONTRADICTED" : positiveTrust;
  let correctionCount = 0;
  events.reduce<string | undefined>((previous, event) => { const current = signature(event); if (previous && current !== previous) correctionCount += 1; return current; }, undefined);
  const evidence = new Map<string, LearningEvidence>();
  currentEvents.forEach((event) => event.evidence.filter(Boolean).forEach((value) => {
    if (!evidence.has(value)) evidence.set(value, { value, type: evidenceType(value, event.trust), firstSeenAt: event.at });
  }));
  const confirmationCount = currentEvents.filter((event) => event.trust === "SOURCE_VERIFIED").length;
  const sourceBrandId = latest.sourceBrandId || events.find((event) => event.sourceBrandId)?.sourceBrandId;
  return {
    id: `learning:${identity}`, sourceBrandId, normalizedName: latest.normalizedName,
    names: [...new Set(events.map((event) => event.name).filter(Boolean))], action: latest.action, targetId: latest.targetId, targetName: latest.targetName,
    trust, confidence: contradicted ? Math.min(40, latest.confidence) : Math.max(...currentEvents.map((event) => event.confidence)), evidence: [...evidence.values()],
    reviewCount: currentEvents.filter((event) => event.trust === "REVIEWED").length, confirmationCount, correctionCount,
    lastUpdatedAt: events.map((event) => event.at).sort().at(-1)!, reviewer: [...currentEvents].reverse().find((event) => event.reviewer)?.reviewer,
    contradictionReason: latestContradiction?.contradictionReason,
    moderationStatus: "ACTIVE", staleReasons: [], isActive: true, excludedEvidenceCount: 0, excludedEvidenceValues: [],
    provenance: events.map((event, index) => ({ id: `${identity}:${event.at}:${index}`, at: event.at, by: event.reviewer, type: event.trust, note: `${event.action}${event.targetName ? ` → ${event.targetName}` : ""}${event.contradictionReason ? ` · ${event.contradictionReason}` : ""}` })).reverse(),
    autoApplyEligible: !contradicted && trust === "SOURCE_VERIFIED" && Boolean(sourceBrandId),
  };
}

const STALE_AFTER_MS = 180 * 86_400_000;
function activeRootTarget(data: AppData, id?: string) {
  if (!id) return undefined;
  const byId = new Map(data.rootBrands.map((brand) => [brand.id, brand]));
  const seen = new Set<string>();
  let current = byId.get(id);
  while (current?.sameAs && !seen.has(current.id)) { seen.add(current.id); current = byId.get(current.sameAs); }
  return current && !seen.has(current.id) && (current.rootStatus || "ACTIVE") === "ACTIVE" ? current : undefined;
}
function latestSourceTime(data: AppData) {
  return [data.sourceMeta.UBQ?.updatedAt, data.sourceMeta.ROOT?.updatedAt, data.learningRegistryRebuiltAt].filter((value): value is string => Boolean(value)).sort().at(-1);
}
function applyModeration(rule: LearningRule, data: AppData): LearningRule {
  const override = data.learningOverrides?.[rule.id];
  const corrected = Boolean(override?.events.some((event) => event.type === "CORRECTED" && event.at >= rule.lastUpdatedAt));
  const trust: LearningTrust = corrected ? "REVIEWED" : rule.trust;
  const action = override?.action || rule.action;
  const targetId = override && "targetId" in override ? override.targetId : rule.targetId;
  const targetName = override && "targetName" in override ? override.targetName : rule.targetName;
  const confidence = override?.confidence ?? rule.confidence;
  const excluded = new Set(override?.excludedEvidence || []);
  const evidence = rule.evidence.filter((item) => !excluded.has(item.value));
  const staleReasons: string[] = [];
  if (action === "MERGE" && targetId && data.rootBrands.length && !activeRootTarget(data, targetId)) staleReasons.push("MERGE target is missing, inactive, redirected, or blocked in the current Root table.");
  const sourceTime = latestSourceTime(data);
  if (sourceTime && trust === "SOURCE_VERIFIED" && new Date(sourceTime).getTime() - new Date(rule.lastUpdatedAt).getTime() > STALE_AFTER_MS) staleReasons.push("Source verification is more than 180 days older than the latest source refresh.");
  if (!evidence.length && action !== "SKIP") staleReasons.push("All supporting evidence has been excluded.");
  const moderationStatus = override?.status || "ACTIVE";
  const isActive = moderationStatus === "ACTIVE" && trust !== "CONTRADICTED" && staleReasons.length === 0 && !override?.mergedIntoRuleId;
  return {
    ...rule, action, targetId, targetName, confidence, trust, evidence, moderationStatus, staleReasons, isActive,
    mergedIntoRuleId: override?.mergedIntoRuleId, excludedEvidenceCount: excluded.size, excludedEvidenceValues: [...excluded], overrideNote: override?.note,
    provenance: [...(override?.events || []).map((event) => ({ id: event.id, at: event.at, by: event.by, type: event.type, note: event.note })), ...rule.provenance].sort((left, right) => right.at.localeCompare(left.at)),
    correctionCount: rule.correctionCount + (corrected ? 1 : 0), lastUpdatedAt: override?.updatedAt || rule.lastUpdatedAt,
    autoApplyEligible: rule.autoApplyEligible && isActive && !corrected,
  };
}

function mergeModeratedIdentities(rules: LearningRule[]) {
  const byId = new Map(rules.map((rule) => [rule.id, rule]));
  rules.forEach((source) => {
    if (!source.mergedIntoRuleId) return;
    const target = byId.get(source.mergedIntoRuleId);
    if (!target || target.id === source.id) return;
    byId.set(target.id, {
      ...target,
      names: [...new Set([...target.names, ...source.names])],
      evidence: [...new Map([...target.evidence, ...source.evidence].map((item) => [item.value, item])).values()],
      provenance: [...target.provenance, { id: `merged:${source.id}`, at: source.lastUpdatedAt, type: "IDENTITY_MERGED", note: `Merged identity ${source.names[0] || source.normalizedName} into this rule.` }].sort((left, right) => right.at.localeCompare(left.at)),
    });
  });
  return rules.map((rule) => byId.get(rule.id) || rule);
}

function buildFamilies(rules: LearningRule[]) {
  const grouped = new Map<string, LearningRule[]>();
  rules.filter((rule) => rule.isActive && (rule.action === "MERGE" || rule.action === "CREATE") && (rule.targetId || rule.targetName)).forEach((rule) => {
    const key = `${rule.action}:${rule.targetId || nameKey(rule.targetName || "")}`;
    grouped.set(key, [...(grouped.get(key) || []), rule]);
  });
  return [...grouped.entries()].map(([id, members]): LearningFamily => ({
    id: `family:${id}`, targetId: members[0].targetId, targetName: members[0].targetName || members[0].normalizedName, action: members[0].action as "CREATE" | "MERGE",
    variants: [...new Set(members.flatMap((member) => member.names))].sort(), normalizedVariants: [...new Set(members.map((member) => member.normalizedName))].sort(), verifiedVariants: members.filter((member) => member.trust === "SOURCE_VERIFIED").length,
    reviewedVariants: members.filter((member) => member.trust === "REVIEWED" || member.trust === "ADMIN_ACCEPTED").length,
    correctionCount: members.reduce((total, member) => total + member.correctionCount, 0),
  })).sort((left, right) => right.variants.length - left.variants.length || left.targetName.localeCompare(right.targetName));
}

function calibration(data: AppData): LearningCalibrationBucket[] {
  const buckets: LearningCalibrationBucket[] = [
    { label: "90–100%", minimum: 90, maximum: 100, total: 0, verified: 0, contradicted: 0, pending: 0 },
    { label: "70–89%", minimum: 70, maximum: 89, total: 0, verified: 0, contradicted: 0, pending: 0 },
    { label: "Below 70%", minimum: 0, maximum: 69, total: 0, verified: 0, contradicted: 0, pending: 0 },
  ];
  data.adminUpdateRuns.flatMap((run) => run.items).forEach((item) => {
    const reviewed = ledgerForAdminItem(data.ledger, item.sourceId, item.action, item.targetId, item.targetName);
    const confidence = reviewed?.confidence ?? 100;
    const bucket = buckets.find((candidate) => confidence >= candidate.minimum && confidence <= candidate.maximum)!;
    bucket.total += 1;
    if (item.status === "VERIFIED") bucket.verified += 1;
    else if (["NOT_APPLIED", "CONFLICT", "CANNOT_VERIFY"].includes(item.status)) bucket.contradicted += 1;
    else bucket.pending += 1;
  });
  buckets.forEach((bucket) => { const resolved = bucket.verified + bucket.contradicted; bucket.successRate = resolved ? Math.round(bucket.verified / resolved * 100) : undefined; });
  return buckets;
}

const registryCache = new WeakMap<AppData, VerifiedLearningRegistry>();

export function buildVerifiedLearningRegistry(data: AppData): VerifiedLearningRegistry {
  const cached = registryCache.get(data); if (cached) return cached;
  const grouped = new Map<string, LearningEvent[]>();
  eventsFromData(data).forEach((event) => grouped.set(event.identity, [...(grouped.get(event.identity) || []), event]));
  const rules = mergeModeratedIdentities([...grouped.entries()].map(([identity, events]) => applyModeration(buildRule(identity, events), data))).sort((left, right) => right.lastUpdatedAt.localeCompare(left.lastUpdatedAt));
  const allEvidence = new Map<string, LearningEvidence>();
  rules.filter((rule) => rule.isActive).flatMap((rule) => rule.evidence).forEach((item) => { if (!allEvidence.has(item.value)) allEvidence.set(item.value, item); });
  const registry: VerifiedLearningRegistry = {
    rules, families: buildFamilies(rules), evidence: [...allEvidence.values()].sort((left, right) => right.firstSeenAt.localeCompare(left.firstSeenAt)), calibration: calibration(data),
    stats: {
      proposed: rules.filter((rule) => rule.trust === "PROPOSED").length, reviewed: rules.filter((rule) => rule.trust === "REVIEWED").length,
      adminAccepted: rules.filter((rule) => rule.trust === "ADMIN_ACCEPTED").length, sourceVerified: rules.filter((rule) => rule.trust === "SOURCE_VERIFIED").length,
      contradicted: rules.filter((rule) => rule.trust === "CONTRADICTED").length, autoApplyEligible: rules.filter((rule) => rule.autoApplyEligible).length,
      corrections: rules.reduce((total, rule) => total + rule.correctionCount, 0),
      disabled: rules.filter((rule) => rule.moderationStatus === "DISABLED").length, archived: rules.filter((rule) => rule.moderationStatus === "ARCHIVED").length,
      stale: rules.filter((rule) => rule.staleReasons.length > 0).length,
    },
  };
  registryCache.set(data, registry);
  return registry;
}

export function learningRuleForInput(data: AppData, sourceBrandId: string, normalizedName: string) {
  const registry = buildVerifiedLearningRegistry(data);
  const exact = registry.rules.find((rule) => rule.sourceBrandId === sourceBrandId);
  if (exact?.mergedIntoRuleId) {
    const merged = registry.rules.find((rule) => rule.id === exact.mergedIntoRuleId && rule.isActive);
    if (merged) return { rule: merged, match: "MERGED_IDENTITY" as const };
  }
  if (exact?.isActive || (exact?.trust === "CONTRADICTED" && exact.moderationStatus === "ACTIVE")) return { rule: exact, match: "EXACT_ID" as const };
  if (exact) return { rule: exact, match: "INACTIVE_RULE" as const };
  const key = nameKey(normalizedName);
  const byName = registry.rules.filter((rule) => nameKey(rule.normalizedName) === key && !rule.sourceBrandId).sort((left, right) => right.lastUpdatedAt.localeCompare(left.lastUpdatedAt));
  const rule = byName.find((candidate) => candidate.isActive || (candidate.trust === "CONTRADICTED" && candidate.moderationStatus === "ACTIVE"));
  if (rule) return { rule, match: "NORMALIZED_NAME" as const };
  return byName[0] ? { rule: byName[0], match: "INACTIVE_RULE" as const } : undefined;
}

export function updateLearningOverride(current: LearningRuleOverride | undefined, ruleId: string, changes: Partial<Omit<LearningRuleOverride, "ruleId" | "updatedAt" | "updatedBy" | "events">>, type: LearningModerationEventType, by: string, note: string, at = new Date().toISOString()): LearningRuleOverride {
  return {
    ruleId, status: changes.status || current?.status || "ACTIVE", action: changes.action ?? current?.action,
    targetId: "targetId" in changes ? changes.targetId : current?.targetId, targetName: "targetName" in changes ? changes.targetName : current?.targetName,
    confidence: changes.confidence ?? current?.confidence, mergedIntoRuleId: "mergedIntoRuleId" in changes ? changes.mergedIntoRuleId : current?.mergedIntoRuleId,
    excludedEvidence: changes.excludedEvidence || current?.excludedEvidence || [], note: changes.note ?? current?.note,
    updatedAt: at, updatedBy: by, events: [{ id: `learning-event:${at}:${Math.random().toString(36).slice(2, 8)}`, type, at, by, note }, ...(current?.events || [])].slice(0, 100),
  };
}

export function rebuildLearningModeration(data: AppData, by: string, at = new Date().toISOString()) {
  const base = buildVerifiedLearningRegistry({ ...data, learningOverrides: {}, learningRegistryRebuiltAt: undefined, learningRegistryRebuiltBy: undefined });
  const overrides = { ...(data.learningOverrides || {}) };
  const summary = { disabled: 0, archived: 0, unchanged: 0 };
  base.rules.forEach((rule) => {
    const current = overrides[rule.id];
    if (current && (current.status !== "ACTIVE" || current.action || current.targetId || current.targetName || current.mergedIntoRuleId || current.excludedEvidence.length)) { summary.unchanged += 1; return; }
    const latestSource = latestSourceTime(data) || at;
    const oldProposed = rule.trust === "PROPOSED" && new Date(latestSource).getTime() - new Date(rule.lastUpdatedAt).getTime() > STALE_AFTER_MS;
    if (oldProposed) {
      overrides[rule.id] = updateLearningOverride(current, rule.id, { status: "ARCHIVED" }, "REBUILT", by, "Archived unverified memory older than 180 days during registry rebuild.", at); summary.archived += 1;
    } else if (rule.trust === "CONTRADICTED" || (rule.action === "MERGE" && rule.targetId && data.rootBrands.length && !activeRootTarget(data, rule.targetId))) {
      overrides[rule.id] = updateLearningOverride(current, rule.id, { status: "DISABLED" }, "REBUILT", by, rule.trust === "CONTRADICTED" ? "Disabled a contradicted rule during registry rebuild." : "Disabled a rule whose Root target is no longer active.", at); summary.disabled += 1;
    } else summary.unchanged += 1;
  });
  return { overrides, summary };
}

/** A verified family may suggest a result for another exact normalized spelling, but never auto-applies it. */
export function learningFamilyForInput(data: AppData, normalizedName: string) {
  const key = nameKey(normalizedName);
  const matches = buildVerifiedLearningRegistry(data).families.filter((family) => family.verifiedVariants > 0 && family.normalizedVariants.some((variant) => nameKey(variant) === key));
  const targets = new Set(matches.map((family) => `${family.action}:${family.targetId || nameKey(family.targetName)}`));
  return targets.size === 1 ? matches[0] : undefined;
}
