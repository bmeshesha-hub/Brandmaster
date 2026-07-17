const CACHE = "brandmaster-static-1784308133572";
const BASE = "/Brandmaster";
const PRECACHE = [
  "/Brandmaster/404.html",
  "/Brandmaster/404/index.html",
  "/Brandmaster/_next/static/ZplDI4MyZR2c5M66ZvbFj/_buildManifest.js",
  "/Brandmaster/_next/static/ZplDI4MyZR2c5M66ZvbFj/_ssgManifest.js",
  "/Brandmaster/_next/static/chunks/164f4fb6.ca8844c7aa0d818b.js",
  "/Brandmaster/_next/static/chunks/199.829cec104a19a84e.js",
  "/Brandmaster/_next/static/chunks/241.8d5142e5ca2adc27.js",
  "/Brandmaster/_next/static/chunks/255-5e120800b5ec7605.js",
  "/Brandmaster/_next/static/chunks/2f0b94e8.ea60580ce276fab2.js",
  "/Brandmaster/_next/static/chunks/44530001-4b076bc63a2b1d27.js",
  "/Brandmaster/_next/static/chunks/4bd1b696-409494caf8c83275.js",
  "/Brandmaster/_next/static/chunks/694-1464c61664ead412.js",
  "/Brandmaster/_next/static/chunks/931.8f418dfbd7239db6.js",
  "/Brandmaster/_next/static/chunks/ad2866b8.635304a38afc0b68.js",
  "/Brandmaster/_next/static/chunks/app/_not-found/page-75050ae25a55d1a2.js",
  "/Brandmaster/_next/static/chunks/app/layout-0e7ecc78d624b368.js",
  "/Brandmaster/_next/static/chunks/app/page-7670f59dc8debdf7.js",
  "/Brandmaster/_next/static/chunks/bc98253f.d6fc8a0138855acd.js",
  "/Brandmaster/_next/static/chunks/framework-f52ebcb9f26a1e11.js",
  "/Brandmaster/_next/static/chunks/main-10008fbc38c32a00.js",
  "/Brandmaster/_next/static/chunks/main-app-79f6191bb81a2089.js",
  "/Brandmaster/_next/static/chunks/pages/_app-5addca2b3b969fde.js",
  "/Brandmaster/_next/static/chunks/pages/_error-022e4ac7bbb9914f.js",
  "/Brandmaster/_next/static/chunks/polyfills-42372ed130431b0a.js",
  "/Brandmaster/_next/static/chunks/webpack-870a38a3da162a0e.js",
  "/Brandmaster/_next/static/css/3bb986f6a230aaf4.css",
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
