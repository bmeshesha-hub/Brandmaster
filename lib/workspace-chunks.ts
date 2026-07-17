import { AppData, ImportBatch, SharedWorkspaceSnapshot } from "./types";

const PREFIX = "brandmaster/workspace-data";
const MAX_CHUNK_BYTES = 700_000;

export type ChunkManifest = {
  schemaVersion: "brandmaster.workspace-manifest.v1";
  exportedAt: string;
  sync?: SharedWorkspaceSnapshot["sync"];
  core: string;
  arrays: Record<"ledger" | "customBrands" | "acaBrands" | "fpaBrands" | "rootBrands", string[]> & { historicalMappings?: string[]; priorityQueue?: string[]; cleanupConfirmations?: string[]; adminUpdateRuns?: string[]; teamActivity?: string[] };
  maps: Record<"learned" | "rootChanges", string[]> & { userWorkspaces?: string[]; teamPresence?: string[] };
  batches: { id: string; filename: string; createdAt: string; rows: number; workflowSource?: ImportBatch["workflowSource"]; owner?: string; records: string[] }[];
  ubq: { filename: string; rows: string[] } | null;
};

function bytes(value: unknown) { return new TextEncoder().encode(JSON.stringify(value)).byteLength; }
function safe(value: string) { return value.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80); }
function chunk<T>(items: T[]) {
  const output: T[][] = []; let current: T[] = []; let size = 2;
  items.forEach((item) => {
    const itemSize = bytes(item) + (current.length ? 1 : 0);
    if (current.length && size + itemSize > MAX_CHUNK_BYTES) { output.push(current); current = []; size = 2; }
    current.push(item); size += itemSize;
  });
  if (current.length || !output.length) output.push(current);
  return output;
}
function writeChunks<T>(files: Record<string, string>, name: string, items: T[]) {
  return chunk(items).map((values, index) => {
    const path = `${PREFIX}/${name}-${String(index).padStart(4, "0")}.json`;
    files[path] = JSON.stringify(values); return path;
  });
}

export function serializeWorkspaceFiles(workspace: SharedWorkspaceSnapshot) {
  const files: Record<string, string> = {};
  const core = { sourceMeta: workspace.data.sourceMeta, validationSettings: workspace.data.validationSettings };
  const corePath = `${PREFIX}/core.json`; files[corePath] = JSON.stringify(core);
  const arrays: ChunkManifest["arrays"] = {
    ledger: writeChunks(files, "ledger", workspace.data.ledger),
    historicalMappings: writeChunks(files, "historical-mappings", workspace.data.historicalMappings),
    priorityQueue: writeChunks(files, "priority-queue", workspace.data.priorityQueue),
    cleanupConfirmations: writeChunks(files, "cleanup-confirmations", workspace.data.cleanupConfirmations),
    adminUpdateRuns: writeChunks(files, "admin-update-runs", workspace.data.adminUpdateRuns),
    teamActivity: writeChunks(files, "team-activity", workspace.data.teamActivity || []),
    customBrands: writeChunks(files, "custom-brands", workspace.data.customBrands),
    acaBrands: writeChunks(files, "aca-brands", workspace.data.acaBrands),
    fpaBrands: writeChunks(files, "fpa-brands", workspace.data.fpaBrands),
    rootBrands: writeChunks(files, "root-brands", workspace.data.rootBrands),
  };
  const maps: ChunkManifest["maps"] = {
    learned: writeChunks(files, "learned", Object.entries(workspace.data.learned)),
    rootChanges: writeChunks(files, "root-changes", Object.entries(workspace.data.rootChanges)),
    userWorkspaces: writeChunks(files, "user-workspaces", Object.entries(workspace.data.userWorkspaces)),
    teamPresence: writeChunks(files, "team-presence", Object.entries(workspace.data.teamPresence || {})),
  };
  const batches = workspace.data.batches.map((batch) => ({ id: batch.id, filename: batch.filename, createdAt: batch.createdAt, rows: batch.rows, workflowSource: batch.workflowSource, owner: batch.owner, records: writeChunks(files, `batches/${safe(batch.id)}/records`, batch.records) }));
  const ubq = workspace.ubq ? { filename: workspace.ubq.filename, rows: writeChunks(files, "ubq-rows", workspace.ubq.rows) } : null;
  const manifest: ChunkManifest = { schemaVersion: "brandmaster.workspace-manifest.v1", exportedAt: workspace.exportedAt, sync: workspace.sync, core: corePath, arrays, maps, batches, ubq };
  files["brandmaster/workspace.json"] = JSON.stringify(manifest, null, 2);
  return files;
}

