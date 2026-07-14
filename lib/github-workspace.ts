import { SharedWorkspaceSnapshot } from "./types";

export const GITHUB_BASE_URL = "https://github.corp.ebay.com";
export const GITHUB_API_URL = `${GITHUB_BASE_URL}/api/v3`;
export const GITHUB_WORKSPACE_REPOSITORY = "bmeshesha/Brandmaster-data";
export const GITHUB_WORKSPACE_PATH = "brandmaster/workspace.json";

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

async function githubRequest(token: string, path: string, init?: RequestInit) {
  const response = await fetch(`${GITHUB_API_URL}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers || {}),
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { message?: string };
    const fallback = response.status === 401 ? "The repository token is invalid or expired."
      : response.status === 403 ? "This token cannot access Brandmaster-data. Check its repository and Contents permissions."
      : response.status === 404 ? "Brandmaster-data is not available to this GitHub account or app token."
      : response.status === 409 || response.status === 422 ? "The shared workspace changed before this update could be saved. Pull the latest version first."
      : `Corporate GitHub request failed (${response.status}).`;
    throw new GitHubWorkspaceError([401, 403, 404, 409, 422].includes(response.status) ? fallback : body.message || fallback, response.status);
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

export async function getGitHubWorkspace(token: string): Promise<GitHubWorkspaceFile> {
  const resource = `/repos/${GITHUB_WORKSPACE_REPOSITORY}/contents/${GITHUB_WORKSPACE_PATH}?ref=main`;
  let response: Response;
  try { response = await githubRequest(token, resource); }
  catch (cause) {
    if (cause instanceof GitHubWorkspaceError && cause.status === 404) return { revision: null, workspace: null };
    throw cause;
  }
  const metadata = await response.json() as { sha: string; content?: string; encoding?: string; size?: number };
  let text = metadata.content && metadata.encoding === "base64" ? base64ToText(metadata.content) : "";
  if (!text) {
    const raw = await githubRequest(token, resource, { headers: { Accept: "application/vnd.github.raw+json" } });
    text = await raw.text();
  }
  const workspace = JSON.parse(text) as SharedWorkspaceSnapshot;
  if (workspace.schemaVersion !== "brandmaster.workspace.v1" || !workspace.data || !Array.isArray(workspace.data.batches)) throw new GitHubWorkspaceError("The repository file is not a valid Brandmaster workspace.", 422);
  return { revision: metadata.sha, workspace, updatedAt: workspace.exportedAt };
}

export async function putGitHubWorkspace(token: string, workspace: SharedWorkspaceSnapshot, revision: string | null, login: string): Promise<GitHubWorkspaceFile> {
  const body: Record<string, unknown> = {
    message: `Sync Brandmaster workspace (${login})`,
    content: textToBase64(JSON.stringify(workspace, null, 2)),
    branch: "main",
  };
  if (revision) body.sha = revision;
  const response = await githubRequest(token, `/repos/${GITHUB_WORKSPACE_REPOSITORY}/contents/${GITHUB_WORKSPACE_PATH}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json() as { content?: { sha?: string }; commit?: { sha?: string } };
  return { revision: result.content?.sha || result.commit?.sha || null, workspace, updatedAt: workspace.exportedAt };
}
