import { Action, LedgerEntry } from "./types";

const escapeCsv = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;

const progressAction: Record<Action, string> = {
  MERGE: "Alias",
  CREATE: "New Brand",
  SKIP: "Skipped",
  DELETE: "Deleted",
};

/** Export reviewed decisions in the compact mapping-progress sheet format. */
export function reviewHistoryProgressCsv(entries: LedgerEntry[]) {
  const header = ["normalized_brand", "mapped_dt", "action"];
  const rows = entries.map((entry) => [
    entry.normalized.trim().toLowerCase(),
    entry.date.slice(0, 10),
    progressAction[entry.action],
  ].map(escapeCsv).join(","));
  return [header.join(","), ...rows].join("\n");
}
