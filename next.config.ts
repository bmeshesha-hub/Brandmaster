import type { NextConfig } from "next";

const isGitHubPages = process.env.BRANDMASTER_GITHUB_PAGES === "true";
const isStaticExport = isGitHubPages || process.env.BRANDMASTER_STATIC_EXPORT === "true";
const basePath = isGitHubPages ? "/Brandmaster" : "";

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
  },
};

export default nextConfig;
