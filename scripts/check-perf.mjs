// Frame-rate check for the lightbox: open, close, a swipe, each built-in effect and the CSS renderer, on desktop
// and on an iPhone-sized viewport with the CPU slowed 4x. Frames are timed with requestAnimationFrame; long tasks
// come from the Long Tasks API. Not part of npm test (it needs a browser). Run after `npm run build`:
//   PLAYWRIGHT=/path/to/node_modules/playwright node scripts/check-perf.mjs [--json out.json]
// Targets: about 60 fps on desktop; at 4x throttle, no CSS-renderer frame over about 20 ms (p95).
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium, devices } = require(process.env.PLAYWRIGHT || "playwright");
const root = process.env.DOCS || fileURLToPath(new URL("../docs/", import.meta.url));
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".txt": "text/plain" };
const server = createServer(async (req, res) => {
  const path = normalize(join(root, decodeURIComponent(new URL(req.url, "http://x").pathname)));
  if (!path.startsWith(normalize(root))) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(path.endsWith("/") ? join(path, "index.html") : path);
    res.writeHead(200, { "content-type": types[extname(path)] || "application/octet-stream", "cache-control": "max-age=3600" }).end(body);
  } catch { res.writeHead(404).end(); }
}).listen(0);
const url = `http://localhost:${server.address().port}/index.html`;
const jsonOut = process.argv.includes("--json") ? process.argv[process.argv.indexOf("--json") + 1] : null;

// In the page: a frame recorder, a long-task observer, and a log of frankaa events to wait on.
const SETUP = () => {
  window.__ev = [];
  for (const n of ["open-end", "close-end", "animation-end"]) document.addEventListener("frankaa:" + n, (e) => window.__ev.push(n + ":" + (e.detail?.type ?? "")));
  window.__rec = {
    start() {
      this.f = []; this.lt = []; this.on = true;
      const loop = (t) => { if (!this.on) return; this.f.push(t); requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
      try { this.po = new PerformanceObserver((l) => { for (const e of l.getEntries()) this.lt.push(e.duration); }); this.po.observe({ type: "longtask" }); } catch { this.po = null; }
    },
    stop() { this.on = false; this.po?.disconnect(); return { f: this.f, lt: this.lt }; },
  };
};

const stats = ({ f, lt }) => {
  const d = [];
  for (let i = 1; i < f.length; i++) d.push(f[i] - f[i - 1]);
  if (!d.length) return { frames: 0, fps: 0, p95: 0, max: 0, dropped: 0, longTasks: lt.length, longMs: Math.round(lt.reduce((a, b) => a + b, 0)) };
  const sorted = [...d].sort((a, b) => a - b);
  const mean = d.reduce((a, b) => a + b, 0) / d.length;
  return {
    frames: d.length,
    fps: Math.round(1000 / mean),
    p95: +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))].toFixed(1),
    max: +sorted[sorted.length - 1].toFixed(1),
    dropped: d.reduce((a, x) => a + Math.max(0, Math.round(x / 16.667) - 1), 0),
    longTasks: lt.length,
    longMs: Math.round(lt.reduce((a, b) => a + b, 0)),
  };
};

