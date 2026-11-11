// A browser check of touch on a phone: real touch swipes left and right in the lightbox, taps on the previous and
// next buttons, a pull down to close, and the page behind staying put (scroll lock), in both renderers. Chromium
// with an iPhone profile sends real touches through the DevTools protocol; WebKit checks the buttons and the lock.
// Run after `npm run build` (see check-keys.mjs for installing Playwright):
//   PLAYWRIGHT=/path/to/node_modules/playwright node scripts/check-touch.mjs
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../docs/", import.meta.url));
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".txt": "text/plain" };
const server = createServer(async (req, res) => {
  const path = normalize(join(root, decodeURIComponent(new URL(req.url, "http://x").pathname)));
  if (!path.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(path.endsWith("/") ? join(path, "index.html") : path);
    res.writeHead(200, { "content-type": types[extname(path)] || "application/octet-stream" }).end(body);
  } catch { res.writeHead(404).end(); }
}).listen(0);
const url = `http://localhost:${server.address().port}/index.html`;

const failures = [];
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failures.push(what); };
const { chromium, webkit, devices } = require(process.env.PLAYWRIGHT || "playwright");
const phone = devices["iPhone 15"] || devices["iPhone 14"];

const openFromCard = async (page, renderer) => {
  await page.goto(url, { waitUntil: "networkidle" });
  await page.click(`label:has(> input[name="renderer"][value="${renderer === "webgl" ? "auto" : "css"}"])`);
  await page.evaluate(() => { const c = document.querySelectorAll("#cards .card")[1]; scrollTo(0, c.getBoundingClientRect().top + scrollY - 140); });
  await page.waitForTimeout(400);
  const y = await page.evaluate(() => scrollY);
  await page.locator(".fk-track").nth(1).tap();
  await page.waitForTimeout(900);
  return y;
};
const counter = (page) => page.evaluate(() => document.querySelector(".fk-unfurl-n")?.textContent ?? "closed");

