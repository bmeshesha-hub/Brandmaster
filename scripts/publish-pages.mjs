import { cp, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
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
  try {
    git(["ls-remote", "--exit-code", "--heads", "origin", "gh-pages"]);
    git(["fetch", "origin", "gh-pages"]);
    base = "origin/gh-pages";
  } catch {
    // The first publication starts from the current commit.
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
  if (changes) git(["commit", "-m", "Deploy Brandmaster to GitHub Pages"], { cwd: worktree, stdio: "inherit" });
  git(["push", "origin", "HEAD:refs/heads/gh-pages"], { cwd: worktree, stdio: "inherit" });
  console.log("Published Brandmaster to the gh-pages branch.");
} finally {
  if (worktreeAdded) {
    try { git(["worktree", "remove", "--force", worktree]); } catch { /* leave recovery information intact */ }
  }
  await rm(temporaryRoot, { recursive: true, force: true });
}
