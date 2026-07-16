import { normalizeBrand } from "./brand-engine";
import { AdminUpdateItem, AdminUpdateRun, BrandRecord, CatalogBrand, PriorityQueueItem, ReconciliationStatus, RootTableChange } from "./types";

type SourceContext = { source: "UBQ" | "ROOT"; filename: string; importedAt: string; ubqIds: Set<string>; rootBrands: CatalogBrand[] };

function result(item: AdminUpdateItem, status: ReconciliationStatus, detail: string, context: SourceContext, actual?: CatalogBrand): AdminUpdateItem {
  return { ...item, status, detail, lastCheckedAt: context.importedAt, checkedAgainst: context.filename, actualTargetId: actual?.id, actualTargetName: actual?.name };
}

function findRoot(item: AdminUpdateItem, brands: CatalogBrand[]) {
  if (item.targetId) {
    const exact = brands.find((brand) => brand.id === item.targetId);
    if (exact) return exact;
  }
  const name = normalizeBrand(item.targetName || item.originalName).toLowerCase();
  return brands.find((brand) => normalizeBrand(brand.name).toLowerCase() === name || brand.aliases.some((alias) => normalizeBrand(alias).toLowerCase() === name));
}

function reconcileUbq(item: AdminUpdateItem, context: SourceContext) {
  if (context.ubqIds.has(item.sourceId)) return result(item, "NOT_APPLIED", "The unmapped BrandID is still present in the refreshed UBQ export.", context);
  if (item.action === "MERGE") {
    const target = findRoot(item, context.rootBrands);
    if (!target) return result(item, "CONFLICT", "The UBQ row disappeared, but the expected target brand is missing from the Root table.", context);
    const aliasFound = target.aliases.some((alias) => normalizeBrand(alias).toLowerCase() === normalizeBrand(item.originalName).toLowerCase());
    return result(item, aliasFound ? "VERIFIED" : "PARTIALLY_APPLIED", aliasFound ? "The UBQ row disappeared and the original name is attached to the expected Root target." : "The UBQ row disappeared and the target exists, but the expected alias was not found.", context, target);
  }
  if (item.action === "CREATE") {
    const target = findRoot(item, context.rootBrands);
    return target ? result(item, "VERIFIED", `The UBQ row disappeared and the created Root brand was found as ${target.name}.`, context, target) : result(item, "PARTIALLY_APPLIED", "The UBQ row disappeared, but no matching created brand is visible in the Root table yet.", context);
  }
  return result(item, "VERIFIED", `The ${item.action} outcome is confirmed because the unmapped BrandID is no longer present.`, context);
}

function reconcileRoot(item: AdminUpdateItem, context: SourceContext) {
  const source = context.rootBrands.find((brand) => brand.id === item.sourceId);
  if (item.action === "DELETE") return !source || source.rootStatus?.toUpperCase() === "BLOCKED" ? result(item, "VERIFIED", "The Root source is removed or blocked.", context) : result(item, "NOT_APPLIED", "The Root source still exists and is not blocked.", context, source);
  if (item.action === "MERGE") {
    const target = findRoot(item, context.rootBrands);
    if (!target) return result(item, "CONFLICT", "The expected consolidation target is missing.", context);
    const sourceMoved = !source || source.sameAs === target.id || ["INACTIVE", "BLOCKED"].includes(source.rootStatus?.toUpperCase() || "");
    const aliasMoved = target.aliases.some((alias) => normalizeBrand(alias).toLowerCase() === normalizeBrand(item.originalName).toLowerCase());
    if (sourceMoved && aliasMoved) return result(item, "VERIFIED", "The source was consolidated and its name is preserved on the target as an alias.", context, target);
    if (sourceMoved || aliasMoved) return result(item, "PARTIALLY_APPLIED", "Only part of the consolidation is visible; check the source status, sameAs target, and target aliases.", context, target);
    return result(item, "NOT_APPLIED", "The source and target are unchanged from the recommendation.", context, target);
  }
  if (item.action === "CREATE") {
    if (!source) return result(item, "CONFLICT", "The Root source BrandID is no longer available.", context);
    const expected = normalizeBrand(item.targetName || item.originalName).toLowerCase();
    const matches = normalizeBrand(source.name).toLowerCase() === expected || source.aliases.some((alias) => normalizeBrand(alias).toLowerCase() === expected);
    return result(item, matches ? "VERIFIED" : "NOT_APPLIED", matches ? "The expected Root name or alias is present." : "The Root record does not contain the expected corrected name or alias.", context, source);
  }
  return result(item, "VERIFIED", "No external Root change was required for this reviewed decision.", context, source);
}

