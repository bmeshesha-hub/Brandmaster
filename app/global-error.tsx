"use client";

import { useEffect, useState } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    console.error("Brandmaster application error", error);
  }, [error]);

  async function refreshApplication() {
    setClearing(true);
    if ("caches" in globalThis) {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key.startsWith("brandmaster-static-")).map((key) => caches.delete(key)));
    }
    const registrations = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistrations() : [];
    await Promise.all(registrations.map((registration) => registration.update().catch(() => undefined)));
    location.reload();
  }

  return <html lang="en"><body><main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, fontFamily: "Arial, sans-serif", background: "#f7f8fa", color: "#191919" }}><section style={{ width: "min(620px, 100%)", padding: 32, border: "1px solid #c7cbd1", borderRadius: 14, background: "white", boxShadow: "0 18px 50px rgba(0,0,0,.08)" }}><small style={{ color: "#3665f3", fontWeight: 800, letterSpacing: ".12em" }}>BRANDMASTER RECOVERY</small><h1 style={{ margin: "10px 0", fontSize: 30 }}>The page needs a fresh application bundle</h1><p style={{ color: "#5c5f66", lineHeight: 1.6 }}>Your saved workspace and GitHub token will remain in this browser. Refresh the application files, then continue from the same workflow step.</p><div style={{ display: "flex", gap: 10, marginTop: 22, flexWrap: "wrap" }}><button onClick={() => void refreshApplication()} disabled={clearing} style={{ minHeight: 44, padding: "0 18px", border: 0, borderRadius: 8, background: "#3665f3", color: "white", fontWeight: 800, cursor: "pointer" }}>{clearing ? "Refreshing…" : "Refresh Brandmaster"}</button><button onClick={reset} style={{ minHeight: 44, padding: "0 18px", border: "1px solid #c7cbd1", borderRadius: 8, background: "white", color: "#191919", fontWeight: 800, cursor: "pointer" }}>Try again</button></div></section></main></body></html>;
}
