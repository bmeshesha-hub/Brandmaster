import { spawn } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const localFolder = process.env.BRANDMASTER_LOCAL_FOLDER || `${root}/../Brandmaster-data/local`;
const children = [
  spawn(process.execPath, ["enrichment-service/local-server.mjs"], { cwd: root, env: { ...process.env, BRANDMASTER_LOCAL_FOLDER: localFolder }, stdio: "inherit" }),
  spawn(path.join(root, "node_modules", ".bin", "next"), ["dev", "--port", "3001"], { cwd: root, env: { ...process.env, NEXT_PUBLIC_LOCAL_MODE: "true" }, stdio: "inherit", shell: process.platform === "win32" }),
];
function stop() { children.forEach((child) => { if (!child.killed) child.kill("SIGTERM"); }); }
process.on("SIGINT", stop); process.on("SIGTERM", stop);
children.forEach((child) => child.on("exit", (code) => { if (code && code !== 130) stop(); }));