// Real touches (Chromium, DevTools protocol).
const browser = await chromium.launch();
try {
  for (const renderer of ["webgl", "css"]) {
    const ctx = await browser.newContext({ ...phone });
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    const y = await openFromCard(page, renderer);
    const cdp = await ctx.newCDPSession(page);
    const swipe = async (x0, y0, x1, y1, steps = 8, gap = 16) => {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: y0 }] });
      for (let i = 1; i <= steps; i++) {
        await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + ((x1 - x0) * i) / steps, y: y0 + ((y1 - y0) * i) / steps }] });
        if (gap) await page.waitForTimeout(gap);
      }
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await page.waitForTimeout(700);
    };
    check((await counter(page)) === "1 / 4", `${renderer}: opens on the card's photo (1 / 4)`);
    const band = await (async () => {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: 60, y: 400 }] });
      for (let i = 1; i <= 8; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: 60 + (240 * i) / 8, y: 400 }] }); await page.waitForTimeout(16); }
      await page.waitForTimeout(100);
      const shift = await page.evaluate(() => { const f = [...document.querySelectorAll(".fk-unfurl-frame")].find((x) => x.style.visibility !== "hidden"); const m = f?.style.transform.match(/translate3d\((-?[\d.]+)px/); return m ? +m[1] : null; });
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await page.waitForTimeout(800);
      return shift;
    })();
    check((await counter(page)) === "1 / 4" && (band === null || band < 120), `${renderer}: the first photo rubber-bands (moved ${band ?? "on canvas"} px for a 240 px drag)`);
    await swipe(300, 400, 80, 410);
    check((await counter(page)) === "2 / 4", `${renderer}: a swipe left moves to the next photo`);
    await swipe(80, 400, 300, 395);
    check((await counter(page)) === "1 / 4", `${renderer}: a swipe right moves back`);
    await swipe(300, 400, 200, 402, 3, 0); // 100 px, as fast as the test can send it
    // Hold a drag: the neighbour peeks in; let go slowly short of half way and it springs back.
    const hold = async (x0, y0, x1, y1, inspect) => {
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: y0 }] });
      for (let i = 1; i <= 8; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + ((x1 - x0) * i) / 8, y: y0 + ((y1 - y0) * i) / 8 }] }); await page.waitForTimeout(16); }
      await page.waitForTimeout(150);
      const r = await inspect();
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await page.waitForTimeout(700);
      return r;
    };
    const peek = await hold(300, 400, 180, 400, async () => (process.env.SHOTS && (await page.screenshot({ path: `${process.env.SHOTS}/peek-${renderer}.png` })), page.evaluate(() => {
      const root = document.querySelector(".fk-unfurl");
      const frames = [...document.querySelectorAll(".fk-unfurl-frame")].filter((f) => f.style.visibility !== "hidden");
      return { swiping: root.dataset.swiping === "true", visibleLayers: frames.length };
    })));
    check(peek.swiping && (renderer === "webgl" || peek.visibleLayers >= 2), `${renderer}: the next photo peeks in while dragging`);
    check((await counter(page)) === "2 / 4", `${renderer}: a slow drag short of half way springs back`);
    const n0 = await counter(page);
    await swipe(300, 380, 120, 500, 8); // about 34 degrees down: still a sideways swipe
    check((await counter(page)) === "3 / 4", `${renderer}: a diagonal swipe moves sideways, not close (${n0})`);
    await page.locator(".fk-unfurl-prev").tap(); await page.waitForTimeout(600);

    check((await counter(page)) === "2 / 4", `${renderer}: a short fast flick moves too`);
    const moved = await page.evaluate(() => scrollY);
    check(moved === 0 && (await page.evaluate(() => getComputedStyle(document.body).position)) === "fixed", `${renderer}: the page behind is pinned while open`);
    await page.locator(".fk-unfurl-next").tap(); await page.waitForTimeout(600);
    check((await counter(page)) === "3 / 4", `${renderer}: tapping next works`);
    await page.locator(".fk-unfurl-prev").tap(); await page.waitForTimeout(600);
    check((await counter(page)) === "2 / 4", `${renderer}: tapping previous works`);
    await swipe(190, 300, 192, 520);
    check((await counter(page)) === "closed", `${renderer}: a pull down closes`);
    check((await page.evaluate(() => scrollY)) === y, `${renderer}: the page is back where it was`);
    check(errors.length === 0, `${renderer}: no page errors ${errors.join(" ")}`);
    await ctx.close();
  }
} finally {
  await browser.close();
}

// WebKit (Safari's engine): buttons, safe sizing and the scroll lock.
const wk = await webkit.launch();
try {
  const ctx = await wk.newContext({ ...phone });
  const page = await ctx.newPage();
  await openFromCard(page, "webgl");
  await page.locator(".fk-unfurl-next").tap(); await page.waitForTimeout(600);
  check((await counter(page)) === "2 / 4", "webkit: tapping next works");
  await page.locator(".fk-unfurl-prev").tap(); await page.waitForTimeout(600);
  check((await counter(page)) === "1 / 4", "webkit: tapping previous works");
  const m = await page.evaluate(async () => {
    const before = document.querySelectorAll("#cards .card")[2].getBoundingClientRect().top;
    window.scrollBy(0, 400);
    await new Promise((r) => setTimeout(r, 150));
    const lb = document.querySelector(".fk-unfurl").getBoundingClientRect();
    return { moved: document.querySelectorAll("#cards .card")[2].getBoundingClientRect().top - before, h: lb.height, vh: window.visualViewport?.height ?? innerHeight };
  });
  check(m.moved === 0, "webkit: the page behind does not scroll");
  check(Math.abs(m.h - m.vh) < 2, "webkit: the overlay fills the visible viewport");
  await ctx.close();
} finally {
  await wk.close();
  server.close();
}
if (failures.length) { console.log(`\n${failures.length} failed`); process.exit(1); }
console.log("\nall touch checks passed");
