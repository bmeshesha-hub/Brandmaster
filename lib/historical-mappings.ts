import { normalizeBrand, parseRows } from "./brand-engine";
import { Action, HistoricalMappingEntry } from "./types";

export type HistoricalImportMode = "append" | "update" | "replace";

const ACTION_MAP: Record<string, Action> = {
  "new brand": "CREATE",
  create: "CREATE",
  created: "CREATE",
  alias: "MERGE",
  merge: "MERGE",
  merged: "MERGE",
  skip: "SKIP",
  skipped: "SKIP",
  delete: "DELETE",
  deleted: "DELETE",
};

function parseHistoricalDate(value: string) {
  const text = value.trim();
  let year: number; let month: number; let day: number;
  const us = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (us) { month = Number(us[1]); day = Number(us[2]); year = Number(us[3]); }
  else if (iso) { year = Number(iso[1]); month = Number(iso[2]); day = Number(iso[3]); }
  else return undefined;
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return date.toISOString();
}

function identity(normalized: string, action: Action, date: string) {
  return `historical:${encodeURIComponent(normalized.toLowerCase())}:${action}:${date.slice(0, 10)}`;
}

export function parseHistoricalMappingCsv(text: string, sourceFilename: string, importedAt = new Date().toISOString()) {
  const rows = parseRows(text);
  if (!rows.length) return { entries: [] as HistoricalMappingEntry[], skipped: 0, errors: ["The CSV is empty."] };
  const headers = rows[0].map((header) => header.replace(/^\uFEFF/, "").toLowerCase().replace(/[^a-z]/g, ""));
  const brandIndex = headers.findIndex((header) => ["brand", "brandname", "unmappedbrandname", "listingbrand"].includes(header));
  const actionIndex = headers.findIndex((header) => ["action", "decision", "mappingaction"].includes(header));
  const dateIndex = headers.findIndex((header) => ["date", "revieweddate", "mappeddate", "createddate"].includes(header));
  if (brandIndex < 0 || actionIndex < 0 || dateIndex < 0) return { entries: [] as HistoricalMappingEntry[], skipped: Math.max(0, rows.length - 1), errors: ["Expected Brand, Action, and Date columns."] };
  const entries = new Map<string, HistoricalMappingEntry>();
  const errors: string[] = []; let skipped = 0;
  rows.slice(1).forEach((row, index) => {
    const brand = row[brandIndex]?.trim(); const originalAction = row[actionIndex]?.trim(); const date = parseHistoricalDate(row[dateIndex] || "");
    const action = ACTION_MAP[(originalAction || "").toLowerCase()]; const normalized = brand ? normalizeBrand(brand) : "";
    if (!brand || !normalized || !action || !date) {
      skipped += 1;
      if (errors.length < 5) errors.push(`Row ${index + 2}: ${!brand ? "missing brand" : !action ? `unsupported action “${originalAction || "blank"}”` : "invalid date"}.`);
      return;
    }
    const id = identity(normalized, action, date);
    entries.set(id, { id, brand, normalized, action, originalAction, date, sourceFilename, importedAt });
  });
  return { entries: [...entries.values()].sort((left, right) => left.date.localeCompare(right.date) || left.brand.localeCompare(right.brand)), skipped, errors };
}

export function mergeHistoricalMappings(existing: HistoricalMappingEntry[], incoming: HistoricalMappingEntry[], mode: HistoricalImportMode) {
  if (mode === "replace") return { entries: incoming, added: incoming.length, removed: existing.length, unchanged: 0 };
  const incomingBrands = new Set(incoming.map((entry) => entry.normalized.toLowerCase()));
  const base = mode === "update" ? existing.filter((entry) => !incomingBrands.has(entry.normalized.toLowerCase())) : existing;
  const result = new Map(base.map((entry) => [entry.id, entry]));
  let added = 0; let unchanged = 0;
  incoming.forEach((entry) => {
    if (result.has(entry.id)) unchanged += 1;
    else added += 1;
    result.set(entry.id, entry);
  });
  return { entries: [...result.values()].sort((left, right) => left.date.localeCompare(right.date) || left.brand.localeCompare(right.brand)), added, removed: existing.length - base.length, unchanged };
}

export function latestHistoricalMapping(entries: HistoricalMappingEntry[], brandName: string) {
  const key = normalizeBrand(brandName).toLowerCase();
  return entries.filter((entry) => entry.normalized.toLowerCase() === key).sort((left, right) => right.date.localeCompare(left.date))[0];
}
