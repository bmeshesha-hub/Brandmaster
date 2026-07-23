import { SharedWorkspaceSnapshot } from "./types";
import type { PublicAnalyticsSnapshot } from "./public-analytics";
import { hydrateWorkspaceManifest, isWorkspaceManifest, serializeWorkspaceFiles, WORKSPACE_DATA_PREFIX } from "./workspace-chunks";

export const GITHUB_BASE_URL = "https://github.corp.ebay.com";
export const GITHUB_API_URL = `${GITHUB_BASE_URL}/api/v3`;
export const GITHUB_WORKSPACE_REPOSITORY = "bmeshesha/Brandmaster-data";
export const GITHUB_WORKSPACE_PATH = "brandmaster/workspace.json";
export const GITHUB_PUBLIC_ANALYTICS_REPOSITORY = "bmeshesha/Brandmaster";
export const GITHUB_PUBLIC_ANALYTICS_BRANCH = "gh-pages";
export const GITHUB_PUBLIC_ANALYTICS_PATH = "analytics-snapshot.json";

export interface GitHubUser {
  login: string;
  name?: string | null;
  avatar_url?: string;
}

export interface GitHubWorkspaceFile {
  revision: string | null;
  workspace: SharedWorkspaceSnapshot | null;
  updatedAt?: string;
}

