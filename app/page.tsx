"use client";

import BrandmasterApp from "@/components/brandmaster-app";
import AuthGate from "@/components/auth-gate";
import ClientErrorBoundary from "@/components/client-error-boundary";

export default function Home() {
  const localMode = process.env.NEXT_PUBLIC_LOCAL_MODE === "true";
  return <ClientErrorBoundary>{localMode ? <BrandmasterApp /> : <AuthGate>{(identity, signOut) => <BrandmasterApp authenticatedIdentity={identity} onAuthenticatedSignOut={signOut} />}</AuthGate>}</ClientErrorBoundary>;
}
