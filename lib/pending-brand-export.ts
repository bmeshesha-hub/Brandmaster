import { BrandRecord, PriorityQueueItem } from "./types";

export type PendingBrandStatus = "WAITING_FOR_UPLOAD" | "WAITING_FOR_SECOND_REVIEW";

export interface PendingBrandExportRow {
  status: PendingBrandStatus;
  record: BrandRecord;
  assignedTo?: string;
  updatedAt?: string;
}

const escapeCsv = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;

function isActiveMappingRecord(record: BrandRecord) {
  return record.workflowSource !== "ROOT"
    && !record.excludedFromExport
    && !record.triageResolution
    && record.adminUploadStatus !== "SUCCESS";
}

export function isAdminReadyPendingRecord(record: BrandRecord) {
  if (!isActiveMappingRecord(record) || record.status !== "reviewed" || !record.id.startsWith("draft_brand_")) return false;
  if (record.action === "MERGE") return Boolean(record.targetId?.startsWith("brand_") && record.targetName?.trim());
  if (record.action === "CREATE") return Boolean(record.targetName?.trim());
  return record.action === "SKIP" || record.action === "DELETE";
}

/**
 * Build the current pending handoff list. A second review is deliberately
 * narrower than ordinary unreviewed work: the row must have a prior review
 * timestamp and must since have been reopened into needs-review.
 */
export function pendingBrandRows(records: BrandRecord[], priorityQueue: PriorityQueueItem[] = []): PendingBrandExportRow[] {
  const queueById = new Map(priorityQueue.map((item) => [item.id, item]));
  const latestById = new Map<string, BrandRecord>();
  records.filter(isActiveMappingRecord).forEach((record) => {
    const current = latestById.get(record.id);
    if (!current || (record.reviewedAt || "") > (current.reviewedAt || "")) latestById.set(record.id, record);
  });
  return [...latestById.values()].flatMap((record): PendingBrandExportRow[] => {
    const queue = record.priorityQueueId ? queueById.get(record.priorityQueueId) : undefined;
    if (isAdminReadyPendingRecord(record)) return [{ status: "WAITING_FOR_UPLOAD", record, assignedTo: queue?.assignedTo, updatedAt: queue?.updatedAt || record.reviewedAt }];
    if (record.status === "needs-review" && record.reviewedAt) return [{ status: "WAITING_FOR_SECOND_REVIEW", record, assignedTo: queue?.assignedTo, updatedAt: queue?.updatedAt || record.reviewedAt }];
    return [];
  }).sort((left, right) => (right.updatedAt || "").localeCompare(left.updatedAt || ""));
}

/** Operational handoff report. This is not accepted by the Admin uploader. */
export function pendingBrandWorkflowCsv(rows: PendingBrandExportRow[]) {
  const header = ["PendingStatus", "UnmappedBrandID", "UnmappedBrandName", "Action", "TargetBrandID", "TargetBrandName", "AssignedTo", "LastUpdated", "Reason"];
  const body = rows.map(({ status, record, assignedTo, updatedAt }) => [
    status === "WAITING_FOR_UPLOAD" ? "Waiting for upload" : "Waiting for second review",
    record.id,
    record.name,
    record.action,
    record.action === "MERGE" ? record.targetId : "",
    record.action === "MERGE" || record.action === "CREATE" ? record.targetName : "",
    assignedTo || record.reviewer || "",
    updatedAt || "",
    record.reason,
  ].map(escapeCsv).join(","));
  return [header.join(","), ...body].join("\n");
}

/** Exact five-column Admin file, restricted to rows that are ready to upload. */
export function pendingBrandAdminCsv(rows: PendingBrandExportRow[]) {
  const header = ["UnmappedBrandID", "UnmappedBrandName", "Action", "TargetBrandID", "TargetBrandName"];
  const body = rows.filter((row) => row.status === "WAITING_FOR_UPLOAD").map(({ record }) => [
    record.id,
    record.name,
    record.action,
    record.action === "MERGE" ? record.targetId : "",
    record.action === "MERGE" || record.action === "CREATE" ? record.targetName : "",
  ].map(escapeCsv).join(","));
  return [header.join(","), ...body].join("\n");
}