export class GitHubWorkspaceError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export function textToBase64(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

export function base64ToText(value: string) {
  const binary = atob(value.replace(/\s/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new TextDecoder().decode(bytes);
}

export function decideGitHubSync(remoteRevision: string | null, lastRevision: string | null): "create" | "pull" | "push" | "conflict" {
  if (!remoteRevision) return "create";
  if (!lastRevision) return "pull";
  if (remoteRevision === lastRevision) return "push";
  return "conflict";
}

function equal(left: unknown, right: unknown) { return JSON.stringify(left) === JSON.stringify(right); }
function plain(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === "object" && !Array.isArray(value); }
function concurrentQueueAssignment(base: unknown, local: Record<string, unknown>, remote: Record<string, unknown>) {
  if (typeof local.id !== "string" || !local.id.startsWith("priority:") || typeof remote.id !== "string") return false;
  if (!plain(base)) return false;
  return local.assignedTo !== base.assignedTo && remote.assignedTo !== base.assignedTo && local.assignedTo !== remote.assignedTo;
}
function arrayKey(value: unknown) {
  if (!plain(value)) return "";
  for (const key of ["ledgerId", "id"]) if (typeof value[key] === "string") return `${key}:${value[key]}`;
  return "";
}
function mergeValue(base: unknown, local: unknown, remote: unknown): unknown {
  if (equal(local, base)) return remote;
  if (equal(remote, base) || equal(local, remote)) return local;
  if (plain(local) && plain(remote)) {
    // Two reviewers can claim the same queue row between polls. Preserve the latest
    // complete assignment instead of combining two owners into one task.
    if (concurrentQueueAssignment(base, local, remote)) {
      const localTime = typeof local.updatedAt === "string" ? local.updatedAt : "";
      const remoteTime = typeof remote.updatedAt === "string" ? remote.updatedAt : "";
      return remoteTime > localTime ? remote : local;
    }
    const baseObject = plain(base) ? base : {};
    const output: Record<string, unknown> = {};
    new Set([...Object.keys(baseObject), ...Object.keys(local), ...Object.keys(remote)]).forEach((key) => {
      const value = mergeValue(baseObject[key], local[key], remote[key]);
      if (value !== undefined) output[key] = value;
    });
    return output;
  }
  if (Array.isArray(local) && Array.isArray(remote)) {
    const keyed = [...local, ...remote].every((item) => Boolean(arrayKey(item)));
    if (!keyed) return local;
    const baseMap = new Map((Array.isArray(base) ? base : []).map((item) => [arrayKey(item), item]));
    const localMap = new Map(local.map((item) => [arrayKey(item), item]));
    const remoteMap = new Map(remote.map((item) => [arrayKey(item), item]));
    const order = [...remote.map(arrayKey), ...local.map(arrayKey).filter((key) => !remoteMap.has(key))];
    return order.map((key) => mergeValue(baseMap.get(key), localMap.get(key), remoteMap.get(key))).filter((value) => value !== undefined);
  }
  return local;
}
function changeCount(base: unknown, current: unknown): number {
  if (equal(base, current)) return 0;
  if (plain(base) && plain(current)) return [...new Set([...Object.keys(base), ...Object.keys(current)])].reduce((sum, key) => sum + changeCount(base[key], current[key]), 0);
  return 1;
}

export function mergeWorkspaceSnapshots(base: SharedWorkspaceSnapshot | null, local: SharedWorkspaceSnapshot, remote: SharedWorkspaceSnapshot) {
  const data = mergeValue(base?.data, local.data, remote.data) as SharedWorkspaceSnapshot["data"];
  const ubq = mergeValue(base?.ubq, local.ubq, remote.ubq) as SharedWorkspaceSnapshot["ubq"];
  return {
    workspace: { ...remote, exportedAt: new Date().toISOString(), data, ubq },
    localChanges: changeCount(base ? { data: base.data, ubq: base.ubq } : null, { data: local.data, ubq: local.ubq }),
    remoteChanges: changeCount(base ? { data: base.data, ubq: base.ubq } : null, { data: remote.data, ubq: remote.ubq }),
  };
}

/**
 * A teammate may delete or replace a batch after another browser's last sync.
 * Never let that remote history erase the batch that is actively open on this
 * device. Other batches and shared data remain fully merged.
 */
export function protectActiveTriage(local: SharedWorkspaceSnapshot, merged: SharedWorkspaceSnapshot, activeUser: string) {
  if (!activeUser) return merged;
  const localWorkspace = local.data.userWorkspaces[activeUser];
  const activeBatchId = localWorkspace?.activeBatchId;
  if (!activeBatchId) return merged;
  const activeBatch = local.data.batches.find((batch) => batch.id === activeBatchId && batch.owner === activeUser);
  if (!activeBatch) return merged;
  const mergedBatches = merged.data.batches.some((batch) => batch.id === activeBatchId)
    ? merged.data.batches.map((batch) => batch.id === activeBatchId ? activeBatch : batch)
    : [activeBatch, ...merged.data.batches];
  const mergedWorkspace = merged.data.userWorkspaces[activeUser];
  return {
    ...merged,
    data: {
      ...merged.data,
      batches: mergedBatches,
      userWorkspaces: {
        ...merged.data.userWorkspaces,
        [activeUser]: { ...(mergedWorkspace || localWorkspace), ...localWorkspace, activeBatchId },
      },
    },
  };
}

/** True until the active batch reaches final Admin confirmation and is released. */
export function shouldProtectTriage(_view: string, activeBatchId?: string, releasedBatchId?: string | null) {
  return Boolean(activeBatchId && releasedBatchId !== activeBatchId);
}

async function githubRequest(token: string, path: string, init?: RequestInit) {
  let response: Response;
  try {
    response = await fetch(`${GITHUB_API_URL}${path}`, {
      ...init,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        ...(init?.headers || {}),
      },
    });
  } catch {
    throw new GitHubWorkspaceError("Corporate GitHub could not be reached. Connect to the eBay network or VPN, confirm you are online, and try Sync & Pull again.", 0);
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { message?: string; errors?: ({ message?: string; code?: string } | string)[] };
    const detail = [body.message, ...(body.errors || []).map((item) => typeof item === "string" ? item : item.message || item.code)].filter(Boolean).join(" · ");
    const revisionConflict = (response.status === 409 && (!detail || /sha|already exists|conflict|does not match|fast.?forward|reference update/i.test(detail))) || (response.status === 422 && /sha|already exists|conflict|does not match|fast.?forward|reference update/i.test(detail));
    if (revisionConflict) throw new GitHubWorkspaceError("The shared workspace changed during this save.", 409);
    const fallback = response.status === 401 ? "Your Corporate GitHub token is invalid or expired. Brandmaster disconnected it from this browser; create a replacement token and reconnect."
      : response.status === 403 ? "Corporate GitHub denied this operation. Ask bmeshesha to grant your account Write access to Brandmaster-data, then use a token with Contents read/write—or a classic repo token."
      : response.status === 404 ? "Brandmaster-data is not visible to this account. Confirm you are on the eBay network or VPN and that bmeshesha added your Corporate GitHub username as a repository collaborator."
      : response.status === 413 ? "The shared workspace is too large for the GitHub Contents API."
      : response.status === 422 ? `GitHub rejected the workspace update${detail ? `: ${detail}` : "."}`
      : `Corporate GitHub request failed (${response.status}).`;
    throw new GitHubWorkspaceError([401, 403, 404, 413, 422].includes(response.status) ? fallback : detail || fallback, response.status);
  }
  return response;
}

export async function connectGitHubWorkspace(token: string) {
  const response = await githubRequest(token, "/user");
  return await response.json() as GitHubUser;
}

export async function verifyGitHubWorkspaceRepository(token: string) {
  await githubRequest(token, `/repos/${GITHUB_WORKSPACE_REPOSITORY}`);
}

/** Replaces only the sanitized static snapshot. It never publishes workspace rows or member attribution. */
export async function putGitHubPublicAnalyticsSnapshot(token: string, snapshot: PublicAnalyticsSnapshot) {
  const path = GITHUB_PUBLIC_ANALYTICS_PATH.split("/").map(encodeURIComponent).join("/");
  const resource = `/repos/${GITHUB_PUBLIC_ANALYTICS_REPOSITORY}/contents/${path}`;
  const content = `${JSON.stringify(snapshot, null, 2)}\n`;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const currentResponse = await githubRequest(token, `${resource}?ref=${encodeURIComponent(GITHUB_PUBLIC_ANALYTICS_BRANCH)}`);
    const current = await currentResponse.json() as { sha?: string; content?: string; encoding?: string };
    if (!current.sha) throw new GitHubWorkspaceError("The deployed public snapshot could not be located.", 422);
    if (current.content && current.encoding === "base64" && base64ToText(current.content) === content) return false;
    try {
      await githubRequest(token, resource, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `Update public team progress (${snapshot.workspaceUpdatedAt})`,
          content: textToBase64(content),
          branch: GITHUB_PUBLIC_ANALYTICS_BRANCH,
          sha: current.sha,
        }),
      });
      return true;
    } catch (cause) {
      if (!(cause instanceof GitHubWorkspaceError) || cause.status !== 409 || attempt === 2) throw cause;
    }
  }
  return false;
}

