import { SharedWorkspaceSnapshot } from "./types";

export interface SyncSession { authenticated: boolean; user?: { login: string; name?: string; avatarUrl?: string }; repository?: string; }
export interface RemoteWorkspace { revision: string | null; updatedAt?: string; updatedBy?: string; workspace: SharedWorkspaceSnapshot | null; }
export interface CoreAIStatus { enabled: boolean; environment: "staging"; model: string; sandboxModel: boolean; endpointConfigured: boolean; }
export interface CoreAIReviewResponse { requestId: string | null; model: string; response: string; }

const cleanBase = (value: string) => value.trim().replace(/\/+$/, "");
async function request<T>(serviceUrl: string, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${cleanBase(serviceUrl)}${path}`, { ...init, credentials: "include", headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.detail === "string" ? body.detail : `Sync request failed (${response.status})`);
  return body as T;
}

export const syncLoginUrl = (serviceUrl: string, returnTo: string) => `${cleanBase(serviceUrl)}/auth/login?return_to=${encodeURIComponent(returnTo)}`;
export const getSyncSession = (serviceUrl: string) => request<SyncSession>(serviceUrl, "/api/session", { cache: "no-store" });
export const getCoreAIStatus = (serviceUrl: string) => request<CoreAIStatus>(serviceUrl, "/api/ai/status");
export const runCoreAIReview = (serviceUrl: string, prompt: string, requestId: string) => request<CoreAIReviewResponse>(serviceUrl, "/api/ai/review", { method: "POST", body: JSON.stringify({ prompt, requestId }) });
export const pullSharedWorkspace = (serviceUrl: string) => request<RemoteWorkspace>(serviceUrl, "/api/workspace");
export const pushSharedWorkspace = (serviceUrl: string, workspace: SharedWorkspaceSnapshot, baseRevision: string | null) => request<RemoteWorkspace>(serviceUrl, "/api/workspace", { method: "PUT", body: JSON.stringify({ baseRevision, workspace }) });
export const logoutSync = (serviceUrl: string) => request<{ ok: boolean }>(serviceUrl, "/api/logout", { method: "POST" });
