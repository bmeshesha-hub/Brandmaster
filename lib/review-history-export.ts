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