async function getHead(token: string) {
  const response = await githubRequest(token, `/repos/${GITHUB_WORKSPACE_REPOSITORY}/git/ref/heads/main`);
  const ref = await response.json() as { object?: { sha?: string } };
  if (!ref.object?.sha) throw new GitHubWorkspaceError("Corporate GitHub did not return the main branch revision.", 422);
  return ref.object.sha;
}

async function getContentText(token: string, path: string, ref: string) {
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  const resource = `/repos/${GITHUB_WORKSPACE_REPOSITORY}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`;
  const response = await githubRequest(token, resource);
  const metadata = await response.json() as { content?: string; encoding?: string };
  if (metadata.content && metadata.encoding === "base64") return base64ToText(metadata.content);
  const raw = await githubRequest(token, resource, { headers: { Accept: "application/vnd.github.raw+json" } });
  return await raw.text();
}

async function loadWorkspaceAtRef(token: string, ref: string) {
  const parsed = JSON.parse(await getContentText(token, GITHUB_WORKSPACE_PATH, ref)) as unknown;
  if (isWorkspaceManifest(parsed)) {
    const cache = new Map<string, Promise<string>>();
    const load = (path: string) => { if (!cache.has(path)) cache.set(path, getContentText(token, path, ref)); return cache.get(path)!; };
    return await hydrateWorkspaceManifest(parsed, load);
  }
  const workspace = parsed as SharedWorkspaceSnapshot;
  if (workspace.schemaVersion !== "brandmaster.workspace.v1" || !workspace.data || !Array.isArray(workspace.data.batches)) throw new GitHubWorkspaceError("The repository manifest is not a valid Brandmaster workspace.", 422);
  return workspace;
}

export async function getGitHubWorkspaceStatus(token: string): Promise<{ revision: string | null; sync?: SharedWorkspaceSnapshot["sync"] }> {
  const head = await getHead(token);
  try {
    const parsed = JSON.parse(await getContentText(token, GITHUB_WORKSPACE_PATH, head)) as unknown;
    if (isWorkspaceManifest(parsed)) return { revision: head, sync: parsed.sync };
    const legacy = parsed as SharedWorkspaceSnapshot;
    return legacy.schemaVersion === "brandmaster.workspace.v1" ? { revision: head, sync: legacy.sync } : { revision: null };
  } catch (cause) {
    if (cause instanceof GitHubWorkspaceError && cause.status === 404) return { revision: null };
    throw cause;
  }
}

export async function getGitHubWorkspace(token: string): Promise<GitHubWorkspaceFile> {
  const head = await getHead(token);
  try {
    const workspace = await loadWorkspaceAtRef(token, head);
    return { revision: head, workspace, updatedAt: workspace.exportedAt };
  } catch (cause) {
    if (cause instanceof GitHubWorkspaceError && cause.status === 404) return { revision: null, workspace: null };
    throw cause;
  }
}

