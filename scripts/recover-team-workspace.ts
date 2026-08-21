import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { mergeWorkspaceSnapshots } from "../lib/github-workspace";
import { buildPublicAnalyticsSnapshot } from "../lib/public-analytics";
import { hydrateWorkspaceManifest, isWorkspaceManifest, serializeWorkspaceFiles } from "../lib/workspace-chunks";
import type { SharedWorkspaceSnapshot } from "../lib/types";

async function loadWorkspace(root: string) {
  const manifestPath = path.join(root, "brandmaster/workspace.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
  if (!isWorkspaceManifest(manifest)) throw new Error(`Invalid workspace manifest: ${manifestPath}`);
  return hydrateWorkspaceManifest(manifest, (file) => readFile(path.join(root, file), "utf8"));
}

function mergeSourceMeta(good: SharedWorkspaceSnapshot, current: SharedWorkspaceSnapshot) {
  return { ...good.data.sourceMeta, ...current.data.sourceMeta };
}

function mergeValidationSettings(good: SharedWorkspaceSnapshot, current: SharedWorkspaceSnapshot) {
  const sources = new Map(good.data.validationSettings.approvedResearchSources.map((source) => [source.url, source]));
  current.data.validationSettings.approvedResearchSources.forEach((source) => sources.set(source.url, source));
  return {
    ...good.data.validationSettings,
    ...current.data.validationSettings,
    approvedResearchSources: [...sources.values()],
  };
}

function mergeMap<T>(good: Record<string, T>, current: Record<string, T>) {
  return { ...good, ...current };
}

async function main() {
  const goodRoot = path.resolve(process.argv[2]);
  const currentRoot = path.resolve(process.argv[3]);
  const outputRoot = path.resolve(process.argv[4]);
  if (!goodRoot || !currentRoot || !outputRoot) throw new Error("Usage: recover-team-workspace.ts <good-root> <current-root> <output-root>");
  if (path.basename(outputRoot) !== "Brandmaster-data") throw new Error(`Refusing to write outside Brandmaster-data: ${outputRoot}`);

  const [good, current] = await Promise.all([loadWorkspace(goodRoot), loadWorkspace(currentRoot)]);
  // Use the good checkpoint as the three-way base and remote, then merge the
  // latest browser changes into it. The production merge keeps durable arrays
  // from both sides; the explicit repairs below cover optional maps/config that
  // were absent from the damaged sync payload.
  const merged = mergeWorkspaceSnapshots(good, current, good).workspace;
  const recoveryAt = new Date().toISOString();
  const recovered: SharedWorkspaceSnapshot = {
    ...merged,
    exportedAt: recoveryAt,
    data: {
      ...merged.data,
      sourceMeta: mergeSourceMeta(good, current),
      validationSettings: mergeValidationSettings(good, current),
      learned: mergeMap(good.data.learned, current.data.learned),
      learningOverrides: mergeMap(good.data.learningOverrides || {}, current.data.learningOverrides || {}),
      rootChanges: mergeMap(good.data.rootChanges, current.data.rootChanges),
      userWorkspaces: mergeMap(good.data.userWorkspaces, current.data.userWorkspaces),
      teamPresence: mergeMap(good.data.teamPresence || {}, current.data.teamPresence || {}),
    },
    ubq: current.ubq || good.ubq,
    sync: {
      ...(good.sync || { lastSyncedAt: recoveryAt, lastSyncedBy: "Bef", history: [] }),
      ...(current.sync || {}),
      lastSyncedAt: recoveryAt,
      lastSyncedBy: "Bef",
      history: [
        ...(current.sync?.history || []),
        ...(good.sync?.history || []),
        { syncedAt: recoveryAt, syncedBy: "Bef", changeCount: current.data.ledger.length + current.data.batches.reduce((sum, batch) => sum + batch.records.length, 0) },
      ].filter((item, index, history) => history.findIndex((candidate) => candidate.syncedAt === item.syncedAt) === index),
    },
  };

  const files = serializeWorkspaceFiles(recovered);
  const workspaceDataRoot = path.join(outputRoot, "brandmaster/workspace-data");
  await rm(workspaceDataRoot, { recursive: true, force: true });
  await mkdir(workspaceDataRoot, { recursive: true });
  for (const [relativePath, content] of Object.entries(files)) {
    const destination = path.join(outputRoot, relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, content);
  }

  const data = recovered.data;
  const analytics = buildPublicAnalyticsSnapshot(recovered);
  console.log(JSON.stringify({
    recoveryAt,
    processed: data.historicalMappings.length + data.ledger.length,
    thisWeek: analytics.teamProgress.thisWeek,
    ledger: data.ledger.length,
    historicalMappings: data.historicalMappings.length,
    batches: data.batches.length,
    records: data.batches.reduce((sum, batch) => sum + batch.records.length, 0),
    learned: Object.keys(data.learned).length,
    rootChanges: Object.keys(data.rootChanges).length,
    teamActivity: data.teamActivity.length,
    rootBrands: data.rootBrands.length,
    ubq: recovered.ubq?.rows.length || 0,
  }, null, 2));
}

void main();
