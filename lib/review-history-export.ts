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

/** Resolve an ISO review timestamp to the calendar day shown in the user's browser. */
export function reviewHistoryDateKey(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Keep only decisions that can be sent to Admin, newest-first and once per source ID. */
export function uploadableReviewHistoryEntries(entries: LedgerEntry[]) {
  return latestReviewHistoryEntries(entries).filter((entry) => entry.workflowSource !== "ROOT" && entry.id.startsWith("draft_brand_"));
}

/** Recreate Admin's locked five-column bulk-mapping CSV directly from review history. */
export function reviewHistoryAdminCsv(entries: LedgerEntry[]) {
  const header = ["UnmappedBrandID", "UnmappedBrandName", "Action", "TargetBrandID", "TargetBrandName"];
  const rows = uploadableReviewHistoryEntries(entries).map((entry) => [
    entry.id,
    entry.name,
    entry.action,
    entry.action === "MERGE" ? entry.targetId : "",
    entry.action === "MERGE" || entry.action === "CREATE" ? (entry.targetName || entry.normalized) : "",
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
