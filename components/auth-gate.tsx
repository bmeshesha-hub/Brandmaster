"use client";

import { Github, LoaderCircle, LockKeyhole, LogOut, RefreshCw, ShieldCheck } from "lucide-react";
import Image from "next/image";
import { ReactNode, useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { AuthenticatedBrandmasterUser, getSupabaseBrowserClient, githubIdentityProvider, githubLogin } from "@/lib/supabase-auth";

type AccessState = "loading" | "signed-out" | "checking" | "approved" | "pending" | "error" | "wrong-provider";

export default function AuthGate({ children }: { children: (identity: AuthenticatedBrandmasterUser | null, signOut: () => Promise<void>) => ReactNode }) {
  const client = getSupabaseBrowserClient();
  const [session, setSession] = useState<Session | null>(null);
  const [state, setState] = useState<AccessState>(client ? "loading" : "approved");
  const [identity, setIdentity] = useState<AuthenticatedBrandmasterUser | null>(null);
  const [message, setMessage] = useState("");

  const checkAccess = useCallback(async (nextSession: Session | null) => {
    setSession(nextSession); setIdentity(null); setMessage("");
    if (!client) { setState("approved"); return; }
    if (!nextSession?.user) { setState("signed-out"); return; }
    if (!githubIdentityProvider(nextSession.user)) { setState("wrong-provider"); return; }
    setState("checking");
    const login = githubLogin(nextSession.user);
    const { data, error } = await client.from("brandmaster_profiles").select("id,github_login,display_name,avatar_url,role,active").eq("id", nextSession.user.id).maybeSingle();
    if (error) {
      setMessage(error.message.includes("brandmaster_profiles") ? "The Brandmaster access tables have not been installed in Supabase yet." : error.message);
      setState("error"); return;
    }
    if (!data?.active) { setMessage(login ? `Signed in as @${login}, but this account is not approved yet.` : "This GitHub account is not approved yet."); setState("pending"); return; }
    const approved: AuthenticatedBrandmasterUser = {
      id: nextSession.user.id,
      login: data.github_login || login,
      displayName: data.display_name || nextSession.user.user_metadata?.name,
      avatarUrl: data.avatar_url || nextSession.user.user_metadata?.avatar_url,
      role: data.role,
    };
    setIdentity(approved); setState("approved");
    void client.from("brandmaster_profiles").update({ last_seen_at: new Date().toISOString() }).eq("id", approved.id);
  }, [client]);

  useEffect(() => {
    if (!client) return;
    let active = true;
    client.auth.getSession().then(({ data }) => active && void checkAccess(data.session));
    const { data: listener } = client.auth.onAuthStateChange((_event, nextSession) => { if (active) void checkAccess(nextSession); });
    return () => { active = false; listener.subscription.unsubscribe(); };
  }, [client, checkAccess]);

  async function signIn() {
    if (!client) return;
    setMessage("");
    const provider = (process.env.NEXT_PUBLIC_SUPABASE_GITHUB_PROVIDER || "custom:github-enterprise") as "github";
    const redirectTo = `${window.location.origin}${process.env.NEXT_PUBLIC_BASE_PATH || ""}/`;
    const { error } = await client.auth.signInWithOAuth({ provider, options: { redirectTo } });
    if (error) { setMessage(error.message); setState("error"); }
  }

  async function signOut() {
    if (!client) return;
    await client.auth.signOut(); setSession(null); setIdentity(null); setState("signed-out");
  }

  if (!client) return <>{children(null, signOut)}</>;
  if (state === "approved" && identity) return <>{children(identity, signOut)}</>;

  const loading = state === "loading" || state === "checking";
  return <main className="auth-page">
    <section className="auth-card" aria-live="polite">
      <div className="auth-logo"><Image src="/brandmaster-logo.jpeg" width={116} height={116} alt="Brandmaster" priority /></div>
      <span className="auth-eyebrow">SECURE TEAM WORKSPACE</span>
      <h1>{loading ? "Checking your access…" : state === "signed-out" ? "Welcome to Brandmaster" : state === "pending" ? "Approval needed" : state === "wrong-provider" ? "Corporate GitHub required" : "Login setup needs attention"}</h1>
      <p>{loading ? "Brandmaster is verifying your Corporate GitHub identity and team access." : state === "signed-out" ? "Sign in with your Corporate GitHub account to validate brands, claim team work and save shared progress." : state === "pending" ? message : state === "wrong-provider" ? "Sign out and use your Corporate GitHub account. Other login providers cannot access this workspace." : message}</p>
      {loading ? <div className="auth-loading"><LoaderCircle size={24} /><span>Securely verifying your account</span></div> : state === "signed-out" ? <button className="auth-github" onClick={signIn}><Github size={21} />Continue with Corporate GitHub</button> : <div className="auth-actions">
        {state === "error" && <button className="auth-secondary" onClick={() => void checkAccess(session)}><RefreshCw size={17} />Try again</button>}
        <button className="auth-secondary" onClick={signOut}><LogOut size={17} />Sign out</button>
      </div>}
      <div className="auth-trust"><span><ShieldCheck size={16} />Approved users only</span><span><LockKeyhole size={16} />Protected by Supabase</span></div>
    </section>
  </main>;
}
