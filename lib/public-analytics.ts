import { buildAvailableMappingSeries, buildWeeklyCompletionActivity, buildWeeklyTargetProgress, summarizeMappingActivity } from "./analytics";
import { Action, SharedWorkspaceSnapshot } from "./types";

export interface PublicAnalyticsSnapshot {
  schemaVersion: "brandmaster.public-analytics.v2";
  generatedAt: string;
  workspaceUpdatedAt: string;
  totals: {
    decisions: number;
    processed: number;
    today: number;
    thisWeek: number;
    mappedToday: number;
    mappedThisWeek: number;
    mappedLastWeek: number;
    create: number;
    merge: number;
    skip: number;
    delete: number;
  };
  target: {
    weekly: number;
    daily: number;
    completed: number;
    remaining: number;
    progressPercent: number;
    days: { label: string; completed: number; target: number }[];
  };
  confidence: {
    evaluated: number;
    average: number;
    high: number;
    medium: number;
    low: number;
    highPercent: number;
  };
  queue: { total: number; available: number; assigned: number; inReview: number; blocked: number; ready: number; exported: number };
  delivery: { confirmed: number; failed: number; awaiting: number };
  weekly: { date: string; label: string; total: number; CREATE: number; MERGE: number; SKIP: number; DELETE: number }[];
}

const ACTIONS: Action[] = ["CREATE", "MERGE", "SKIP", "DELETE"];

export function buildPublicAnalyticsSnapshot(workspace: SharedWorkspaceSnapshot, weeklyTarget = 600): PublicAnalyticsSnapshot {
  const data = workspace.data;
  const snapshotAt = workspace.sync?.lastSyncedAt || workspace.exportedAt;
  const now = new Date(snapshotAt);
  const resolvedIds = new Set(data.batches.flatMap((batch) => batch.records).filter((record) => record.triageResolution).map((record) => record.id));
  const activity = [
    ...data.historicalMappings.map((entry) => ({ date: entry.date, action: entry.action, reviewer: "Team" })),
    ...data.ledger.filter((entry) => !resolvedIds.has(entry.id)).map((entry) => ({ date: entry.date, action: entry.action, reviewer: "Team" })),
  ].filter((entry) => ACTIONS.includes(entry.action) && !Number.isNaN(new Date(entry.date).getTime()));
  const completionActivity = buildWeeklyCompletionActivity(data.historicalMappings, data.manualFpaIds, data.adminUpdateRuns);
  const completion = buildWeeklyTargetProgress(completionActivity, now, weeklyTarget);
  const mappingSummary = summarizeMappingActivity(activity, [], now);
  const actionTotals: Record<Action, number> = { CREATE: 0, MERGE: 0, SKIP: 0, DELETE: 0 };
  activity.forEach((entry) => { actionTotals[entry.action] += 1; });

  const confidenceRows = data.ledger
    .filter((entry) => !resolvedIds.has(entry.id) && Number.isFinite(entry.confidence) && entry.confidence >= 0 && entry.confidence <= 100);
  const confidenceTotal = confidenceRows.reduce((sum, entry) => sum + entry.confidence, 0);
  const high = confidenceRows.filter((entry) => entry.confidence >= 90).length;
  const medium = confidenceRows.filter((entry) => entry.confidence >= 70 && entry.confidence < 90).length;
  const low = confidenceRows.filter((entry) => entry.confidence < 70).length;

  const mappingQueue = data.priorityQueue.filter((item) => !item.resolvedWithoutMappingAt);
  const activeQueue = mappingQueue.filter((item) => !item.exportedAt);
  const activeRecords = data.batches.flatMap((batch) => batch.records).filter((record) => !record.triageResolution && !record.excludedFromExport);
  const weekly = buildAvailableMappingSeries(activity, "week", undefined, now).slice(-12).map((bucket) => ({
    date: bucket.key,
    label: bucket.label,
    total: bucket.total,
    CREATE: bucket.counts.CREATE,
    MERGE: bucket.counts.MERGE,
    SKIP: bucket.counts.SKIP,
    DELETE: bucket.counts.DELETE,
  }));

  return {
    schemaVersion: "brandmaster.public-analytics.v2",
    generatedAt: snapshotAt,
    workspaceUpdatedAt: snapshotAt,
    totals: {
      decisions: activity.length,
      processed: completionActivity.length,
      today: completion.days.find((day) => day.isToday)?.completed || 0,
      thisWeek: completion.completed,
      mappedToday: mappingSummary.today,
      mappedThisWeek: mappingSummary.thisWeek,
      mappedLastWeek: mappingSummary.lastWeek,
      create: actionTotals.CREATE,
      merge: actionTotals.MERGE,
      skip: actionTotals.SKIP,
      delete: actionTotals.DELETE,
    },
    target: {
      weekly: completion.weeklyTarget,
      daily: completion.dailyTarget,
      completed: completion.completed,
      remaining: completion.remaining,
      progressPercent: completion.progressPercent,
      days: completion.days.map((day) => ({ label: day.label, completed: day.completed, target: day.target })),
    },
    confidence: {
      evaluated: confidenceRows.length,
      average: confidenceRows.length ? Math.round(confidenceTotal / confidenceRows.length) : 0,
      high,
      medium,
      low,
      highPercent: confidenceRows.length ? Math.round(high / confidenceRows.length * 100) : 0,
    },
    queue: {
      total: mappingQueue.length,
      available: activeQueue.filter((item) => item.status === "UNASSIGNED").length,
      assigned: activeQueue.filter((item) => item.status === "ASSIGNED").length,
      inReview: activeQueue.filter((item) => item.status === "IN_REVIEW").length,
      blocked: activeQueue.filter((item) => item.status === "BLOCKED").length,
      ready: activeQueue.filter((item) => item.status === "COMPLETED").length,
      exported: mappingQueue.filter((item) => Boolean(item.exportedAt)).length,
    },
    delivery: {
      confirmed: activeRecords.filter((record) => record.adminUploadStatus === "SUCCESS").length,
      failed: activeRecords.filter((record) => record.adminUploadStatus === "FAILED").length,
      awaiting: activeRecords.filter((record) => !record.adminUploadStatus && record.status !== "needs-review").length,
    },
    weekly,
  };
}
