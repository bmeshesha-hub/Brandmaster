import { BrandRecord } from "./types";

/**
 * Excluding a row is reversible. Restoring it must clear every terminal marker
 * used by Step 3, not only the visible excludedFromExport checkbox value.
 */
export function updateExportInclusion(records: BrandRecord[], recordIds: Iterable<string>, excluded: boolean) {
  const ids = new Set(recordIds);
  return records.map((record) => {
    if (!ids.has(record.id)) return record;
    if (excluded) return { ...record, excludedFromExport: true };
    return {
      ...record,
      excludedFromExport: false,
      triageResolution: undefined,
      triageResolutionNote: undefined,
      triageResolvedAt: undefined,
      triageResolvedBy: undefined,
      adminUploadStatus: undefined,
      adminUploadedAt: undefined,
      adminUploadedBy: undefined,
      adminUploadResultFile: undefined,
      adminUploadMessage: undefined,
    };
  });
}
