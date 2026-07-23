import { normalizeBrand } from "./brand-engine";
import { AppData, ManualFpaIdReference } from "./types";

export interface NotDoneSnapshot {
  schemaVersion: "brandmaster.not-done.v1";
  filename: string;
  capturedAt: string;
  rows: { id: string; name: string; listingCount?: number; sellerCount?: number }[];
}

export function isNotDoneSnapshot(value: unknown): value is NotDoneSnapshot {
  if (!value || typeof value !== "object") return false;
  const snapshot = value as Partial<NotDoneSnapshot>;
  return snapshot.schemaVersion === "brandmaster.not-done.v1"
    && typeof snapshot.filename === "string"
    && Boolean(snapshot.filename.trim())
    && typeof snapshot.capturedAt === "string"
    && !Number.isNaN(Date.parse(snapshot.capturedAt))
    && Array.isArray(snapshot.rows)
    && snapshot.rows.every((row) => Boolean(row)
      && typeof row.id === "string"
      && row.id.startsWith("draft_brand_")
      && typeof row.name === "string"
      && Boolean(row.name.trim()));
}

function latestManualSourceAt(data: AppData) {
  return data.sourceMeta.MANUAL_FPA?.updatedAt;
}

function workTimestamp(item: AppData["priorityQueue"][number]) {
  return item.verifiedAt || item.exportedAt || item.resolvedWithoutMappingAt || item.completedAt;
}

/** Applies a point-in-time not-done snapshot without undoing work completed later. */
export function applyNotDoneSnapshot(data: AppData, snapshot: NotDoneSnapshot) {
  const latestExisting = latestManualSourceAt(data);
  if (latestExisting && latestExisting > snapshot.capturedAt) return data;

  const incoming: ManualFpaIdReference[] = snapshot.rows.map((row, index) => ({
    id: `manual-fpa:${row.id}`,
    brand: row.name.trim(),
    normalized: normalizeBrand(row.name),
    sourceBrandId: row.id,
    ubq: true,
    listingCount: row.listingCount,
    sellerCount: row.sellerCount,
    sourceRow: index + 2,
    sourceFilename: snapshot.filename,
    importedAt: snapshot.capturedAt,
  }));
  const incomingIds = new Map(incoming.map((reference) => [reference.sourceBrandId, reference]));
  const incomingByName = new Map<string, ManualFpaIdReference[]>();
  incoming.forEach((reference) => {
    const key = reference.normalized.toLowerCase();
    incomingByName.set(key, [...(incomingByName.get(key) || []), reference]);
  });
  const uniqueByName = new Map([...incomingByName.entries()].filter(([, matches]) => matches.length === 1).map(([key, matches]) => [key, matches[0]]));

  const references = new Map((data.manualFpaIds || []).map((reference) => [
    reference.sourceBrandId,
    reference.ubq === true ? { ...reference, ubq: false } : reference,
  ]));
  incoming.forEach((reference) => references.set(reference.sourceBrandId, reference));

  const priorityQueue = data.priorityQueue.map((item) => {
    if (item.source === "ROOT") return item;
    const matches = incomingByName.get(normalizeBrand(item.name).toLowerCase()) || [];
    const reference = incomingIds.get(item.brandId) || uniqueByName.get(normalizeBrand(item.name).toLowerCase());
    if (!incomingIds.has(item.brandId) && !matches.length) return item;
    const terminal = item.status === "COMPLETED" || item.externalStatus === "VERIFIED" || Boolean(item.exportedAt || item.resolvedWithoutMappingAt);
    const completedAt = workTimestamp(item);
    if (!terminal || (completedAt && completedAt > snapshot.capturedAt)) {
      return reference ? { ...item, brandId: reference.sourceBrandId, source: "UBQ" as const, listingCount: reference.listingCount ?? item.listingCount } : item;
    }
    return {
      ...item,
      brandId: reference?.sourceBrandId || item.brandId,
      source: "UBQ" as const,
      listingCount: reference?.listingCount ?? item.listingCount,
      status: "UNASSIGNED" as const,
      assignedTo: undefined,
      assignedAt: undefined,
      completedAt: undefined,
      finalAction: undefined,
      finalTargetId: undefined,
      finalTargetName: undefined,
      finalReason: undefined,
      exportedAt: undefined,
      exportedBy: undefined,
      exportFilename: undefined,
      externalStatus: "NOT_STARTED" as const,
      verifiedAt: undefined,
      verifiedBy: undefined,
      resolvedWithoutMappingAt: undefined,
      resolvedWithoutMappingBy: undefined,
      triageResolution: undefined,
      triageResolutionNote: undefined,
      updatedAt: snapshot.capturedAt,
      activity: [{
        id: `reopened:not-done:${snapshot.capturedAt}:${item.id}`,
        type: "REOPENED" as const,
        at: snapshot.capturedAt,
        by: "Current not-done snapshot",
        message: `Reopened because ${item.name} is present in ${snapshot.filename}`,
      }, ...(item.activity || [])].slice(0, 30),
    };
  });

  return {
    ...data,
    manualFpaIds: [...references.values()].sort((left, right) => left.brand.localeCompare(right.brand)),
    priorityQueue,
    sourceMeta: {
      ...data.sourceMeta,
      MANUAL_FPA: {
        filename: snapshot.filename,
        updatedAt: snapshot.capturedAt,
        rowCount: snapshot.rows.length,
      },
    },
  };
}
