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

export interface CompletionEvidenceReport {
  brand: string;
  id?: string;
  ubq: { status: "PRESENT" | "ABSENT" | "NOT_LOADED" };
  history?: { action: Action | "COMPLETED"; date: string; targetId?: string; targetName?: string };
  root?: { id: string; name: string; matchedBy: "PRIOR_TARGET" | "EXACT_NAME" };
  aggregation?: AggregationDiagnosis;
  conclusion: "STILL_IN_UBQ" | "ALREADY_DONE" | "LIKELY_DONE" | "NO_COMPLETION_EVIDENCE";
}

export interface AggregationDiagnosis {
  status: "ROOT_CONFIRMED" | "PENDING_AGGREGATION" | "AGGREGATION_OVERDUE" | "ROOT_SOURCE_TOO_OLD" | "ROOT_NOT_LOADED" | "NOT_EXPECTED";
  completedAt: string;
  dueAt: string;
  rootUpdatedAt?: string;
}

type Candidate = CompletedBrandDetail & { rank: number };
const AGGREGATION_WINDOW_MS = 72 * 60 * 60 * 1000;

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

/** Explain the independent clues behind an intake completion decision. */
export function buildCompletionEvidenceReports(data: AppData, rows: { id?: string; name: string }[], ubq: CurrentUbqLookup | null, now = Date.now()): CompletionEvidenceReport[] {
  const completed = findCompletedBrandDetails(data, rows);
  const completedByName = new Map(completed.map((detail) => [key(detail.brand), detail]));
  const activeRoot = data.rootBrands.filter((brand) => (brand.rootStatus || "ACTIVE") === "ACTIVE" && !brand.sameAs);
  return rows.map((row) => {
    const normalized = key(row.name);
    const history = completedByName.get(normalized);
    const priorRecords = [
      ...data.batches.flatMap((batch) => batch.records.map((record) => ({ id: record.id, name: record.name, action: record.action, targetId: record.targetId, targetName: record.targetName, date: record.adminUploadedAt || record.reviewedAt || batch.adminCompletedAt || batch.createdAt }))),
      ...data.ledger.map((entry) => ({ id: entry.id, name: entry.name, action: entry.action, targetId: entry.targetId, targetName: entry.targetName, date: entry.date })),
      ...data.historicalMappings.filter((entry) => entry.ubq !== true).map((entry) => ({ id: entry.sourceBrandId, name: entry.brand, action: entry.action, targetId: entry.targetBrandId, targetName: entry.targetBrandName, date: entry.date })),
    ].filter((candidate) => (row.id && candidate.id === row.id) || key(candidate.name) === normalized)
      .sort((left, right) => right.date.localeCompare(left.date));
    const prior = priorRecords.find((candidate) => !history || candidate.action === history.action);
    const rootByTarget = prior?.targetId ? activeRoot.find((brand) => brand.id === prior.targetId) : undefined;
    const targetName = prior?.targetName || (history?.action === "CREATE" ? row.name : undefined);
    const rootByName = !rootByTarget && targetName ? activeRoot.find((brand) => key(brand.name) === key(targetName)) : undefined;
    const root = rootByTarget
      ? { id: rootByTarget.id, name: rootByTarget.name, matchedBy: "PRIOR_TARGET" as const }
      : rootByName
        ? { id: rootByName.id, name: rootByName.name, matchedBy: "EXACT_NAME" as const }
        : undefined;
    const present = Boolean(ubq && ((row.id && ubq.byId.has(row.id)) || ubq.byName.has(normalized)));
    const ubqStatus = !ubq ? "NOT_LOADED" as const : present ? "PRESENT" as const : "ABSENT" as const;
    const historyDetail = history ? { ...history, targetId: prior?.targetId, targetName: prior?.targetName } : undefined;
    const completedAt = history?.date;
    const completedAtMs = completedAt ? new Date(completedAt).getTime() : Number.NaN;
    const dueAt = Number.isFinite(completedAtMs) ? new Date(completedAtMs + AGGREGATION_WINDOW_MS).toISOString() : completedAt;
    const rootUpdatedAt = data.sourceMeta.ROOT?.updatedAt;
    const expectsRoot = history?.action === "CREATE" || history?.action === "MERGE";
    const aggregation = history && completedAt && dueAt && ubqStatus === "ABSENT"
      ? {
          status: root
            ? "ROOT_CONFIRMED" as const
            : !expectsRoot
              ? "NOT_EXPECTED" as const
              : now < new Date(dueAt).getTime()
                ? "PENDING_AGGREGATION" as const
                : !rootUpdatedAt
                  ? "ROOT_NOT_LOADED" as const
                  : new Date(rootUpdatedAt).getTime() < new Date(dueAt).getTime()
                    ? "ROOT_SOURCE_TOO_OLD" as const
                    : "AGGREGATION_OVERDUE" as const,
          completedAt,
          dueAt,
          rootUpdatedAt,
        }
      : undefined;
    const conclusion = present
      ? "STILL_IN_UBQ" as const
      : history && root
        ? "ALREADY_DONE" as const
        : history || root
          ? "LIKELY_DONE" as const
          : "NO_COMPLETION_EVIDENCE" as const;
    return { brand: row.name, id: row.id, ubq: { status: ubqStatus }, history: historyDetail, root, aggregation, conclusion };
  });
}

/** Builds the catalog-wide Root aggregation health view from completed work. */
export function buildAggregationHealthReports(data: AppData, ubq: CurrentUbqLookup | null, now = Date.now()): CompletionEvidenceReport[] {
  const candidates = new Map<string, { id?: string; name: string; date: string }>();
  const remember = (id: string | undefined, name: string, date?: string) => {
    if (!name.trim() || !date) return;
    const candidateKey = id || key(name);
    const current = candidates.get(candidateKey);
    if (!current || date > current.date) candidates.set(candidateKey, { id, name, date });
  };
  data.batches.forEach((batch) => batch.records.forEach((record) => {
    if (record.adminUploadStatus === "SUCCESS" || record.triageResolution === "ALREADY_DONE") {
      remember(record.id, record.name, record.adminUploadedAt || record.triageResolvedAt || record.reviewedAt || batch.adminCompletedAt || batch.createdAt);
    }
  }));
  data.priorityQueue.forEach((item) => {
    if (item.status === "COMPLETED" || item.externalStatus === "VERIFIED" || item.exportedAt || item.resolvedWithoutMappingAt) {
      remember(item.brandId, item.name, item.verifiedAt || item.exportedAt || item.resolvedWithoutMappingAt || item.completedAt);
    }
  });
  data.historicalMappings.forEach((entry) => {
    if (entry.ubq !== true) remember(entry.sourceBrandId, entry.brand, entry.date);
  });
  const reports = buildCompletionEvidenceReports(data, [...candidates.values()], ubq, now);
  return reports.filter((report) => report.aggregation);
}
