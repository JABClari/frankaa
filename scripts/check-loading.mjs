// A browser check of the lightbox's loading state, in both renderers: a move leaves the old photo at once for the
// next one's preview and loading look; the ring waits for loadingDelay, then completes and goes when the photo
// arrives; a photo with no preview gets an empty frame; a failure shows the message and Retry, and Retry recovers;
// rapid moves end on the last one; a photo in the cache never shows the ring.
// The server slows photos down with ?slow=ms and fails them with ?fail=1 until /__heal is called.
// Run after `npm run build`:
//   PLAYWRIGHT=/path/to/node_modules/playwright node scripts/check-loading.mjs
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");
const root = fileURLToPath(new URL("../docs/", import.meta.url));
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".txt": "text/plain" };
let healed = false;
const DELAYS = new Map([500, 1200, 1500, 2500, 3000, 5000].map((ms) => [String(ms), ms]));
const server = createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/__heal") { healed = true; res.writeHead(204).end(); return; }
  const path = normalize(join(root, decodeURIComponent(u.pathname)));
  if (!path.startsWith(root)) { res.writeHead(403).end(); return; }
  if (u.searchParams.has("fail") && !healed) { res.writeHead(404).end(); return; }
  // Only the delays these checks use: a request can pick one, never set its own.
  const slow = DELAYS.get(u.searchParams.get("slow") ?? "") ?? 0;
  if (slow) await new Promise((r) => setTimeout(r, slow));
  try {
    const body = await readFile(path.endsWith("/") ? join(path, "index.html") : path);
    res.writeHead(200, { "content-type": types[extname(path)] || "application/octet-stream", "cache-control": "no-store" }).end(body);
  } catch { res.writeHead(404).end(); }
}).listen(0);
const base = `http://localhost:${server.address().port}`;

