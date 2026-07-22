import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const workspaceRoot = path.resolve(process.argv[2] || process.env.BRANDMASTER_WORKSPACE_DIR || ".");
const output = path.resolve(process.argv[3] || "public/analytics-snapshot.json");
const manifestPath = path.join(workspaceRoot, "brandmaster/workspace.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

async function readChunks(paths = []) {
  return (await Promise.all(paths.map(async (file) => JSON.parse(await readFile(path.join(workspaceRoot, file), "utf8"))))).flat();
}

const [ledger, historical, queue, batchRecords] = await Promise.all([
  readChunks(manifest.arrays?.ledger),
  readChunks(manifest.arrays?.historicalMappings),
  readChunks(manifest.arrays?.priorityQueue),
  Promise.all((manifest.batches || []).flatMap((batch) => batch.records || []).map(async (file) => JSON.parse(await readFile(path.join(workspaceRoot, file), "utf8")))).then((chunks) => chunks.flat()),
]);

const resolvedIds = new Set(batchRecords.filter((record) => record.triageResolution).map((record) => record.id));
const activity = [
  ...historical.map((entry) => ({ date: entry.date, action: entry.action, reviewer: entry.reviewer || "Historical import" })),
  ...ledger.filter((entry) => !resolvedIds.has(entry.id)).map((entry) => ({ date: entry.date, action: entry.action, reviewer: entry.reviewer || "Unattributed" })),
].filter((entry) => ["CREATE", "MERGE", "SKIP", "DELETE"].includes(entry.action) && !Number.isNaN(new Date(entry.date).getTime()));

const now = new Date();
const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);
const monday = new Date(today); monday.setDate(today.getDate() - (today.getDay() === 0 ? 6 : today.getDay() - 1));
const nextMonday = new Date(monday); nextMonday.setDate(nextMonday.getDate() + 7);
const publishedActivity = activity.filter((entry) => new Date(entry.date) < tomorrow);
const actionTotals = { CREATE: 0, MERGE: 0, SKIP: 0, DELETE: 0 };
publishedActivity.forEach((entry) => { actionTotals[entry.action] += 1; });
const contributors = [...publishedActivity.reduce((map, entry) => map.set(entry.reviewer, (map.get(entry.reviewer) || 0) + 1), new Map()).entries()]
  .map(([name, decisions]) => ({ name, decisions })).sort((a, b) => b.decisions - a.decisions || a.name.localeCompare(b.name)).slice(0, 8);

const latestActivity = publishedActivity.length ? new Date(Math.max(...publishedActivity.map((entry) => new Date(entry.date).getTime()))) : now;
const latestMonday = new Date(latestActivity); latestMonday.setHours(0, 0, 0, 0); latestMonday.setDate(latestMonday.getDate() - (latestMonday.getDay() === 0 ? 6 : latestMonday.getDay() - 1));
const weekly = Array.from({ length: 12 }, (_, index) => {
  const start = new Date(latestMonday); start.setDate(start.getDate() - (11 - index) * 7);
  const end = new Date(start); end.setDate(end.getDate() + 7);
  const rows = publishedActivity.filter((entry) => { const date = new Date(entry.date); return date >= start && date < end; });
  return {
    date: start.toISOString().slice(0, 10),
    label: start.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
    total: rows.length,
    CREATE: rows.filter((entry) => entry.action === "CREATE").length,
    MERGE: rows.filter((entry) => entry.action === "MERGE").length,
    SKIP: rows.filter((entry) => entry.action === "SKIP").length,
    DELETE: rows.filter((entry) => entry.action === "DELETE").length,
  };
});

const mappingQueue = queue.filter((item) => !item.resolvedWithoutMappingAt);
const activeQueue = mappingQueue.filter((item) => !item.exportedAt);
const activeRecords = batchRecords.filter((record) => !record.triageResolution && !record.excludedFromExport);
const snapshot = {
  schemaVersion: "brandmaster.public-analytics.v1",
  generatedAt: new Date().toISOString(),
  workspaceUpdatedAt: manifest.exportedAt,
  totals: {
    decisions: publishedActivity.length,
    today: publishedActivity.filter((entry) => { const date = new Date(entry.date); return date >= today && date < tomorrow; }).length,
    thisWeek: publishedActivity.filter((entry) => { const date = new Date(entry.date); return date >= monday && date < nextMonday; }).length,
    create: actionTotals.CREATE,
    merge: actionTotals.MERGE,
    skip: actionTotals.SKIP,
    delete: actionTotals.DELETE,
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
  contributors,
  weekly,
};

await writeFile(output, `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(`Generated sanitized public analytics snapshot at ${output}`);
