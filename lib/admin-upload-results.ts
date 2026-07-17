import { parseRows } from "./brand-engine";
import { BrandRecord } from "./types";

export type AdminUploadResultRow = {
  rowNumber?: number;
  unmappedBrandId: string;
  unmappedBrandName: string;
  action?: string;
  targetBrandId?: string;
  targetBrandName?: string;
  status: "SUCCESS" | "FAILED" | "NOT_FOUND";
  rawStatus: string;
  errorMessage?: string;
  createdBrandId?: string;
};

export type AdminUploadResultParse = { rows: AdminUploadResultRow[]; error?: string };

const headerKey = (value: string) => value.replace(/^\uFEFF/, "").toLowerCase().replace(/[^a-z0-9]/g, "");

export function parseAdminUploadResults(text: string): AdminUploadResultParse {
  const parsed = parseRows(text);
  if (parsed.length < 2) return { rows: [], error: "The Admin result CSV is empty." };
  const headers = parsed[0].map(headerKey);
  const index = (...names: string[]) => headers.findIndex((header) => names.includes(header));
  const idIndex = index("unmappedbrandid", "draftbrandid", "brandid");
  const nameIndex = index("unmappedbrandname", "brandname", "brand");
  const statusIndex = index("status", "result", "uploadstatus");
  const errorIndex = index("errormessage", "error", "message", "failuremessage");
  const createdIndex = index("createdbrandid", "newbrandid");
  const rowIndex = index("rownumber", "row");
  const actionIndex = index("action");
  const targetIdIndex = index("targetbrandid");
  const targetNameIndex = index("targetbrandname");
  if (idIndex < 0 || statusIndex < 0) return { rows: [], error: "Expected UnmappedBrandID and Status columns in the Admin result CSV." };
  const rows = parsed.slice(1).filter((row) => row[idIndex]?.trim()).map((row) => {
    const rawStatus = row[statusIndex]?.trim() || "FAILED";
    const success = /^(success|succeeded|complete|completed|ok)$/i.test(rawStatus);
    const errorMessage = errorIndex >= 0 ? row[errorIndex]?.trim() || undefined : undefined;
    const notFound = /DOCUMENT_NOT_FOUND|requested brand or product could not be found/i.test(`${rawStatus} ${errorMessage || ""}`);
    return {
      rowNumber: rowIndex >= 0 ? Number(row[rowIndex]) || undefined : undefined,
      unmappedBrandId: row[idIndex].trim(),
      unmappedBrandName: nameIndex >= 0 ? row[nameIndex]?.trim() || "" : "",
      action: actionIndex >= 0 ? row[actionIndex]?.trim() || undefined : undefined,
      targetBrandId: targetIdIndex >= 0 ? row[targetIdIndex]?.trim() || undefined : undefined,
      targetBrandName: targetNameIndex >= 0 ? row[targetNameIndex]?.trim() || undefined : undefined,
      status: success ? "SUCCESS" as const : notFound ? "NOT_FOUND" as const : "FAILED" as const,
      rawStatus,
      errorMessage,
      createdBrandId: createdIndex >= 0 ? row[createdIndex]?.trim() || undefined : undefined,
    };
  });
  return rows.length ? { rows } : { rows: [], error: "No Admin result rows with an UnmappedBrandID were found." };
}

export function summarizeAdminUploadResults(attemptedIds: string[], rows: AdminUploadResultRow[]) {
  const attempted = new Set(attemptedIds);
  const matching = rows.filter((row) => attempted.has(row.unmappedBrandId));
  const reported = new Set(matching.map((row) => row.unmappedBrandId));
  return {
    matching,
    successful: matching.filter((row) => row.status === "SUCCESS"),
    failed: matching.filter((row) => row.status === "FAILED"),
    notFound: matching.filter((row) => row.status === "NOT_FOUND"),
    missingIds: attemptedIds.filter((id) => !reported.has(id)),
    unrelated: rows.length - matching.length,
  };
}

export function applyAdminUploadResultsToRecords(records: BrandRecord[], attemptedIds: string[], rows: AdminUploadResultRow[], filename: string, importedAt: string, moveFailuresToReview: boolean, markNotFoundDone = false) {
  const attempted = new Set(attemptedIds);
  const byId = new Map(rows.map((row) => [row.unmappedBrandId, row]));
  const updated = records.map((record) => {
    if (!attempted.has(record.id)) return record;
    const result = byId.get(record.id);
    if (!result) return record;
    if (result.status === "SUCCESS") return { ...record, adminUploadStatus: "SUCCESS" as const, adminUploadedAt: importedAt, adminUploadResultFile: filename, adminUploadMessage: result.rawStatus, createdBrandId: result.createdBrandId };
    if (result.status === "NOT_FOUND") return markNotFoundDone
      ? { ...record, adminUploadStatus: "SUCCESS" as const, adminUploadedAt: importedAt, adminUploadResultFile: filename, adminUploadMessage: "Marked done: the source brand is no longer present in UBQ" }
      : { ...record, adminUploadStatus: undefined, adminUploadedAt: importedAt, adminUploadResultFile: filename, adminUploadMessage: result.errorMessage || result.rawStatus };
    return { ...record, status: moveFailuresToReview ? "needs-review" as const : record.status, adminUploadStatus: "FAILED" as const, adminUploadedAt: importedAt, adminUploadResultFile: filename, adminUploadMessage: result.errorMessage || result.rawStatus };
  });
  return {
    records: updated,
    successful: updated.filter((record) => attempted.has(record.id) && record.adminUploadStatus === "SUCCESS"),
    failed: updated.filter((record) => attempted.has(record.id) && record.adminUploadStatus === "FAILED"),
    pending: updated.filter((record) => attempted.has(record.id) && !record.adminUploadStatus),
  };
}
