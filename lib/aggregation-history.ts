import { normalizeBrand } from "./brand-engine";
import { Action, AdminUpdateItem, AdminUpdateRun, AggregationSnapshot, CatalogBrand } from "./types";

export function isAdminUploadAccepted(item: AdminUpdateItem, run?: AdminUpdateRun) {
  return item.adminUploadStatus === "SUCCESS" ||
    (Boolean(run?.batchId) && item.adminUploadStatus !== "FAILED");
}

export function resolveAggregationRootTarget(
  item: Pick<AdminUpdateItem, "createdBrandId" | "targetId" | "targetName" | "originalName">,
  brands: CatalogBrand[],
) {
  const byId = brands.find((brand) =>
    brand.id === item.createdBrandId || brand.id === item.targetId,
  );
  if (byId) return byId;
  const expected = normalizeBrand(item.targetName || item.originalName).toLowerCase();
  return brands.find((brand) =>
    normalizeBrand(brand.name).toLowerCase() === expected ||
    brand.aliases.some((alias) => normalizeBrand(alias).toLowerCase() === expected),
  );
}

export function aggregationRootConfirmed(item: AdminUpdateItem, brands: CatalogBrand[]) {
  if (item.action !== "CREATE" && item.action !== "MERGE") return false;
  const target = resolveAggregationRootTarget(item, brands);
  if (!target) return false;
  return item.action !== "MERGE" || target.aliases.some(
    (alias) => normalizeBrand(alias).toLowerCase() === normalizeBrand(item.originalName).toLowerCase(),
  );
}

export function buildAggregationSnapshot(input: {
  source: "UBQ" | "ROOT";
  filename: string;
  updatedAt: string;
  rowCount: number;
  fingerprint?: string;
  runs: AdminUpdateRun[];
  ubqIds: Set<string>;
  rootBrands: CatalogBrand[];
}): AggregationSnapshot {
  const accepted = input.runs.flatMap((run) =>
    run.source === "UBQ"
      ? run.items
          .filter((item) => item.source === "UBQ" && isAdminUploadAccepted(item, run))
          .filter((item) => Date.parse(item.adminUploadedAt || run.exportedAt) <= Date.parse(input.updatedAt))
      : [],
  );
  const expectedRoot = accepted.filter((item) => item.action === "CREATE" || item.action === "MERGE");
  const rootConfirmed = expectedRoot.filter((item) => aggregationRootConfirmed(item, input.rootBrands)).length;
  const stillInUbq = accepted.filter((item) => input.ubqIds.has(item.sourceId)).length;
  return {
    id: `${input.source}:${input.updatedAt}:${input.fingerprint || input.filename}`,
    source: input.source,
    filename: input.filename,
    updatedAt: input.updatedAt,
    rowCount: input.rowCount,
    fingerprint: input.fingerprint,
    trackedRows: accepted.length,
    ...(input.source === "UBQ" ? {
      stillInUbq,
      removedFromUbq: accepted.length - stillInUbq,
    } : {}),
    ...(input.source === "ROOT" ? {
      rootExpected: expectedRoot.length,
      rootConfirmed,
      rootPending: expectedRoot.length - rootConfirmed,
    } : {}),
  };
}

export function aggregationActionNeedsRoot(action: Action) {
  return action === "CREATE" || action === "MERGE";
}
