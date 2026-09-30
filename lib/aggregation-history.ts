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

function createRootTargetResolver(brands: CatalogBrand[]) {
  const byId = new Map(brands.map((brand) => [brand.id, brand]));
  const positionById = new Map(brands.map((brand, index) => [brand.id, index]));
  const byNameOrAlias = new Map<string, CatalogBrand>();
  brands.forEach((brand) => [brand.name, ...brand.aliases].forEach((name) => {
    const key = normalizeBrand(name).toLowerCase();
    if (key && !byNameOrAlias.has(key)) byNameOrAlias.set(key, brand);
  }));
  return (item: Pick<AdminUpdateItem, "createdBrandId" | "targetId" | "targetName" | "originalName">) => {
    const byCreatedId = item.createdBrandId ? byId.get(item.createdBrandId) : undefined;
    const byTargetId = item.targetId ? byId.get(item.targetId) : undefined;
    if (byCreatedId && byTargetId) {
      return (positionById.get(byCreatedId.id) || 0) <= (positionById.get(byTargetId.id) || 0) ? byCreatedId : byTargetId;
    }
    if (byCreatedId || byTargetId) return byCreatedId || byTargetId;
    return byNameOrAlias.get(normalizeBrand(item.targetName || item.originalName).toLowerCase());
  };
}

function timestamp(value: string | undefined) {
  if (!value) return Number.NaN;
  const trimmed = value.trim();
  if (/^\d{13}$/.test(trimmed)) return Number(trimmed);
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function rootConfirmedForTarget(item: AdminUpdateItem, target: CatalogBrand | undefined, checkpointAt?: string) {
  if (item.action !== "CREATE" && item.action !== "MERGE") return false;
  if (!target) return false;
  const mappingPresent = item.action !== "MERGE" || target.aliases.some(
    (alias) => normalizeBrand(alias).toLowerCase() === normalizeBrand(item.originalName).toLowerCase(),
  );
  if (!mappingPresent) return false;
  const rootEvidenceAt = item.action === "CREATE"
    ? target.rootCreatedAt
    : target.rootModifiedAt || target.bulkMappingAt;
  const rootTime = timestamp(rootEvidenceAt);
  const checkpointTime = timestamp(checkpointAt || item.adminUploadedAt);
  return Number.isFinite(rootTime) && Number.isFinite(checkpointTime) && rootTime > checkpointTime;
}

export function aggregationRootConfirmed(item: AdminUpdateItem, brands: CatalogBrand[], checkpointAt?: string) {
  return rootConfirmedForTarget(item, resolveAggregationRootTarget(item, brands), checkpointAt);
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
          .filter((item) => timestamp(item.adminUploadedAt || run.exportedAt) <= timestamp(input.updatedAt))
          .map((item) => ({ item, checkpointAt: item.adminUploadedAt || run.exportedAt }))
      : [],
  );
  const resolveRootTarget = createRootTargetResolver(input.rootBrands);
  const expectedRoot = accepted.filter(({ item }) => item.action === "CREATE" || item.action === "MERGE");
  const rootConfirmed = expectedRoot.filter(({ item, checkpointAt }) => rootConfirmedForTarget(item, resolveRootTarget(item), checkpointAt)).length;
  const stillInUbq = accepted.filter(({ item }) => input.ubqIds.has(item.sourceId)).length;
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
