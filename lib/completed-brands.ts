import { normalizeBrand } from "./brand-engine";
import { Action, AppData, HistoricalMappingEntry } from "./types";

export interface CompletedBrandDetail {
  brand: string;
  action: Action | "COMPLETED";
  date: string;
}

export interface CurrentUbqLookup {
  byId: { has: (id: string) => boolean };
  byName: { has: (name: string) => boolean };
  capturedAt?: string;
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
export function findCompletedBrandDetails(data: AppData, rows: { id?: string; name: string }[]) {
  const completed = new Map<string, Candidate>();
  const completedById = new Map<string, Candidate>();
  const remember = (name: string, action: Candidate["action"], date: string | undefined, rank: number, sourceBrandId?: string) => {
    if (!name.trim() || !date) return;
    const normalized = key(name);
    const candidate = { brand: name, action, date, rank };
    completed.set(normalized, newerOrStronger(candidate, completed.get(normalized)));
    if (sourceBrandId) completedById.set(sourceBrandId, newerOrStronger(candidate, completedById.get(sourceBrandId)));
  };
  const rememberById = (sourceBrandId: string, name: string, action: Candidate["action"], date: string | undefined, rank: number) => {
    if (!sourceBrandId || !name.trim() || !date) return;
    const candidate = { brand: name, action, date, rank };
    completedById.set(sourceBrandId, newerOrStronger(candidate, completedById.get(sourceBrandId)));
  };

  data.batches.forEach((batch) => batch.records.forEach((record) => {
    if (record.adminUploadStatus === "SUCCESS") {
      remember(record.name, record.action, record.adminUploadedAt || record.reviewedAt || batch.adminCompletedAt || batch.createdAt, 5, record.id);
    } else if (record.triageResolution === "ALREADY_DONE" && record.triageResolvedAt) {
      remember(record.name, record.action, record.triageResolvedAt, 4);
    }
  }));

  data.adminUpdateRuns.forEach((run) => run.items.forEach((item) => {
    if (item.status === "VERIFIED") remember(item.originalName, item.action, item.lastCheckedAt || run.exportedAt, 4);
  }));

  data.priorityQueue.forEach((item) => {
    const date = item.verifiedAt || item.exportedAt || item.resolvedWithoutMappingAt || item.completedAt;
    if (item.externalStatus === "VERIFIED") remember(item.name, item.finalAction || "COMPLETED", date, 3, item.brandId);
    else if (item.exportedAt || item.resolvedWithoutMappingAt) remember(item.name, item.finalAction || "COMPLETED", date, 2, item.brandId);
    else if (item.status === "COMPLETED") remember(item.name, item.finalAction || "COMPLETED", date, 1, item.brandId);
  });

  const historicalByName = new Map<string, HistoricalMappingEntry[]>();
  data.historicalMappings.forEach((entry) => {
    if (entry.ubq === true) return;
    const normalized = key(entry.brand);
    historicalByName.set(normalized, [...(historicalByName.get(normalized) || []), entry]);
    if (entry.sourceBrandId) rememberById(entry.sourceBrandId, entry.brand, entry.action, entry.date, 2);
  });
  historicalByName.forEach((entries) => {
    if (entries.length !== 1) return;
    const entry = entries[0];
    remember(entry.brand, entry.action, entry.date, 2);
  });

  const requested = new Map<string, { name: string; id?: string }>();
  rows.forEach((row) => {
    const normalized = key(row.name);
    const requestKey = row.id || normalized;
    if (normalized && !requested.has(requestKey)) requested.set(requestKey, { name: row.name.trim(), id: row.id });
  });

  return [...requested.values()].flatMap(({ name, id }) => {
    const match = (id ? completedById.get(id) : undefined) || completed.get(key(name));
    return match ? [{ brand: name || match.brand, action: match.action, date: match.date }] : [];
  });
}

/** The newest UBQ is authoritative: a row that is still present cannot be treated as done. */
export function findCompletedBrandDetailsNotInUbq(data: AppData, rows: { id?: string; name: string }[], ubq: CurrentUbqLookup | null) {
  if (!ubq) return findCompletedBrandDetails(data, rows);
  return findCompletedBrandDetails(data, rows).filter((detail) => {
    const row = rows.find((candidate) => key(candidate.name) === key(detail.brand));
    if (!row) return true;
    const present = Boolean((row.id && ubq.byId.has(row.id)) || ubq.byName.has(key(row.name)));
    if (!present) return true;
    // A UBQ export is only authoritative through the moment it was uploaded.
    // Later work must remain completed until a newer snapshot verifies it.
    return Boolean(ubq.capturedAt && detail.date > ubq.capturedAt);
  });
}
