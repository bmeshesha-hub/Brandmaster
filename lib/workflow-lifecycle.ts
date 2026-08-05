import { BrandRecord, ExportRun, WorkflowStage } from "./types";

export const PENDING_WORKFLOW_STAGES: WorkflowStage[] = ["FIRST_REVIEW", "SECOND_REVIEW", "READY_TO_UPLOAD", "DOWNLOADED"];

export function isPendingWorkflowStage(stage: WorkflowStage) {
  return PENDING_WORKFLOW_STAGES.includes(stage);
}

export function workflowStage(record: BrandRecord): WorkflowStage {
  if (record.workflowStage) return record.workflowStage;
  if (record.triageResolution) return "CLOSED_WITHOUT_MAPPING";
  if (record.adminUploadStatus === "SUCCESS") return "ADMIN_CONFIRMED";
  if (record.adminUploadedAt) return "DOWNLOADED";
  if (record.status === "needs-review" && record.reviewedAt) return "SECOND_REVIEW";
  if (record.status === "reviewed") return "READY_TO_UPLOAD";
  return "FIRST_REVIEW";
}

export function normalizeWorkflowRecord(record: BrandRecord): BrandRecord {
  const stage = workflowStage(record);
  if (record.workflowStage === stage) return record;
  return {
    ...record,
    workflowStage: stage,
    firstReviewedBy: record.firstReviewedBy || record.reviewer,
    firstReviewedAt: record.firstReviewedAt || record.reviewedAt,
    approvedBy: stage === "READY_TO_UPLOAD" ? record.approvedBy || record.reviewer : record.approvedBy,
    approvedAt: stage === "READY_TO_UPLOAD" ? record.approvedAt || record.reviewedAt : record.approvedAt,
  };
}

export function saveWorkflowReview(record: BrandRecord, reviewer: string, at: string): { record: BrandRecord; error?: string } {
  const current = normalizeWorkflowRecord(record);
  if (current.workflowStage === "SECOND_REVIEW") {
    const first = current.firstReviewedBy || current.reviewer;
    if (first && first.toLowerCase() === reviewer.toLowerCase()) return { record: current, error: `${reviewer} completed the first review. Choose another teammate for the second review.` };
    return { record: { ...current, status: "reviewed", reviewer, reviewedAt: at, workflowStage: "READY_TO_UPLOAD", secondReviewedBy: reviewer, secondReviewedAt: at, approvedBy: reviewer, approvedAt: at } };
  }
  return { record: { ...current, status: "reviewed", reviewer, reviewedAt: at, workflowStage: "READY_TO_UPLOAD", firstReviewedBy: current.firstReviewedBy || reviewer, firstReviewedAt: current.firstReviewedAt || at, approvedBy: reviewer, approvedAt: at } };
}

export function saveWorkflowReviews(records: BrandRecord[], ids: Iterable<string>, reviewer: string, at: string): { records: BrandRecord[]; reviewed: BrandRecord[]; error?: string } {
  const selected = new Set(ids);
  const reviewed: BrandRecord[] = [];
  const replacements = new Map<string, BrandRecord>();
  for (const record of records) {
    if (!selected.has(record.id)) continue;
    const result = saveWorkflowReview(record, reviewer, at);
    if (result.error) return { records, reviewed: [], error: result.error };
    replacements.set(record.id, result.record);
    reviewed.push(result.record);
  }
  if (reviewed.length !== selected.size) return { records, reviewed: [], error: "One or more selected brands are no longer in this review batch. Refresh and try again." };
  return { records: records.map((record) => replacements.get(record.id) || record), reviewed };
}

export function requestSecondReview(record: BrandRecord, requestedBy: string, reason: string, at: string): BrandRecord {
  const current = normalizeWorkflowRecord(record);
  return {
    ...current,
    status: "needs-review",
    workflowStage: "SECOND_REVIEW",
    firstReviewedBy: current.firstReviewedBy || current.reviewer || requestedBy,
    firstReviewedAt: current.firstReviewedAt || current.reviewedAt || at,
    secondReviewRequestedBy: requestedBy,
    secondReviewRequestedAt: at,
    secondReviewReason: reason,
    secondReviewedBy: undefined,
    secondReviewedAt: undefined,
    approvedBy: undefined,
    approvedAt: undefined,
    excludedFromExport: false,
    triageResolution: undefined,
    triageResolutionNote: undefined,
    triageResolvedAt: undefined,
    triageResolvedBy: undefined,
  };
}

export function markRecordsDownloaded(records: BrandRecord[], ids: Iterable<string>) {
  const selected = new Set(ids);
  return records.map((record) => selected.has(record.id) ? { ...normalizeWorkflowRecord(record), workflowStage: "DOWNLOADED" as const } : record);
}

export function stableExportChecksum(records: BrandRecord[]) {
  const value = records.map((record) => [record.id, record.name, record.action, record.targetId || "", record.targetName || ""].join("\u001f")).join("\n");
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function createExportRun(batchId: string, filename: string, records: BrandRecord[], createdBy: string, createdAt = new Date().toISOString()): ExportRun {
  return { id: `export:${batchId}:${createdAt}`, batchId, filename, createdAt, createdBy, rowCount: records.length, rowIds: records.map((record) => record.id), checksum: stableExportChecksum(records), status: "DOWNLOADED" };
}

export function pendingExportRunIds(run: ExportRun) {
  if (run.status === "ADMIN_CONFIRMED" || run.status === "SOURCE_VERIFIED") return [];
  const successful = new Set(run.successfulIds || []);
  return run.rowIds.filter((id) => !successful.has(id));
}

export function isPendingExportRun(run: ExportRun) {
  return pendingExportRunIds(run).length > 0;
}

export function confirmExportRun(run: ExportRun, successfulIds: string[], failedIds: string[], resultFilename: string, confirmedBy: string, confirmedAt: string): ExportRun {
  const successful = [...new Set([...(run.successfulIds || []), ...successfulIds])];
  const successfulSet = new Set(successful);
  const remaining = run.rowIds.filter((id) => !successfulSet.has(id));
  const failed = [...new Set([...(run.failedIds || []), ...failedIds])].filter((id) => !successfulSet.has(id));
  return { ...run, status: remaining.length ? "PARTIALLY_CONFIRMED" : "ADMIN_CONFIRMED", adminResultFilename: resultFilename, confirmedAt, confirmedBy, successfulIds: successful, failedIds: failed };
}

const csv = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
export function workflowHandoffCsv(records: BrandRecord[]) {
  const header = ["WorkflowStage", "UnmappedBrandID", "UnmappedBrandName", "Action", "TargetBrandID", "TargetBrandName", "FirstReviewer", "SecondReviewer", "ApprovedBy", "Reason"];
  const rows = records.map((record) => [workflowStage(record), record.id, record.name, record.action, record.targetId || "", record.targetName || "", record.firstReviewedBy || record.reviewer || "", record.secondReviewedBy || "", record.approvedBy || "", record.secondReviewReason || record.reason].map(csv).join(","));
  return [header.join(","), ...rows].join("\n");
}
