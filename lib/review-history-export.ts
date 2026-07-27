import { Action, LedgerEntry } from "./types";

const escapeCsv = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;

const progressAction: Record<Action, string> = {
  MERGE: "Alias",
  CREATE: "New Brand",
  SKIP: "Skipped",
  DELETE: "Deleted",
};

/** Export reviewed decisions in the external progress-report format. */
export function reviewHistoryProgressCsv(entries: LedgerEntry[]) {
  const header = ["Brand", "DATE", "ACTION"];
  const rows = entries.map((entry) => [
    entry.normalized.trim().toLowerCase(),
    entry.date.slice(0, 10),
    progressAction[entry.action],
  ].map(escapeCsv).join(","));
  return [header.join(","), ...rows].join("\n");
}

/** Match either ordinary text or pasted spreadsheet rows containing names and draft BrandIDs. */
export function matchesReviewHistoryQuery(entry: LedgerEntry, query: string) {
  const trimmed = query.trim();
  if (!trimmed) return true;
  const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 1 && !lines[0].includes("\t")) {
    const term = lines[0].toLowerCase();
    return `${entry.name} ${entry.normalized} ${entry.id} ${entry.targetName || ""} ${entry.targetId || ""} ${entry.reason} ${entry.reviewer || "Unattributed"} ${entry.decisionSource || "Legacy decision"}`.toLowerCase().includes(term);
  }
  return lines.some((line) => {
    const columns = line.split("\t");
    const pastedName = columns[0]?.trim().toLowerCase();
    const pastedId = line.match(/\bdraft_brand_[A-Za-z0-9_-]+\b/)?.[0];
    return Boolean((pastedId && entry.id === pastedId) || (pastedName && [entry.name, entry.normalized].some((name) => name.trim().toLowerCase() === pastedName)));
  });
}

/** A rebuilt upload contains only the newest visible decision for each source BrandID. */
export function latestReviewHistoryEntries(entries: LedgerEntry[]) {
  const latest = new Map<string, LedgerEntry>();
  entries.forEach((entry) => {
    const current = latest.get(entry.id);
    if (!current || entry.date > current.date) latest.set(entry.id, entry);
  });
  return [...latest.values()].sort((left, right) => right.date.localeCompare(left.date));
}