function reconcileUbqAfterRoot(item: AdminUpdateItem, context: SourceContext) {
  const target = findRoot(item, context.rootBrands);
  if (!target) return result(item, "PARTIALLY_APPLIED", "The UBQ change was observed, but the expected Root brand is still missing.", context);
  if (item.action === "MERGE") {
    const aliasFound = target.aliases.some((alias) => normalizeBrand(alias).toLowerCase() === normalizeBrand(item.originalName).toLowerCase());
    return result(item, aliasFound ? "VERIFIED" : "PARTIALLY_APPLIED", aliasFound ? "The refreshed Root table now confirms the expected target and alias." : "The target exists, but the expected alias is still missing.", context, target);
  }
  return result(item, "VERIFIED", `The refreshed Root table now contains the created brand ${target.name}.`, context, target);
}

export function reconcileAdminRuns(runs: AdminUpdateRun[], context: SourceContext) {
  return runs.map((run) => ({ ...run, items: run.items.map((item) => {
    if (context.importedAt <= run.exportedAt) return item;
    if (context.source === "ROOT" && item.source === "UBQ" && item.status === "PARTIALLY_APPLIED" && (item.action === "CREATE" || item.action === "MERGE")) return reconcileUbqAfterRoot(item, context);
    if (item.source !== context.source) return item;
    return context.source === "UBQ" ? reconcileUbq(item, context) : reconcileRoot(item, context);
  }) }));
}

export function adminRunFromRecords(filename: string, exportedBy: string, records: BrandRecord[], batchId?: string, exportedAt = new Date().toISOString()): AdminUpdateRun {
  return { id: `admin-run:${exportedAt}:${Math.random().toString(36).slice(2, 8)}`, filename, exportedAt, exportedBy, batchId, source: "UBQ", items: records.map((record) => ({ id: `${record.id}:${exportedAt}`, source: "UBQ", sourceId: record.id, originalName: record.name, action: record.action, targetId: record.targetId, targetName: record.targetName, expectedAliases: record.suggestedAliases, status: "AWAITING_NEWER_DATA", detail: "Waiting for a newer UBQ/Root import after the Admin upload." })) };
}

export function adminRunFromRootChanges(filename: string, exportedBy: string, changes: RootTableChange[], exportedAt = new Date().toISOString()): AdminUpdateRun {
  return { id: `root-run:${exportedAt}:${Math.random().toString(36).slice(2, 8)}`, filename, exportedAt, exportedBy, source: "ROOT", items: changes.map((change) => ({ id: `${change.id}:${exportedAt}`, source: "ROOT", sourceId: change.id, originalName: change.before?.name || change.after.name, action: change.after.rootStatus === "BLOCKED" ? "DELETE" : change.after.sameAs ? "MERGE" : "CREATE", targetId: change.after.sameAs, targetName: change.after.sameAs ? undefined : change.after.name, expectedAliases: change.after.aliases, status: "AWAITING_NEWER_DATA", detail: "Waiting for a newer Root-table import after the Admin change." })) };
}

export function backfillAdminRuns(runs: AdminUpdateRun[], queue: PriorityQueueItem[], rootChanges: Record<string, RootTableChange>) {
  const tracked = new Set(runs.flatMap((run) => run.items.map((item) => `${item.source}:${item.sourceId}`)));
  const additions: AdminUpdateRun[] = [];
  queue.forEach((item) => {
    if (!item.exportedAt || !item.finalAction || tracked.has(`UBQ:${item.brandId}`)) return;
    const record: BrandRecord = { id: item.brandId, name: item.name, normalized: normalizeBrand(item.name), action: item.finalAction, targetId: item.finalTargetId, targetName: item.finalTargetName, confidence: 100, reason: item.finalReason || "Previously exported team decision", evidence: [], status: "reviewed", decisionSource: "Shared queue export" };
    additions.push(adminRunFromRecords(item.exportFilename || `Historical export · ${item.name}`, item.exportedBy || item.assignedTo || "Shared team", [record], undefined, item.exportedAt));
    tracked.add(`UBQ:${item.brandId}`);
  });
  Object.values(rootChanges).forEach((change) => {
    if (["REJECTED", "SUPERSEDED"].includes(change.adminStatus || "") || tracked.has(`ROOT:${change.id}`)) return;
    additions.push(adminRunFromRootChanges(`Historical Root Admin task · ${change.before?.name || change.after.name}`, change.adminUpdatedBy || "Shared team", [change], change.adminUpdatedAt || change.updatedAt));
    tracked.add(`ROOT:${change.id}`);
  });
  return [...additions, ...runs];
}
