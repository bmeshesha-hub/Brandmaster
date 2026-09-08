import { FlatCompat } from "@eslint/eslintrc";
import { defineConfig, globalIgnores } from "eslint/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const baseDirectory = path.dirname(fileURLToPath(import.meta.url));
const compat = new FlatCompat({ baseDirectory });

export default defineConfig([
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  // Tess CI checks out its build-ebay helper repository inside the workspace;
  // it is third-party generated tooling, not application source.
  globalIgnores([".next/**", "out/**", "Brandmaster/**", "build-ebay/**", ".yarn-cache/**", "next-env.d.ts"]),
]);
