import { normalizeBrand } from "./brand-engine";
import { Action, AppData } from "./types";

export interface CompletedBrandDetail {
  brand: string;
  action: Action | "COMPLETED";
  date: string;
}

type Candidate = CompletedBrandDetail & { rank: number };

function key(value: string) {
  return normalizeBrand(value).trim().toLowerCase();
}

function newerOrStronger(candidate: Candidate, current?: Candidate) {
  if (!current) return candidate;
  if (candidate.rank !== current.rank) return candidate.rank > current.rank ? candidate : current;
  return candidate.date > current.date ? candidate : current;
}

/**
 * Finds submitted brands that Brandmaster already treats as finished. Confirmed
 * Admin outcomes are preferred over queue-only completion and reconciliation data.
 */
export function findCompletedBrandDetails(data: AppData, rows: { name: string }[]) {
  const completed = new Map<string, Candidate>();
  const remember = (name: string, action: Candidate["action"], date: string | undefined, rank: number) => {
    if (!name.trim() || !date) return;
    const normalized = key(name);
    completed.set(normalized, newerOrStronger({ brand: name, action, date, rank }, completed.get(normalized)));
  };

  data.batches.forEach((batch) => batch.records.forEach((record) => {
    if (record.adminUploadStatus === "SUCCESS") {
      remember(record.name, record.action, record.adminUploadedAt || record.reviewedAt || batch.adminCompletedAt || batch.createdAt, 5);
    } else if (record.triageResolution === "ALREADY_DONE" && record.triageResolvedAt) {
      remember(record.name, record.action, record.triageResolvedAt, 4);
    }
  }));

  data.adminUpdateRuns.forEach((run) => run.items.forEach((item) => {
    if (item.status === "VERIFIED") remember(item.originalName, item.action, item.lastCheckedAt || run.exportedAt, 4);
  }));

  data.priorityQueue.forEach((item) => {
    const date = item.verifiedAt || item.exportedAt || item.resolvedWithoutMappingAt || item.completedAt || item.updatedAt;
    if (item.externalStatus === "VERIFIED") remember(item.name, item.finalAction || "COMPLETED", date, 3);
    else if (item.exportedAt || item.resolvedWithoutMappingAt) remember(item.name, item.finalAction || "COMPLETED", date, 2);
    else if (item.status === "COMPLETED") remember(item.name, item.finalAction || "COMPLETED", date, 1);
  });

  const requested = new Map<string, string>();
  rows.forEach((row) => {
    const normalized = key(row.name);
    if (normalized && !requested.has(normalized)) requested.set(normalized, row.name.trim());
  });

  return [...requested.entries()].flatMap(([normalized, submittedName]) => {
    const match = completed.get(normalized);
    return match ? [{ brand: submittedName || match.brand, action: match.action, date: match.date }] : [];
  });
}
