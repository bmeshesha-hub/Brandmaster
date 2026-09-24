"use client";

import { AboutBrandmaster } from "@/components/brandmaster-app";
import Link from "next/link";

const appUrl = `${process.env.NEXT_PUBLIC_BASE_PATH || ""}/?view=imports`;

export default function AboutPage() {
  return (
    <main className="about-standalone">
      <header className="about-standalone-header">
        <Link href="/?view=imports" aria-label="Back to Brandmaster">Brandmaster</Link>
        <Link href="/?view=imports">Open the app</Link>
      </header>
      <AboutBrandmaster onNavigate={() => { window.location.assign(appUrl); }} />
    </main>
  );
}