export async function getGitHubWorkspaceAtRevision(token: string, revision: string): Promise<SharedWorkspaceSnapshot | null> {
  try { return await loadWorkspaceAtRef(token, revision); }
  catch {
    try {
      const response = await githubRequest(token, `/repos/${GITHUB_WORKSPACE_REPOSITORY}/git/blobs/${encodeURIComponent(revision)}`);
      const blob = await response.json() as { content?: string; encoding?: string };
      if (!blob.content || blob.encoding !== "base64") return null;
      const workspace = JSON.parse(base64ToText(blob.content)) as SharedWorkspaceSnapshot;
      return workspace.schemaVersion === "brandmaster.workspace.v1" && workspace.data && Array.isArray(workspace.data.batches) ? workspace : null;
    } catch { return null; }
  }
}

async function gitBlobSha(content: string) {
  const value = new TextEncoder().encode(content); const header = new TextEncoder().encode(`blob ${value.byteLength}\0`); const combined = new Uint8Array(header.byteLength + value.byteLength);
  combined.set(header); combined.set(value, header.byteLength);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-1", combined));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function mapLimited<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>) {
  const output = new Array<R>(items.length); let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) { const index = cursor; cursor += 1; output[index] = await task(items[index]); }
  }));
  return output;
}

export async function putGitHubWorkspace(token: string, workspace: SharedWorkspaceSnapshot, revision: string | null, login: string, changeCount = 1): Promise<GitHubWorkspaceFile> {
  const syncedAt = new Date().toISOString();
  const prepared: SharedWorkspaceSnapshot = { ...workspace, exportedAt: syncedAt, sync: { ...workspace.sync, lastSyncedAt: syncedAt, lastSyncedBy: login, history: [{ syncedAt, syncedBy: login, changeCount }, ...(workspace.sync?.history || [])].slice(0, 25) } };
  const head = await getHead(token);
  if (revision && revision !== head) throw new GitHubWorkspaceError("The shared workspace changed during this save.", 409);
  const commitResponse = await githubRequest(token, `/repos/${GITHUB_WORKSPACE_REPOSITORY}/git/commits/${head}`);
  const commit = await commitResponse.json() as { tree?: { sha?: string } }; if (!commit.tree?.sha) throw new GitHubWorkspaceError("GitHub did not return the current repository tree.", 422);
  const treeResponse = await githubRequest(token, `/repos/${GITHUB_WORKSPACE_REPOSITORY}/git/trees/${commit.tree.sha}?recursive=1`);
  const tree = await treeResponse.json() as { tree?: { path: string; type: string; sha: string }[] };
  const current = new Map((tree.tree || []).filter((entry) => entry.type === "blob").map((entry) => [entry.path, entry.sha]));
  if (!revision && current.has(GITHUB_WORKSPACE_PATH)) throw new GitHubWorkspaceError("The shared workspace changed during this save.", 409);
  const files = serializeWorkspaceFiles(prepared); const desiredPaths = new Set(Object.keys(files));
  const entries = await mapLimited(Object.entries(files), 4, async ([path, content]) => {
    const expected = await gitBlobSha(content); if (current.get(path) === expected) return null;
    const blobResponse = await githubRequest(token, `/repos/${GITHUB_WORKSPACE_REPOSITORY}/git/blobs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: textToBase64(content), encoding: "base64" }) });
    const blob = await blobResponse.json() as { sha?: string }; if (!blob.sha) throw new GitHubWorkspaceError(`GitHub did not create workspace chunk ${path}.`, 422);
    return { path, mode: "100644", type: "blob", sha: blob.sha };
  });
  const deletions = [...current.keys()].filter((path) => path.startsWith(WORKSPACE_DATA_PREFIX) && !desiredPaths.has(path)).map((path) => ({ path, mode: "100644", type: "blob", sha: null }));
  const changedEntries = [...entries.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)), ...deletions];
  const newTreeResponse = await githubRequest(token, `/repos/${GITHUB_WORKSPACE_REPOSITORY}/git/trees`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ base_tree: commit.tree.sha, tree: changedEntries }) });
  const newTree = await newTreeResponse.json() as { sha?: string }; if (!newTree.sha) throw new GitHubWorkspaceError("GitHub did not create the workspace tree.", 422);
  const newCommitResponse = await githubRequest(token, `/repos/${GITHUB_WORKSPACE_REPOSITORY}/git/commits`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: `Sync ${changeCount} Brandmaster change${changeCount === 1 ? "" : "s"} (${login})`, tree: newTree.sha, parents: [head] }) });
  const newCommit = await newCommitResponse.json() as { sha?: string }; if (!newCommit.sha) throw new GitHubWorkspaceError("GitHub did not create the workspace commit.", 422);
  await githubRequest(token, `/repos/${GITHUB_WORKSPACE_REPOSITORY}/git/refs/heads/main`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sha: newCommit.sha, force: false }) });
  return { revision: newCommit.sha, workspace: prepared, updatedAt: prepared.exportedAt };
}
