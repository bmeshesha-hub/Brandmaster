import type { NextConfig } from "next";

const isGitHubPages = process.env.BRANDMASTER_GITHUB_PAGES === "true";
const isStaticExport = isGitHubPages || process.env.BRANDMASTER_STATIC_EXPORT === "true";
const enableOffline = process.env.BRANDMASTER_STATIC_EXPORT === "true" && !isGitHubPages;
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
    // Hosted builds already have versioned assets. Keep the worker only for the
    // explicitly requested standalone offline export so Pages cannot pin old UI.
    NEXT_PUBLIC_ENABLE_OFFLINE: enableOffline ? "true" : "false",
  },
};

export default nextConfig;
