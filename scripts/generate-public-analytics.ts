import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildPublicAnalyticsSnapshot } from "../lib/public-analytics";
import { hydrateWorkspaceManifest, isWorkspaceManifest } from "../lib/workspace-chunks";

async function main() {
  const workspaceRoot = path.resolve(process.argv[2] || process.env.BRANDMASTER_WORKSPACE_DIR || ".");
  const output = path.resolve(process.argv[3] || "public/analytics-snapshot.json");
  const manifestPath = path.join(workspaceRoot, "brandmaster/workspace.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
  if (!isWorkspaceManifest(manifest)) throw new Error("Expected a brandmaster.workspace-manifest.v1 workspace.");
  const workspace = await hydrateWorkspaceManifest(manifest, (file) => readFile(path.join(workspaceRoot, file), "utf8"));
  const snapshot = buildPublicAnalyticsSnapshot(workspace);
  await writeFile(output, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`Generated sanitized group-only public analytics snapshot at ${output}`);
}

void main();
