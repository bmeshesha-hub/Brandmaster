import { cp, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
const remote = process.argv[2] || "origin";
const branch = process.argv[3] || "gh-pages";
const temporaryRoot = await mkdtemp(join(tmpdir(), "brandmaster-pages-"));
const worktree = join(temporaryRoot, "site");

const git = (args, options = {}) => execFileSync("git", args, {
  cwd: options.cwd || root,
  encoding: "utf8",
  stdio: options.stdio || "pipe",
});

let worktreeAdded = false;

try {
  let base = "HEAD";
  const remoteTrackingBranch = `refs/remotes/${remote}/${branch}`;
  try {
    git(["fetch", remote, `refs/heads/${branch}:${remoteTrackingBranch}`]);
    base = remoteTrackingBranch;
  } catch {
    // A temporary network failure must not make the next Pages commit diverge.
    // Reuse the last fetched deployment when it exists; only a first-ever
    // publication starts from the current source commit.
    try {
      git(["rev-parse", "--verify", remoteTrackingBranch]);
      base = remoteTrackingBranch;
    } catch { /* first publication */ }
  }

  git(["worktree", "add", "--detach", worktree, base], { stdio: "inherit" });
  worktreeAdded = true;

  for (const entry of await readdir(worktree)) {
    if (entry !== ".git") await rm(join(worktree, entry), { recursive: true, force: true });
  }

  for (const entry of await readdir(join(root, "out"))) {
    await cp(join(root, "out", entry), join(worktree, entry), { recursive: true });
  }
  await writeFile(join(worktree, ".nojekyll"), "");

  git(["add", "-A"], { cwd: worktree });
  const changes = git(["status", "--porcelain"], { cwd: worktree }).trim();
  git(changes
    ? ["commit", "-m", "Deploy Brandmaster to GitHub Pages"]
    : ["commit", "--allow-empty", "-m", "Redeploy Brandmaster to GitHub Pages"], { cwd: worktree, stdio: "inherit" });
  git(["push", remote, `HEAD:refs/heads/${branch}`], { cwd: worktree, stdio: "inherit" });
  console.log(`Published Brandmaster to ${remote}/${branch}.`);
} finally {
  if (worktreeAdded) {
    try { git(["worktree", "remove", "--force", worktree]); } catch { /* leave recovery information intact */ }
  }
  await rm(temporaryRoot, { recursive: true, force: true });
}
