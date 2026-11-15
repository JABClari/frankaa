// Only for the Loading demo on this page, and registered only by it. A photo request carrying fk-slow waits that
// many ms (at most 10 s) before it is answered; one carrying fk-fail is refused the first time that exact address
// is asked for, so Retry brings it. Every other request goes to the network untouched.
const failed = new Set();
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (u.origin !== self.location.origin || e.request.method !== "GET") return;
  const slow = Number(u.searchParams.get("fk-slow")) || 0, fail = u.searchParams.has("fk-fail");
  if (!slow && !fail) return;
  e.respondWith((async () => {
    if (slow) await new Promise((r) => setTimeout(r, Math.min(10000, slow)));
    if (fail && !failed.has(u.href)) {
      failed.add(u.href);
      return new Response("", { status: 404, statusText: "Not found (loading demo)" });
    }
    return fetch(u.pathname);
  })());
});
