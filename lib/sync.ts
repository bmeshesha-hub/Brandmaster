import { SharedWorkspaceSnapshot } from "./types";

export interface SyncSession { authenticated: boolean; user?: { login: string; name?: string; avatarUrl?: string }; repository?: string; }
export interface RemoteWorkspace { revision: string | null; updatedAt?: string; updatedBy?: string; workspace: SharedWorkspaceSnapshot | null; }

const cleanBase = (value: string) => value.trim().replace(/\/+$/, "");
async function request<T>(serviceUrl: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${cleanBase(serviceUrl)}${path}`, { ...init, credentials: "include", headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.detail === "string" ? body.detail : `Sync request failed (${response.status})`);
  return body as T;
}

export const syncLoginUrl = (serviceUrl: string, returnTo: string) => `${cleanBase(serviceUrl)}/auth/login?return_to=${encodeURIComponent(returnTo)}`;
export const getSyncSession = (serviceUrl: string) => request<SyncSession>(serviceUrl, "/api/session");
export const pullSharedWorkspace = (serviceUrl: string) => request<RemoteWorkspace>(serviceUrl, "/api/workspace");
export const pushSharedWorkspace = (serviceUrl: string, workspace: SharedWorkspaceSnapshot, baseRevision: string | null) => request<RemoteWorkspace>(serviceUrl, "/api/workspace", { method: "PUT", body: JSON.stringify({ baseRevision, workspace }) });
export const logoutSync = (serviceUrl: string) => request<{ ok: boolean }>(serviceUrl, "/api/logout", { method: "POST" });
