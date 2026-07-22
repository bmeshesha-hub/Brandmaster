import type { NextConfig } from "next";

const isGitHubPages = process.env.BRANDMASTER_GITHUB_PAGES === "true";
const isStaticExport = isGitHubPages || process.env.BRANDMASTER_STATIC_EXPORT === "true";
const pagesBasePath = process.env.BRANDMASTER_PAGES_BASE_PATH || "/bmeshesha/Brandmaster";
const basePath = isGitHubPages ? pagesBasePath : "";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  ...(isStaticExport
    ? {
        output: "export" as const,
        trailingSlash: true,
        basePath,
      }
    : {}),
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
    // Vercel serves versioned Next.js assets itself. Registering the offline
    // Pages worker there can leave an open tab with chunks from two releases.
    NEXT_PUBLIC_ENABLE_OFFLINE: isStaticExport ? "true" : "false",
  },
};

export default nextConfig;
