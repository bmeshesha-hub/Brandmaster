import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildPublicAnalyticsSnapshot } from "../lib/public-analytics";
import { hydrateWorkspaceManifest, isWorkspaceManifest } from "../lib/workspace-chunks";

async function main() {
  const explicitWorkspaceRoot = process.argv[2] || process.env.BRANDMASTER_WORKSPACE_DIR;
  const workspaceRoot = path.resolve(explicitWorkspaceRoot || "../GitHub/Brandmaster-data");
  const output = path.resolve(process.argv[3] || "public/analytics-snapshot.json");
  let sourceRoot = workspaceRoot;
  let temporaryWorktree: string | undefined;
  try {
    if (!explicitWorkspaceRoot) {
      execFileSync("git", ["-C", workspaceRoot, "fetch", "origin", "main"], { stdio: "inherit" });
      const revision = execFileSync("git", ["-C", workspaceRoot, "rev-parse", "FETCH_HEAD"], { encoding: "utf8" }).trim();
      temporaryWorktree = await mkdtemp(path.join(tmpdir(), "brandmaster-analytics-data-"));
      await rm(temporaryWorktree, { recursive: true, force: true });
      execFileSync("git", ["-C", workspaceRoot, "worktree", "add", "--detach", temporaryWorktree, revision], { stdio: "inherit" });
      sourceRoot = temporaryWorktree;
    }

    const manifestPath = path.join(sourceRoot, "brandmaster/workspace.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as unknown;
    if (!isWorkspaceManifest(manifest)) throw new Error("Expected a brandmaster.workspace-manifest.v1 workspace.");
    const workspace = await hydrateWorkspaceManifest(manifest, (file) => readFile(path.join(sourceRoot, file), "utf8"));
    const snapshot = buildPublicAnalyticsSnapshot(workspace);
    await writeFile(output, `${JSON.stringify(snapshot, null, 2)}\n`);
    console.log(`Generated sanitized group-only public analytics snapshot at ${output}`);
  } finally {
    if (temporaryWorktree) {
      execFileSync("git", ["-C", workspaceRoot, "worktree", "remove", "--force", temporaryWorktree], { stdio: "inherit" });
    }
  }
}

void main();
