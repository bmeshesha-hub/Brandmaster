"use client";

import BrandmasterApp from "@/components/brandmaster-app";
import AuthGate from "@/components/auth-gate";
import ClientErrorBoundary from "@/components/client-error-boundary";

export default function Home() {
  return <ClientErrorBoundary><AuthGate>{(identity, signOut) => <BrandmasterApp authenticatedIdentity={identity} onAuthenticatedSignOut={signOut} />}</AuthGate></ClientErrorBoundary>;
}
