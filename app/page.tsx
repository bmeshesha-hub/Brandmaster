"use client";

import BrandmasterApp from "@/components/brandmaster-app";
import AuthGate from "@/components/auth-gate";

export default function Home() {
  return <AuthGate>{(identity, signOut) => <BrandmasterApp authenticatedIdentity={identity} onAuthenticatedSignOut={signOut} />}</AuthGate>;
}
