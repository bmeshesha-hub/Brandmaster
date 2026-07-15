import { BrandRecord, PriorityQueueItem } from "./types";

export function completePriorityQueueFromBatch(items: PriorityQueueItem[], records: BrandRecord[], completedAt = new Date().toISOString()) {
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
    updatedAt,
  } : item);
}

export function removePriorityQueueItems(items: PriorityQueueItem[], ids: string[]) {
  const selected = new Set(ids);
  return items.filter((item) => !selected.has(item.id));
}
