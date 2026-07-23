import { BrandRecord, PriorityQueueItem } from "./types";
import { normalizeBrand } from "./brand-engine";

export function priorityTaskKey(source: PriorityQueueItem["source"], brandId: string, name: string) {
  if (source === "ROOT") return `root:${brandId.trim().toLowerCase() || normalizeBrand(name).toLowerCase()}`;
  return `mapping:${normalizeBrand(name).toLowerCase()}`;
}

const sourceRank: Record<PriorityQueueItem["source"], number> = { PASTE: 1, CSV: 2, UBQ: 3, ROOT: 4 };

/** A stable, explainable score used to put the most valuable queue work first. */
export function priorityQueueScore(item: PriorityQueueItem, now = Date.now()) {
  const volume = Math.min(35, Math.round(Math.log10(1 + (item.listingCount || 0) * 2 + (item.skuCount || 0)) * 11));
  const source = item.source === "ROOT" ? 22 : item.source === "UBQ" ? 18 : item.source === "CSV" ? 10 : 6;
  const state = item.status === "BLOCKED" ? 20 : item.status === "IN_REVIEW" ? 12 : item.status === "ASSIGNED" ? 8 : item.status === "UNASSIGNED" ? 14 : 0;
  const ageDays = Math.max(0, Math.floor((now - new Date(item.createdAt).getTime()) / 86_400_000));
  const age = Math.min(20, ageDays * 2);
  const awaitingProof = item.externalStatus === "DONE_PENDING_VERIFICATION" || item.externalStatus === "EXPORTED_PENDING_VERIFICATION" ? 12 : 0;
  return Math.min(100, volume + source + state + age + awaitingProof);
}

export type PriorityImportDisposition = "NEW" | "AVAILABLE" | "YOUR_ACTIVE_WORK" | "TEAMMATE_ACTIVE_WORK" | "READY_FOR_EXPORT" | "AWAITING_VERIFICATION" | "VERIFIED_COMPLETE" | "RESOLVED_WITHOUT_MAPPING";

export interface PriorityImportPlanItem<T extends { id: string; name: string }> {
  row: T;
  existing?: PriorityQueueItem;
  disposition: PriorityImportDisposition;
  accepted: boolean;
  reason: string;
}

/** Describes whether a Step 1 row may safely enter a new review batch. */
export function priorityImportDisposition(item: PriorityQueueItem | undefined, currentUser: string): PriorityImportDisposition {
  if (!item) return "NEW";
  if (item.resolvedWithoutMappingAt) return "RESOLVED_WITHOUT_MAPPING";
  if (item.externalStatus === "VERIFIED") return "VERIFIED_COMPLETE";
  if (item.exportedAt || item.externalStatus === "DONE_PENDING_VERIFICATION" || item.externalStatus === "EXPORTED_PENDING_VERIFICATION") return "AWAITING_VERIFICATION";
  if (item.status === "COMPLETED") return "READY_FOR_EXPORT";
  if (item.assignedTo && item.assignedTo !== currentUser && item.status !== "UNASSIGNED") return "TEAMMATE_ACTIVE_WORK";
  if (item.assignedTo === currentUser && item.status !== "UNASSIGNED") return "YOUR_ACTIVE_WORK";
  return "AVAILABLE";
}

function importDispositionReason(disposition: PriorityImportDisposition, item: PriorityQueueItem | undefined, currentUser: string) {
  if (disposition === "NEW") return "New brand — ready to import";
  if (disposition === "AVAILABLE") return "Available in the team queue — it will be assigned to you";
  if (disposition === "YOUR_ACTIVE_WORK") return `Already assigned to ${currentUser} in the team queue`;
  if (disposition === "TEAMMATE_ACTIVE_WORK") return `Already being worked by ${item?.assignedTo || "another teammate"}`;
  if (disposition === "READY_FOR_EXPORT") return "Already reviewed and ready in Step 3";
  if (disposition === "AWAITING_VERIFICATION") return "Already exported and awaiting source verification";
  if (disposition === "VERIFIED_COMPLETE") return "Already completed and verified";
  return "Already closed without a mapping";
}

/** Plans every submitted row before Step 2 so the UI can require confirmation instead of silently filtering repeats. */
export function planPriorityImports<T extends { id: string; name: string }>(rows: T[], items: PriorityQueueItem[], currentUser: string): PriorityImportPlanItem<T>[] {
  const queueByKey = new Map(normalizePriorityQueueItems(items).map((item) => [item.taskKey || priorityTaskKey(item.source, item.brandId, item.name), item]));
  return rows.map((row) => {
    const source: PriorityQueueItem["source"] = row.id.startsWith("draft_brand_") ? "UBQ" : "CSV";
    const existing = queueByKey.get(priorityTaskKey(source, row.id, row.name));
    const disposition = priorityImportDisposition(existing, currentUser);
    return {
      row,
      existing,
      disposition,
      accepted: disposition === "NEW" || disposition === "AVAILABLE",
      reason: importDispositionReason(disposition, existing, currentUser),
    };
  });
}

