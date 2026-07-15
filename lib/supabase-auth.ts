import { createClient, SupabaseClient, User } from "@supabase/supabase-js";

export type BrandmasterRole = "admin" | "reviewer" | "viewer";

export interface AuthenticatedBrandmasterUser {
  id: string;
  login: string;
  displayName?: string;
  avatarUrl?: string;
  role: BrandmasterRole;
}

let browserClient: SupabaseClient | null | undefined;

export function getSupabaseBrowserClient() {
  if (browserClient !== undefined) return browserClient;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  browserClient = url && key
    ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } })
    : null;
  return browserClient;
}

export function githubIdentityProvider(user: User) {
  const providers = [
    user.app_metadata?.provider,
    ...(Array.isArray(user.app_metadata?.providers) ? user.app_metadata.providers : []),
    ...(user.identities || []).map((identity) => identity.provider),
  ].filter((value): value is string => typeof value === "string");
  return providers.some((provider) => provider.toLowerCase().includes("github"));
}

export function githubLogin(user: User) {
  const metadata = user.user_metadata || {};
  const value = metadata.user_name || metadata.preferred_username || metadata.login || metadata.nickname || user.email?.split("@")[0] || "";
  return String(value).trim().replace(/^@+/, "").toLowerCase();
}
