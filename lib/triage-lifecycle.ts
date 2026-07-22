import { AppData } from "./types";

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