export function normalizePriorityQueueItems(items: PriorityQueueItem[]) {
  const grouped = new Map<string, PriorityQueueItem>();
  items.forEach((raw) => {
    const taskKey = raw.taskKey || priorityTaskKey(raw.source, raw.brandId, raw.name);
    const item = { ...raw, taskKey };
    const current = grouped.get(taskKey);
    if (!current) { grouped.set(taskKey, item); return; }
    const newest = item.updatedAt > current.updatedAt ? item : current;
    const oldest = item.createdAt < current.createdAt ? item : current;
    const richer = sourceRank[item.source] > sourceRank[current.source] ? item : current;
    const activity = [...(item.activity || []), ...(current.activity || [])]
      .filter((event, index, all) => all.findIndex((candidate) => candidate.id === event.id) === index)
      .sort((left, right) => right.at.localeCompare(left.at)).slice(0, 30);
    grouped.set(taskKey, {
      ...newest,
      taskKey,
      id: current.id,
      source: richer.source,
      brandId: richer.brandId && !richer.brandId.startsWith("missing_id_") ? richer.brandId : newest.brandId,
      name: richer.name || newest.name,
      listingCount: richer.listingCount ?? newest.listingCount,
      skuCount: richer.skuCount ?? newest.skuCount,
      createdAt: oldest.createdAt,
      createdBy: oldest.createdBy,
      activity,
    });
  });
  return [...grouped.values()];
}

function queueEvent(type: NonNullable<PriorityQueueItem["activity"]>[number]["type"], message: string, by: string, at: string) {
  return { id: `${type.toLowerCase()}:${at}:${Math.random().toString(36).slice(2, 8)}`, type, at, by, message };
}

export function completePriorityQueueFromBatch(items: PriorityQueueItem[], records: BrandRecord[], completedAt = new Date().toISOString(), completedBy = "Team member") {
  const outcomes = new Map(records.filter((record) => record.priorityQueueId).map((record) => [record.priorityQueueId!, record]));
  return items.map((item) => {
    const record = outcomes.get(item.id);
    if (!record) return item;
    return {
      ...item,
      status: "COMPLETED" as const,
      completedAt,
      updatedAt: completedAt,
      finalAction: record.action,
      finalTargetId: record.action === "MERGE" ? record.targetId : undefined,
      finalTargetName: record.action === "MERGE" || record.action === "CREATE" ? record.targetName : undefined,
      finalReason: record.reason,
      exportedAt: undefined,
      exportedBy: undefined,
      exportFilename: undefined,
      activity: [queueEvent("READY", `Reviewed as ${record.action} and moved to Step 3`, completedBy, completedAt), ...(item.activity || [])].slice(0, 30),
    };
  });
}

export function markPriorityQueueExported(items: PriorityQueueItem[], ids: string[], exportedBy: string, filename: string, exportedAt = new Date().toISOString()) {
  const selected = new Set(ids);
  return items.map((item) => selected.has(item.id) ? {
    ...item,
    status: "COMPLETED" as const,
    completedAt: exportedAt,
    exportedAt,
    exportedBy,
    exportFilename: filename,
    externalStatus: "EXPORTED_PENDING_VERIFICATION" as const,
    updatedAt: exportedAt,
    activity: [queueEvent("EXPORTED", `Confirmed uploaded using ${filename}`, exportedBy, exportedAt), ...(item.activity || [])].slice(0, 30),
  } : item);
}

export function markPriorityQueueAdminDone(items: PriorityQueueItem[], ids: string[], completedBy: string, completedAt = new Date().toISOString()) {
  const selected = new Set(ids);
  return items.map((item) => selected.has(item.id) ? {
    ...item,
    externalStatus: "DONE_PENDING_VERIFICATION" as const,
    updatedAt: completedAt,
    activity: [queueEvent("STATUS", "Marked done in Admin; waiting for the next source-table import to verify it", completedBy, completedAt), ...(item.activity || [])].slice(0, 30),
  } : item);
}

export function reconcilePriorityQueueWithUbq(items: PriorityQueueItem[], currentUbqIds: Set<string>, verifiedBy: string, verifiedAt = new Date().toISOString(), currentUbqNames = new Set<string>()) {
  return items.map((item) => {
    if (item.source === "ROOT") return item;
    const present = currentUbqIds.has(item.brandId) || currentUbqNames.has(normalizeBrand(item.name).toLowerCase());
    if (item.externalStatus === "VERIFIED" && present) return {
      ...item,
      status: "UNASSIGNED" as const,
      assignedTo: undefined,
      assignedAt: undefined,
      completedAt: undefined,
      exportedAt: undefined,
      exportedBy: undefined,
      exportFilename: undefined,
      externalStatus: "NOT_STARTED" as const,
      verifiedAt: undefined,
      verifiedBy: undefined,
      updatedAt: verifiedAt,
      activity: [queueEvent("REOPENED", "Regression detected: this brand returned in the latest UBQ export", verifiedBy, verifiedAt), ...(item.activity || [])].slice(0, 30),
    };
    if (!item.brandId.startsWith("draft_brand_")) return item;
    if (!item.externalStatus || item.externalStatus === "NOT_STARTED" || item.externalStatus === "VERIFIED" || present) return item;
    return {
      ...item,
      externalStatus: "VERIFIED" as const,
      verifiedAt,
      verifiedBy,
      updatedAt: verifiedAt,
      activity: [queueEvent("VERIFIED", "Verified by the latest UBQ export: this unknown-brand row is no longer present", verifiedBy, verifiedAt), ...(item.activity || [])].slice(0, 30),
    };
  });
}

export function resetPriorityQueueItems(items: PriorityQueueItem[], ids: string[], updatedAt = new Date().toISOString()) {
  const selected = new Set(ids);
  return items.map((item) => selected.has(item.id) ? {
    ...item,
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
    activity: [queueEvent("REOPENED", "Returned to the available queue", item.assignedTo || item.createdBy, updatedAt), ...(item.activity || [])].slice(0, 30),
    updatedAt,
  } : item);
}

export function removePriorityQueueItems(items: PriorityQueueItem[], ids: string[]) {
  const selected = new Set(ids);
  return items.filter((item) => !selected.has(item.id));
}