const rows = [];
let coldStart = null;
// Use the real GPU: headless Chromium otherwise draws with SwiftShader (software), which measures the CPU drawing
// pixels rather than this code. On macOS that is Metal through ANGLE; elsewhere set PERF_GL_ARGS.
const glArgs = process.env.PERF_GL_ARGS ? process.env.PERF_GL_ARGS.split(" ") : process.platform === "darwin" ? ["--use-angle=metal", "--enable-gpu-rasterization", "--ignore-gpu-blocklist"] : ["--enable-gpu-rasterization", "--ignore-gpu-blocklist"];
const browser = await chromium.launch({ args: glArgs });
try {
  // The very first WebGL context in a fresh browser pays for starting the GPU process (hundreds of ms, once per
  // browser, not per page). Measure that once, apart, then warm up so the rows below are about frankaa.
  {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(url, { waitUntil: "networkidle" });
    coldStart = await page.evaluate(async () => {
      const m = await import("./lib/index.js");
      const t0 = performance.now();
      const u = m.unfurl({ photos: ["photos/h04.jpg"], renderer: "webgl" });
      const t1 = performance.now();
      await new Promise((r) => document.addEventListener("frankaa:open-end", r, { once: true }));
      u.destroy();
      return { syncMs: Math.round(t1 - t0), toOpenMs: Math.round(performance.now() - t0) };
    });
    await page.close();
  }
  for (const profile of [
    { name: "desktop", ctx: { viewport: { width: 1440, height: 900 } }, throttle: 1 },
    { name: "iphone 4x", ctx: { ...(devices["iPhone 15"] || devices["iPhone 14"]), userAgent: undefined }, throttle: 4 },
  ]) {
    for (const renderer of ["webgl", "css"]) {
      const effects = renderer === "webgl" ? ["displacement", "ripple", "fade", "zoom"] : ["displacement"];
      for (const effect of effects) {
        const ctx = await browser.newContext(profile.ctx);
        const page = await ctx.newPage();
        await page.goto(url, { waitUntil: "networkidle" });
        await page.evaluate(SETUP);
        const cdp = await ctx.newCDPSession(page);
        // Warm the photo cache, so the numbers are about drawing, not the network.
        await page.evaluate(async () => { await Promise.all(["h04", "h01", "h10", "h16"].map((id) => fetch(`photos/${id}.jpg`).then((r) => r.blob()))); });
        await page.locator("#gallery").scrollIntoViewIfNeeded();
        await cdp.send("Emulation.setCPUThrottlingRate", { rate: profile.throttle });
        const waitEv = (name, n = 1) => page.waitForFunction(([nm, k]) => window.__ev.filter((e) => e.startsWith(nm)).length >= k, [name, n], { timeout: 15000 });
        const measure = async (label, act, until) => {
          await page.evaluate(() => window.__rec.start());
          await act();
          await until();
          await page.waitForTimeout(80);
          const s = stats(await page.evaluate(() => window.__rec.stop()));
          rows.push({ profile: profile.name, renderer, scenario: label, ...s });
        };
        const first = effect === effects[0];
        await measure(first ? "open" : `open (${effect})`, () => page.evaluate(async ([r, fx]) => {
          const m = await import("./lib/index.js");
          const tiles = [...document.querySelectorAll("#gallery .tile img")].slice(0, 4);
          window.__u = m.unfurl({ photos: ["h04", "h01", "h10", "h16"].map((id) => `photos/${id}.jpg`), start: 1, origin: (n) => tiles[n] ?? null, renderer: r, effect: fx });
        }, [renderer, effect]), () => waitEv("open-end"));
        await page.waitForTimeout(400);
        await measure(`change: ${renderer === "css" ? "css crossfade" : effect}`, () => page.evaluate(() => window.__u.next()), () => waitEv("animation-end:change", 1));
        if (first) {
          await page.waitForTimeout(300);
          // A swipe: real touches on the phone profile, the mouse on desktop.
          const vp = page.viewportSize();
          const y = Math.round(vp.height / 2), x0 = Math.round(vp.width * 0.8), x1 = Math.round(vp.width * 0.2);
          const nChanges = await page.evaluate(() => window.__ev.filter((e) => e === "animation-end:change").length);
          await measure("swipe", async () => {
            if (profile.ctx.hasTouch) {
              await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y }] });
              for (let i = 1; i <= 10; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + ((x1 - x0) * i) / 10, y }] }); await page.waitForTimeout(16); }
              await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
            } else {
              await page.mouse.move(x0, y); await page.mouse.down();
              for (let i = 1; i <= 10; i++) { await page.mouse.move(x0 + ((x1 - x0) * i) / 10, y); await page.waitForTimeout(16); }
              await page.mouse.up();
            }
          }, () => waitEv("animation-end:change", nChanges + 1));
        }
        await page.waitForTimeout(300);
        await measure(first ? "close" : `close (${effect})`, () => page.evaluate(() => window.__u.close()), () => waitEv("close-end"));
        await ctx.close();
      }
    }
  }
} finally {
  await browser.close();
  server.close();
}

const pad = (s, n) => String(s).padEnd(n);
console.log(`${pad("profile", 11)}${pad("renderer", 9)}${pad("scenario", 24)}${pad("fps", 5)}${pad("p95 ms", 8)}${pad("max ms", 8)}${pad("dropped", 9)}long tasks`);
for (const r of rows) console.log(`${pad(r.profile, 11)}${pad(r.renderer, 9)}${pad(r.scenario, 24)}${pad(r.fps, 5)}${pad(r.p95, 8)}${pad(r.max, 8)}${pad(r.dropped, 9)}${r.longTasks} (${r.longMs} ms)`);
console.log(`\ncold start (first WebGL lightbox in a fresh browser): ${coldStart?.syncMs} ms blocking, ${coldStart?.toOpenMs} ms to open`);
if (jsonOut) await writeFile(jsonOut, JSON.stringify({ coldStart, rows }, null, 2));

// Targets: desktop about 60 fps; the CSS renderer at 4x keeps p95 frames near 20 ms.
const misses = rows.filter((r) => (r.profile === "desktop" && r.fps < 55) || (r.profile === "iphone 4x" && r.renderer === "css" && r.p95 > 21));
if (misses.length) { console.log(`\n${misses.length} below target`); process.exitCode = 1; } else console.log("\nall within target");