const failures = [];
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failures.push(what); };

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
// Each run uses fresh query strings, so nothing comes from an earlier run's cache.
let run = 0;
try {
  for (const renderer of ["webgl", "css"]) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 760 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`${base}/index.html`, { waitUntil: "networkidle" });
    await page.evaluate(async () => {
      document.body.replaceChildren();
      window.__m = await import("./lib/index.js");
      window.__ev = [];
      for (const n of ["open-end", "change", "error", "load-start", "load-end", "animation-end"]) document.addEventListener("frankaa:" + n, (e) => window.__ev.push([n, e.detail]));
    });
    // The mean colour of the photo's box from a screenshot (works for the WebGL canvas too).
    const mean = async () => {
      const r = await page.evaluate(() => { const b = document.querySelector(".fk-unfurl-load:not([hidden])")?.getBoundingClientRect(); return b && b.width > 4 ? { x: b.x, y: b.y, w: b.width, h: b.height } : null; });
      const box = r ?? { x: 400, y: 280, w: 300, h: 200 };
      const clip = { x: box.x + box.w * 0.3, y: box.y + box.h * 0.3, width: Math.max(8, box.w * 0.4), height: Math.max(8, box.h * 0.4) };
      const png = (await page.screenshot({ clip })).toString("base64");
      return page.evaluate(async (b64) => {
        const bm = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
        const c = new OffscreenCanvas(bm.width, bm.height), x = c.getContext("2d");
        x.drawImage(bm, 0, 0);
        const d = x.getImageData(0, 0, bm.width, bm.height).data;
        const m = [0, 0, 0];
        for (let k = 0; k < d.length; k += 4) { m[0] += d[k]; m[1] += d[k + 1]; m[2] += d[k + 2]; }
        return m.map((v) => v / (d.length / 4));
      }, png);
    };
    const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const ring = () => page.evaluate(() => document.querySelector(".fk-unfurl-load")?.dataset.ring === "spin" && !document.querySelector(".fk-unfurl-load").hidden);
    const counter = () => page.evaluate(() => document.querySelector(".fk-unfurl-n")?.textContent);
    const open = async (photos, o = {}) => {
      await page.evaluate(([photos, r, o]) => { window.__ev.length = 0; window.__lb?.destroy(); window.__lb = window.__m.unfurl({ photos, renderer: r, effect: "fade", ...o }); }, [photos, renderer, o]);
      await page.waitForFunction(() => window.__ev.some(([n]) => n === "open-end"), null, { timeout: 8000 });
      // A photo that opened with its loading look: wait for it to arrive and settle.
      await page.waitForFunction(() => !window.__ev.some(([n]) => n === "load-start") || window.__ev.some(([n]) => n === "load-end"), null, { timeout: 8000 });
      await page.waitForTimeout(400);
      if (await page.evaluate(() => window.__ev.some(([n]) => n === "load-start"))) await page.waitForTimeout(900);
      await page.evaluate(() => { window.__ev = window.__ev.filter(([n]) => n === "error"); });
    };
    const tag = () => `r${++run}`;
    const names = ["h17", "h38", "h21", "h30"];
    // Reference colours: each photo at rest, opened on its own.
    const ref = [];
    for (const k of [0, 1, 2, 3]) { await open([`photos/${names[k]}-800.jpg`]); ref.push(await mean()); }

    // 1. A slow photo: the move leaves the old photo at once; the ring waits; the photo arrives in place.
    let t = tag();
    await open(names.map((n, i) => ({ src: `photos/${n}-800.jpg?${t}${i === 2 ? "&slow=5000" : ""}`, thumb: `photos/${n}-800.jpg`, alt: `Photo ${i + 1}` })), { start: 1 });
    const before = await mean();
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(100);
    check(!(await ring()), `${renderer}: no ring at 100 ms`);
    const at150 = await mean();
    check(dist(at150, before) > 12, `${renderer}: the picture leaves the old photo at once (${dist(at150, before).toFixed(0)})`);
    check((await counter()) === "3 / 4", `${renderer}: the counter moved with it`);
    await page.waitForTimeout(500);
    check(await ring(), `${renderer}: the ring is there by 600 ms`);
    check(await page.evaluate(() => document.querySelector(".fk-unfurl-load").getAttribute("aria-busy") === "true"), `${renderer}: aria-busy while loading`);
    check(await page.evaluate(() => document.querySelector(".fk-unfurl .fk-sr").textContent === "Loading photo 3"), `${renderer}: screen readers hear "Loading photo 3"`);
    check(await page.evaluate(() => window.__ev.filter(([n]) => n === "load-start").length === 1), `${renderer}: onLoadStart fired`);
    await page.waitForFunction(() => window.__ev.some(([n]) => n === "load-end"), null, { timeout: 8000 });
    await page.waitForTimeout(1300);
    check(!(await ring()) && (await page.evaluate(() => document.querySelector(".fk-unfurl-load").hidden)), `${renderer}: the ring is gone after the photo arrives`);
    const after = await mean();
    check(dist(after, ref[2]) < 10, `${renderer}: the full photo is shown (${dist(after, ref[2]).toFixed(1)} from photo 3)`);
    check(await page.evaluate(() => window.__ev.filter(([n]) => n === "error").length === 0), `${renderer}: no error for a slow photo`);

    // 2. A photo in the cache (the neighbour, loaded ahead) never shows the ring or the loading look.
    await page.evaluate(() => { window.__ev.length = 0; });
    await page.keyboard.press("ArrowLeft");
    let rang = false;
    for (let k = 0; k < 8; k++) { await page.waitForTimeout(100); rang ||= await ring(); }
    check(!rang && (await page.evaluate(() => !window.__ev.some(([n]) => n === "load-start"))), `${renderer}: a cached photo never shows the ring`);

    // 3. No preview: an empty frame in the photo's shape with the material, never the old photo.
    t = tag();
    await open([`photos/h17-800.jpg`, `photos/h38-800.jpg?${t}&slow=2500`]);
    const nb = await mean();
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(700);
    const frame = await page.evaluate(() => { const b = document.querySelector(".fk-unfurl-load")?.getBoundingClientRect(); return b ? b.width * b.height : 0; });
    const np = await mean();
    check(frame > 1000, `${renderer}: the no-preview frame has a shape`);
    check(dist(np, nb) > 12 && Math.max(...np) - Math.min(...np) < 40, `${renderer}: it shows the neutral material, not the old photo (${np.map((v) => v.toFixed(0)).join(",")})`);
    await page.screenshot({ path: `${process.env.SHOTS || "/tmp"}/check-loading-${renderer}-nopreview.png` }).catch(() => {});
    await page.waitForFunction(() => window.__ev.some(([n]) => n === "load-end"), null, { timeout: 8000 });

    // 4. Failure: the message and Retry inside the frame; onError as before; Retry recovers.
    healed = false;
    t = tag();
    await open([{ src: "photos/h17-800.jpg" }, { src: `photos/h21-800.jpg?${t}&fail=1`, thumb: "photos/h21-800.jpg" }]);
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(() => window.__ev.some(([n]) => n === "error"), null, { timeout: 8000 });
    await page.waitForTimeout(300);
    const f = await page.evaluate(() => ({ msg: document.querySelector(".fk-unfurl-fail-msg")?.textContent, vis: document.querySelector(".fk-unfurl-fail") && getComputedStyle(document.querySelector(".fk-unfurl-fail")).display !== "none", retry: document.querySelector(".fk-unfurl-retry")?.textContent, err: window.__ev.filter(([n]) => n === "error").map(([, d]) => `${d.reason}/${d.fallback}`) }));
    check(f.vis && f.msg === "This photo didn't load" && f.retry === "Retry", `${renderer}: a failed photo shows the message and Retry`);
    check(JSON.stringify(f.err) === JSON.stringify(["load/none"]), `${renderer}: onError fires once with load/none (${f.err.join(", ")})`);
    await page.screenshot({ path: `${process.env.SHOTS || "/tmp"}/check-loading-${renderer}-failed.png` }).catch(() => {});
    await page.evaluate(() => fetch("/__heal"));
    await page.evaluate(() => { window.__ev.length = 0; });
    await page.click(".fk-unfurl-retry");
    await page.waitForFunction(() => window.__ev.some(([n, d]) => n === "load-end" && d.ok), null, { timeout: 8000 });
    await page.waitForTimeout(1200);
    check(dist(await mean(), ref[2]) < 10, `${renderer}: Retry brings the photo`);
    check(await page.evaluate((r) => window.__lb.renderer === r, renderer), `${renderer}: still the ${renderer} renderer`);

    // 5. Rapid moves: only the latest wins.
    t = tag();
    await open(names.map((n, i) => ({ src: `photos/${n}-800.jpg?${t}${i === 1 ? "&slow=1500" : i === 3 ? "&slow=500" : ""}`, thumb: `photos/${n}-800.jpg` })), { start: 0 });
    await page.evaluate(() => { window.__lb.show(1); setTimeout(() => window.__lb.show(3), 60); });
    await page.waitForTimeout(2600);
    check((await counter()) === "4 / 4" && dist(await mean(), ref[3]) < 10, `${renderer}: rapid jumps end on the last one`);

    // 6. WebGL cannot use a photo mid-load (another origin, no CORS headers): CSS takes over the move and says so.
    if (renderer === "webgl") {
      t = tag();
      const other = base.replace("localhost", "127.0.0.1");
      await open([{ src: "photos/h17-800.jpg" }, { src: `${other}/photos/h21-800.jpg?${t}&slow=1200`, thumb: "photos/h21-800.jpg" }]);
      await page.keyboard.press("ArrowRight");
      await page.waitForFunction(() => window.__ev.some(([n]) => n === "error"), null, { timeout: 8000 });
      await page.waitForTimeout(1200);
      const e = await page.evaluate(() => ({ r: window.__lb.renderer, err: window.__ev.filter(([n]) => n === "error").map(([, d]) => `${d.reason}/${d.fallback}`) }));
      check(e.r === "css" && JSON.stringify(e.err) === JSON.stringify(["cors/css"]), `webgl: a CORS photo mid-load falls back to CSS (${e.r}, ${e.err.join(", ")})`);
      check(dist(await mean(), ref[2]) < 10, "webgl: and the photo shows there");
    }

    // 7. Opening on a slow photo: it springs open at once on its preview, the ring comes late, the photo arrives.
    const tile = async () => page.evaluate(() => {
      document.querySelector("#fk-tile")?.remove();
      const im = document.createElement("img");
      im.id = "fk-tile"; im.src = "photos/h21-800.jpg"; im.style.cssText = "position:fixed;left:40px;top:40px;width:180px;height:120px;object-fit:cover";
      document.body.append(im);
      return im.decode();
    });
    await tile();
    t = tag();
    await page.evaluate(([r, t]) => { window.__ev.length = 0; window.__lb?.destroy(); window.__lb = window.__m.unfurl({ photos: [{ src: `photos/h21-800.jpg?${t}&slow=3000`, thumb: "photos/h21-800.jpg" }, "photos/h17-800.jpg"], renderer: r, origin: () => document.querySelector("#fk-tile") }); }, [renderer, t]);
    await page.waitForTimeout(100);
    check(!(await ring()) && (await page.evaluate(() => document.querySelector("#fk-tile").style.visibility === "hidden")), `${renderer}: a slow open starts at once (tile lifted), no ring yet`);
    await page.waitForFunction(() => window.__ev.some(([n]) => n === "open-end"), null, { timeout: 2000 }).then(() => check(true, `${renderer}: the slow open finishes its spring before the photo arrives`), () => check(false, `${renderer}: the slow open finishes its spring before the photo arrives`));
    await page.waitForTimeout(300);
    check(await ring(), `${renderer}: the ring shows on a slow open`);
    await page.waitForFunction(() => window.__ev.some(([n, d]) => n === "load-end" && d.ok), null, { timeout: 8000 });
    await page.waitForTimeout(1200);
    check(dist(await mean(), ref[2]) < 10 && !(await ring()), `${renderer}: the photo arrives in place after a slow open`);

    // 8. Opening on a photo that fails: the failed frame and Retry, in this renderer.
    healed = false;
    t = tag();
    await page.evaluate(([r, t]) => { window.__ev.length = 0; window.__lb?.destroy(); window.__lb = window.__m.unfurl({ photos: [{ src: `photos/h21-800.jpg?${t}&fail=1`, thumb: "photos/h21-800.jpg" }, "photos/h17-800.jpg"], renderer: r, origin: () => document.querySelector("#fk-tile") }); }, [renderer, t]);
    await page.waitForFunction(() => window.__ev.some(([n]) => n === "error"), null, { timeout: 8000 });
    await page.waitForTimeout(500);
    const fo = await page.evaluate(() => ({ vis: getComputedStyle(document.querySelector(".fk-unfurl-fail")).display !== "none", r: window.__lb.renderer, err: window.__ev.filter(([n]) => n === "error").map(([, d]) => `${d.reason}/${d.fallback}`) }));
    check(fo.vis && fo.r === renderer && JSON.stringify(fo.err) === JSON.stringify(["load/none"]), `${renderer}: a failed open shows the frame and Retry (${fo.r}, ${fo.err.join(", ")})`);
    await page.evaluate(() => fetch("/__heal"));
    await page.click(".fk-unfurl-retry");
    await page.waitForFunction(() => window.__ev.some(([n, d]) => n === "load-end" && d.ok), null, { timeout: 8000 });
    await page.waitForTimeout(1200);
    check(dist(await mean(), ref[2]) < 10, `${renderer}: Retry after a failed open brings the photo`);

    // 9. Opening on a photo in the cache: the spring as before, never the ring.
    await page.evaluate((r) => { window.__ev.length = 0; window.__lb?.destroy(); window.__lb = window.__m.unfurl({ photos: [{ src: "photos/h21-800.jpg", thumb: "photos/h21-800.jpg" }, "photos/h17-800.jpg"], renderer: r, origin: () => document.querySelector("#fk-tile") }); }, renderer);
    rang = false;
    for (let k = 0; k < 8; k++) { await page.waitForTimeout(100); rang ||= await ring(); }
    check(!rang && (await page.evaluate(() => !window.__ev.some(([n]) => n === "load-start"))), `${renderer}: a cached open never shows the ring`);
    await page.evaluate(() => { window.__lb.destroy(); document.querySelector("#fk-tile").remove(); });

    check(!errors.length, `${renderer}: no page errors${errors.length ? " (" + errors.join("; ") + ")" : ""}`);
    await page.close();
  }
  // 10. frost and liquid come with frankaa/loading; without it the name is reported and the film is used. (A
  // fresh page: the site's own page imports frankaa/loading.)
  {
    const page = await browser.newPage();
    await page.goto(`${base}/llms.txt`);
    const r = await page.evaluate(async () => {
      const m = await import("/lib/index.js");
      const ev = [];
      document.addEventListener("frankaa:error", (e) => ev.push(e.detail.message));
      const go = async (loading) => { const u = m.unfurl({ photos: ["/photos/h17-800.jpg", "/photos/h38-800.jpg"], renderer: "webgl", loading }); await new Promise((r) => setTimeout(r, 600)); u.destroy(); };
      await go("frost");
      const before = ev.slice();
      await import("/lib/loading.js");
      await go("liquid");
      return { before, after: ev.slice(before.length) };
    });
    check(r.before.length === 1 && r.before[0].includes('import "frankaa/loading"'), `"frost" without frankaa/loading is reported (${r.before[0]})`);
    check(r.after.length === 0, `after import "frankaa/loading", "liquid" compiles without an error`);
    await page.close();
  }

  // 11. The site's Loading demo: its service worker slows and fails the photos; the ring, the reveal and Retry.
  for (const renderer of ["webgl", "css"]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(`${base}/index.html`, { waitUntil: "networkidle" });
    await page.evaluate(() => { window.__ev = []; for (const n of ["load-start", "load-end", "error", "close-end"]) document.addEventListener("frankaa:" + n, (e) => window.__ev.push([n, e.detail])); });
    if (renderer === "css") await page.check('input[name="renderer"][value="css"]');
    await page.locator("#loading").scrollIntoViewIfNeeded();
    await page.click("#load-grid .tile >> nth=1");
    await page.waitForFunction(() => window.__ev.some(([n]) => n === "load-start"), null, { timeout: 8000 });
    await page.waitForTimeout(700);
    check(await page.evaluate(() => document.querySelector(".fk-unfurl-load")?.dataset.ring === "spin"), `site ${renderer}: Slow 2s shows the ring`);
    await page.screenshot({ path: `${process.env.SHOTS || "/tmp"}/site-${renderer}-slow.png` }).catch(() => {});
    await page.waitForFunction(() => window.__ev.some(([n, d]) => n === "load-end" && d.ok), null, { timeout: 8000 });
    await page.waitForTimeout(1200);
    check(await page.evaluate(() => document.querySelector(".fk-unfurl-load").hidden), `site ${renderer}: the photo arrives and the ring goes`);
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => window.__ev.some(([n]) => n === "close-end"), null, { timeout: 8000 });
    await page.evaluate(() => { window.__ev.length = 0; });
    await page.check("#load-fail");
    await page.click("#load-grid .tile >> nth=2");
    await page.waitForFunction(() => window.__ev.some(([n]) => n === "error"), null, { timeout: 10000 });
    await page.waitForTimeout(300);
    check(await page.evaluate(() => getComputedStyle(document.querySelector(".fk-unfurl-fail")).display !== "none"), `site ${renderer}: Make it fail shows the message and Retry`);
    await page.click(".fk-unfurl-retry");
    await page.waitForFunction(() => window.__ev.some(([n, d]) => n === "load-end" && d.ok), null, { timeout: 10000 });
    check(true, `site ${renderer}: Retry brings the photo`);
    check(!errors.length, `site ${renderer}: no page errors${errors.length ? " (" + errors.join("; ") + ")" : ""}`);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
if (failures.length) { console.log(`\n${failures.length} loading check(s) failed`); process.exit(1); }
console.log("\nall loading checks passed");
