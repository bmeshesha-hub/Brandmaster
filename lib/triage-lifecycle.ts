import { getBulkExportReadiness } from "./brand-engine";
import { AppData, ImportBatch } from "./types";

function activeRecords(batch: ImportBatch) {
  return batch.records.filter((record) => record.adminUploadStatus !== "SUCCESS" && !record.excludedFromExport && !record.triageResolution);
}

/** Exposes at most one Clean View worklist while preserving legacy overflow for the next pass. */
export function triageWorklistWindow(batch: ImportBatch, limit = 10): ImportBatch {
  const records = activeRecords(batch).slice(0, Math.max(1, limit));
  return records.length === batch.records.length ? batch : { ...batch, rows: records.length, records };
}

/** Only the explicit per-user pointer may reopen a workflow; old orphan runs stay in history. */
export function activeUserBatch(data: AppData, user: string) {
  const activeBatchId = data.userWorkspaces[user]?.activeBatchId;
  if (!activeBatchId) return undefined;
  return data.batches.find((batch) => batch.id === activeBatchId && batch.owner === user && !batch.archivedAt);
}

/** Restore only a step that still has real work. Terminal batches return to Step 1. */
export function resolveWorkflowCheckpoint(requested?: "imports" | "review" | "output", batch?: ImportBatch): "imports" | "review" | "output" | undefined {
  if (!batch) return requested === "imports" ? "imports" : undefined;
  const active = activeRecords(batch);
  if (!active.length) return "imports";
  const readiness = getBulkExportReadiness(active);
  const readyForOutput = batch.workflowSource !== "ROOT" && readiness.ready && !active.some((record) => record.blockedByTargetCreation);
  if (requested === "imports") return "imports";
  if (requested === "output") return readyForOutput ? "output" : "review";
  if (requested === "review") return "review";
  return readyForOutput ? "output" : "review";
}

/**
 * Close a batch only when every row has a terminal outcome. The archived batch
 * remains available to history and analytics, while every user pointer to that
 * batch is removed so refreshes and team sync cannot reopen completed work.
 */
export function archiveFinishedTriage(data: AppData, batchId: string, archivedBy: string, archivedAt = new Date().toISOString()) {
  const batch = data.batches.find((item) => item.id === batchId);
  if (!batch || batch.records.some((record) => !record.excludedFromExport && !record.triageResolution && record.adminUploadStatus !== "SUCCESS")) return data;
  const batches = data.batches.map((item) => item.id === batchId ? { ...item, archivedAt, archivedBy, adminCompletedAt: archivedAt } : item);
  const userWorkspaces = Object.fromEntries(Object.entries(data.userWorkspaces).map(([user, workspace]) => [
    user,
    workspace.activeBatchId === batchId ? { ...workspace, activeBatchId: undefined, activeView: "imports" as const, reviewFocusIds: [], checkpointAt: archivedAt, updatedAt: archivedAt } : workspace,
  ]));
  return { ...data, batches, userWorkspaces };
}

/** Repairs older workspaces that contain a terminal, unarchived "Resume Finish" batch. */
export function archiveTerminalTriages(data: AppData, archivedAt = new Date().toISOString()) {
  const archived = data.batches.filter((batch) => !batch.archivedAt && activeRecords(batch).length === 0)
    .reduce((current, batch) => archiveFinishedTriage(current, batch.id, batch.owner || "Shared team", batch.adminCompletedAt || archivedAt), data);
  const available = new Set(archived.batches.filter((batch) => !batch.archivedAt).map((batch) => batch.id));
  let repaired = false;
  const userWorkspaces = Object.fromEntries(Object.entries(archived.userWorkspaces).map(([user, workspace]) => {
    if (!workspace.activeBatchId || available.has(workspace.activeBatchId)) return [user, workspace];
    repaired = true;
    return [user, { ...workspace, activeBatchId: undefined, activeView: "imports" as const, reviewFocusIds: [], checkpointAt: archivedAt, updatedAt: archivedAt }];
  }));
  return repaired ? { ...archived, userWorkspaces } : archived;
}
