const CACHE = "brandmaster-static-1784216365006";
const BASE = "/Brandmaster";
const PRECACHE = [
  "/Brandmaster/404.html",
  "/Brandmaster/404/index.html",
  "/Brandmaster/_next/static/SqTLlWZIhuXjue9_7SbKk/_buildManifest.js",
  "/Brandmaster/_next/static/SqTLlWZIhuXjue9_7SbKk/_ssgManifest.js",
  "/Brandmaster/_next/static/chunks/255-12546c87896b2090.js",
  "/Brandmaster/_next/static/chunks/44530001-e9dd0a9ae538ccf0.js",
  "/Brandmaster/_next/static/chunks/4bd1b696-c023c6e3521b1417.js",
  "/Brandmaster/_next/static/chunks/979-ec7f1a89693d5494.js",
  "/Brandmaster/_next/static/chunks/app/_not-found/page-d51e196185abbbfa.js",
  "/Brandmaster/_next/static/chunks/app/layout-26d3f14294bc53a2.js",
  "/Brandmaster/_next/static/chunks/app/page-dae31a0e4825d9d8.js",
  "/Brandmaster/_next/static/chunks/framework-2c534e0e662575a2.js",
  "/Brandmaster/_next/static/chunks/main-app-3485f854aba1ca97.js",
  "/Brandmaster/_next/static/chunks/main-b5a943307cece8e0.js",
  "/Brandmaster/_next/static/chunks/pages/_app-7d307437aca18ad4.js",
  "/Brandmaster/_next/static/chunks/pages/_error-cb2a52f75f2162e2.js",
  "/Brandmaster/_next/static/chunks/polyfills-42372ed130431b0a.js",
  "/Brandmaster/_next/static/chunks/webpack-ed73d4d458c114f1.js",
  "/Brandmaster/_next/static/css/9468c8de19629cd5.css",
  "/Brandmaster/icon.svg",
  "/Brandmaster/index.html",
  "/Brandmaster/index.txt",
  "/Brandmaster/manifest.webmanifest"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key.startsWith("brandmaster-") && key !== CACHE).map((key) => caches.delete(key))
  )).then(() => self.clients.claim()));
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET" || new URL(event.request.url).origin !== self.location.origin) return;
  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).then((response) => {
      if (response.ok) caches.open(CACHE).then((cache) => cache.put(`/Brandmaster/index.html`, response.clone()));
      return response;
    }).catch(() => caches.match(`/Brandmaster/index.html`)));
    return;
  }
  event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
    if (response.ok) caches.open(CACHE).then((cache) => cache.put(event.request, response.clone()));
    return response;
  })));
});
