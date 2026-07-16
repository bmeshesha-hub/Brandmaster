import { BrandRecord, PriorityQueueItem } from "./types";

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
    exportedAt,
    exportedBy,
    exportFilename: filename,
    updatedAt: exportedAt,
    activity: [queueEvent("EXPORTED", `Confirmed uploaded using ${filename}`, exportedBy, exportedAt), ...(item.activity || [])].slice(0, 30),
  } : item);
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
    activity: [queueEvent("REOPENED", "Returned to the available queue", item.assignedTo || item.createdBy, updatedAt), ...(item.activity || [])].slice(0, 30),
    updatedAt,
  } : item);
}

export function removePriorityQueueItems(items: PriorityQueueItem[], ids: string[]) {
  const selected = new Set(ids);
  return items.filter((item) => !selected.has(item.id));
}