export function isWorkspaceManifest(value: unknown): value is ChunkManifest {
  return Boolean(value && typeof value === "object" && (value as ChunkManifest).schemaVersion === "brandmaster.workspace-manifest.v1");
}

export async function hydrateWorkspaceManifest(manifest: ChunkManifest, load: (path: string) => Promise<string>): Promise<SharedWorkspaceSnapshot> {
  const read = async <T>(paths: string[]) => (await Promise.all(paths.map(async (path) => JSON.parse(await load(path)) as T[]))).flat();
  const core = JSON.parse(await load(manifest.core)) as Omit<AppData, "batches" | "ledger" | "historicalMappings" | "priorityQueue" | "cleanupConfirmations" | "adminUpdateRuns" | "teamActivity" | "learned" | "customBrands" | "acaBrands" | "fpaBrands" | "rootBrands" | "rootChanges" | "userWorkspaces" | "teamPresence">;
  const [ledger, historicalMappings, priorityQueue, cleanupConfirmations, adminUpdateRuns, teamActivity, customBrands, acaBrands, fpaBrands, rootBrands, learnedEntries, rootChangeEntries, userWorkspaceEntries, teamPresenceEntries] = await Promise.all([
    read<AppData["ledger"][number]>(manifest.arrays.ledger), read<AppData["historicalMappings"][number]>(manifest.arrays.historicalMappings || []), read<AppData["priorityQueue"][number]>(manifest.arrays.priorityQueue || []), read<AppData["cleanupConfirmations"][number]>(manifest.arrays.cleanupConfirmations || []), read<AppData["adminUpdateRuns"][number]>(manifest.arrays.adminUpdateRuns || []), read<AppData["teamActivity"][number]>(manifest.arrays.teamActivity || []), read<AppData["customBrands"][number]>(manifest.arrays.customBrands), read<AppData["acaBrands"][number]>(manifest.arrays.acaBrands),
    read<AppData["fpaBrands"][number]>(manifest.arrays.fpaBrands), read<AppData["rootBrands"][number]>(manifest.arrays.rootBrands), read<[string, AppData["learned"][string]]>(manifest.maps.learned), read<[string, AppData["rootChanges"][string]]>(manifest.maps.rootChanges), read<[string, AppData["userWorkspaces"][string]]>(manifest.maps.userWorkspaces || []), read<[string, AppData["teamPresence"][string]]>(manifest.maps.teamPresence || []),
  ]);
  const batches: ImportBatch[] = await Promise.all(manifest.batches.map(async (batch) => ({ ...batch, records: await read<AppData["batches"][number]["records"][number]>(batch.records) })));
  const ubq = manifest.ubq ? { filename: manifest.ubq.filename, rows: await read<NonNullable<SharedWorkspaceSnapshot["ubq"]>["rows"][number]>(manifest.ubq.rows) } : null;
  const workspace: SharedWorkspaceSnapshot = { schemaVersion: "brandmaster.workspace.v1", exportedAt: manifest.exportedAt, data: { ...core, batches, ledger, historicalMappings, priorityQueue, cleanupConfirmations, adminUpdateRuns, teamActivity, learned: Object.fromEntries(learnedEntries), customBrands, acaBrands, fpaBrands, rootBrands, rootChanges: Object.fromEntries(rootChangeEntries), userWorkspaces: Object.fromEntries(userWorkspaceEntries), teamPresence: Object.fromEntries(teamPresenceEntries) }, ubq };
  if (manifest.sync) workspace.sync = manifest.sync;
  return workspace;
}

export const WORKSPACE_DATA_PREFIX = `${PREFIX}/`;
