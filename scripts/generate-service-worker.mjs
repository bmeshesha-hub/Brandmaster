import { readdir, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";

const outputDir = process.argv[2] || "out";
const basePath = (process.argv[3] || "").replace(/\/$/, "");

async function filesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesIn(path) : path;
  }));
  return files.flat();
}

const cacheableExtensions = /\.(?:html|css|js|json|webmanifest|svg|png|ico|txt)$/i;
const assets = (await filesIn(outputDir))
  .filter((file) => cacheableExtensions.test(file) && !file.endsWith(`${sep}sw.js`))
  .map((file) => `${basePath}/${relative(outputDir, file).split(sep).join("/")}`)
  .sort();

const source = `const CACHE = "brandmaster-static-${Date.now()}";
const BASE = ${JSON.stringify(basePath)};
const PRECACHE = ${JSON.stringify(assets, null, 2)};

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => {
    // Keep the current and immediately previous release. An already-open tab may
    // still request a hashed JavaScript chunk from the prior Pages deployment.
    const releases = keys.filter((key) => key.startsWith("brandmaster-static-")).sort().reverse();
    return Promise.all(releases.slice(2).map((key) => caches.delete(key)));
  }).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).then((response) => {
      if (response.ok) caches.open(CACHE).then((cache) => cache.put(\`${basePath}/index.html\`, response.clone()));
      return response;
    }).catch(() => caches.match(\`${basePath}/index.html\`)));
    return;
  }
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
    if (response.ok) caches.open(CACHE).then((cache) => cache.put(event.request, response.clone()));
    return response;
  })));
});
`;

await writeFile(join(outputDir, "sw.js"), source);
console.log(`Generated offline service worker with ${assets.length} cached files.`);
