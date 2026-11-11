// The mobile pass: real touches on phone profiles (iPhone and Android in Chromium through the DevTools protocol,
// iPhone in WebKit for Safari's engine), for every part and combination.
// - lightbox (both renderers): swipes, a short flick, the neighbour peeking in, spring-back, a diagonal swipe that
//   must not close, rubber-band at the first photo, pinch, double tap in and out, a single tap closing only after
//   the double-tap wait, pull down to close, the page pinned behind and restored, the arrow buttons;
// - the lightbox's filmstrip (drumline): tap and scrub;
// - scrolling the page past a slider and a drumline with a vertical swipe (they must not grab it);
// - landscape with safe areas, and the visible viewport changing (the address bar);
// - names for VoiceOver and TalkBack on every control.
// Run after `npm run build`:
//   PLAYWRIGHT=/path/to/node_modules/playwright node scripts/check-touch.mjs
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium, webkit, devices } = require(process.env.PLAYWRIGHT || "playwright");
const root = fileURLToPath(new URL("../docs/", import.meta.url));
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".svg": "image/svg+xml" };
const PAGE = `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel=stylesheet href="lib/style.css">
<body style="margin:0;font:15px system-ui">
<div style="height:120px"></div>
<div id=s style="margin:0 16px"></div>
<div id=g style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin:16px"></div>
<div id=d style="background:#141412;color:#ddd;padding:16px 0"></div>
<div style="height:2400px"></div>
<script type=module>
import * as m from "./lib/index.js";
const ids = ["h04","h01","h10","h16"];
window.items = ids.map((id) => ({ src: "photos/" + id + "-800.jpg", full: "photos/" + id + ".jpg", thumb: "photos/" + id + "-800.jpg", alt: id }));
window.m = m;
window.slider = m.procession(document.getElementById("s"), window.items, { label: "Pool house", onSelect: (i) => window.open(i, (n) => window.slider.image(n), { onChange: (n) => window.slider.go(n, false) }) });
window.thumbs = window.items.map((it, i) => { const b = document.createElement("button"); b.setAttribute("aria-label", "Open photo " + (i + 1)); b.style.cssText = "padding:0;border:0;aspect-ratio:1"; const im = document.createElement("img"); im.src = it.src; im.style.cssText = "width:100%;height:100%;object-fit:cover;display:block"; b.append(im); b.addEventListener("click", () => window.open(i, (n) => window.thumbs[n])); document.getElementById("g").append(b); return im; });
window.drum = m.drumline(document.getElementById("d"), [...window.items, ...window.items, ...window.items], { preset: "numbers", start: 2 });
window.open = (i, origin, extra = {}) => { window.u = m.unfurl(window.items, { start: i, origin, renderer: window.renderer || "auto", ...extra }); };
window.ready = true;
</script>`;
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (path === "/touch.html") { res.writeHead(200, { "content-type": "text/html" }).end(PAGE); return; }
  const file = normalize(join(root, path));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try { res.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream" }).end(await readFile(file)); } catch { res.writeHead(404).end(); }
}).listen(0);
const url = `http://localhost:${server.address().port}/touch.html`;

const failures = [];
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failures.push(what); };
const glArgs = process.platform === "darwin" ? ["--use-angle=metal", "--ignore-gpu-blocklist"] : ["--ignore-gpu-blocklist"];
const counter = (page) => page.evaluate(() => document.querySelector(".fk-unfurl-n")?.textContent ?? "closed");
const zoomed = (page) => page.evaluate(() => document.querySelector(".fk-unfurl")?.dataset.zoomed);

async function touchSuite(browser, profileName, profile, renderer) {
  const tag = `${profileName} ${renderer}`;
  const ctx = await browser.newContext({ ...profile });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(url); await page.waitForFunction(() => window.ready);
  await page.evaluate((r) => { window.renderer = r; }, renderer);
  const cdp = await ctx.newCDPSession(page);
  const touch = (type, pts) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: pts });
  const swipe = async (x0, y0, x1, y1, steps = 8, gap = 16, wait = 700) => {
    await touch("touchStart", [{ x: x0, y: y0 }]);
    for (let i = 1; i <= steps; i++) { await touch("touchMove", [{ x: x0 + ((x1 - x0) * i) / steps, y: y0 + ((y1 - y0) * i) / steps }]); if (gap) await page.waitForTimeout(gap); }
    await touch("touchEnd", []);
    await page.waitForTimeout(wait);
  };
  const tapAt = async (x, y) => { await touch("touchStart", [{ x, y }]); await touch("touchEnd", []); };
  const vw = page.viewportSize().width, vh = page.viewportSize().height;
  const cx = Math.round(vw / 2), cy = Math.round(vh / 2);

  // Scrolling the page past the slider and the drumline: a vertical swipe scrolls, it does not move them.
  const s0 = await page.evaluate(() => [scrollY, window.slider.index, window.drum.index]);
  const sb = await page.locator("#s").boundingBox();
  await swipe(cx, sb.y + sb.height / 2 + 40, cx + 4, sb.y + sb.height / 2 - 160, 8, 16, 500);
  const s1 = await page.evaluate(() => [scrollY, window.slider.index, window.drum.index]);
  check(s1[0] > s0[0] + 50 && s1[1] === s0[1], `${tag}: a vertical swipe over the slider scrolls the page (${s0[0]} to ${s1[0]})`);
  const db = await page.locator("#d .fk-dl-viewport").boundingBox();
  await swipe(cx, db.y + db.height / 2 + 30, cx + 4, db.y + db.height / 2 - 170, 8, 16, 600);
  const s2 = await page.evaluate(() => [scrollY, window.slider.index, window.drum.index]);
  check(s2[0] > s1[0] + 50 && s2[2] === s1[2], `${tag}: a vertical swipe over the drumline scrolls the page (${s1[0]} to ${s2[0]})`);
  await page.evaluate(() => scrollTo(0, 0)); await page.waitForTimeout(200);

  // Open from the slider with a tap.
  const y0 = await page.evaluate(() => scrollY);
  await page.locator("#s .fk-track").tap(); await page.waitForTimeout(900);
  check((await counter(page)) === "1 / 4", `${tag}: a tap on the slider opens the lightbox`);
  // Rubber-band at the first photo: a swipe right stays.
  await swipe(60, cy, 300, cy);
  check((await counter(page)) === "1 / 4", `${tag}: the first photo rubber-bands`);
  await swipe(vw - 60, cy, 60, cy + 6);
  check((await counter(page)) === "2 / 4", `${tag}: a swipe left moves to the next photo`);
  await swipe(60, cy, vw - 60, cy - 4);
  check((await counter(page)) === "1 / 4", `${tag}: a swipe right moves back`);
  await swipe(vw - 80, cy, vw - 180, cy + 2, 3, 0);
  check((await counter(page)) === "2 / 4", `${tag}: a short fast flick moves`);
  await swipe(vw - 80, cy, vw - 150, cy, 8, 24);
  check((await counter(page)) === "2 / 4", `${tag}: a slow drag short of half way springs back`);
  await swipe(vw - 60, cy - 40, 100, cy + 100);
  check((await counter(page)) === "3 / 4", `${tag}: a diagonal swipe moves sideways and does not close`);
  check(await page.evaluate(() => getComputedStyle(document.body).position === "fixed" && scrollY === 0), `${tag}: the page behind is pinned`);
  // Pinch, then double tap out; a double tap never closes.
  await touch("touchStart", [{ x: cx - 30, y: cy, id: 1 }, { x: cx + 30, y: cy, id: 2 }]);
  for (let i = 1; i <= 8; i++) { await touch("touchMove", [{ x: cx - 30 - i * 12, y: cy, id: 1 }, { x: cx + 30 + i * 12, y: cy, id: 2 }]); await page.waitForTimeout(16); }
  await touch("touchEnd", []);
  await page.waitForTimeout(700);
  check((await zoomed(page)) === "true" && (await counter(page)) === "3 / 4", `${tag}: a pinch zooms in`);
  await tapAt(cx, cy); await page.waitForTimeout(80); await tapAt(cx, cy);
  await page.waitForTimeout(700);
  check((await zoomed(page)) === "false" && (await counter(page)) === "3 / 4", `${tag}: a double tap zooms out and does not close`);
  // A single tap closes, but only after the double-tap wait.
  await tapAt(cx, cy);
  await page.waitForTimeout(120);
  const stillOpen = (await counter(page)) !== "closed" && (await page.evaluate(() => document.querySelector(".fk-unfurl").dataset.phase)) !== "closing";
  await page.waitForTimeout(1200);
  check(stillOpen && (await counter(page)) === "closed", `${tag}: a single tap closes, after the double-tap wait`);
  check((await page.evaluate(() => scrollY)) === y0, `${tag}: the page is back where it was`);

  // Open from the grid; the arrow buttons; pull down to close.
  await page.locator("#g button").nth(1).tap(); await page.waitForTimeout(900);
  await page.locator(".fk-unfurl-next").tap(); await page.waitForTimeout(600);
  check((await counter(page)) === "3 / 4", `${tag}: tapping next works`);
  await page.locator(".fk-unfurl-prev").tap(); await page.waitForTimeout(600);
  check((await counter(page)) === "2 / 4", `${tag}: tapping previous works`);
  await swipe(cx, cy - 100, cx + 2, cy + 160);
  check((await counter(page)) === "closed", `${tag}: a pull down closes`);

  // The filmstrip under the lightbox.
  await page.evaluate(() => window.open(0, (n) => window.thumbs[n], { strip: "minimal" }));
  await page.waitForTimeout(1300);
  await page.locator(".fk-unfurl-strip .fk-dl-card").nth(3).tap(); await page.waitForTimeout(900);
  check((await counter(page)) === "4 / 4", `${tag}: a tap on the filmstrip moves the photo`);
  const strip = await page.locator(".fk-unfurl-strip").boundingBox();
  check(strip.y + strip.height <= vh + 1, `${tag}: the filmstrip sits inside the screen`);

  // The address bar: the visible viewport shrinks and grows while open; the overlay follows.
  await page.setViewportSize({ width: vw, height: vh - 80 }); await page.waitForTimeout(500);
  const fit = await page.evaluate(() => { const r = document.querySelector(".fk-unfurl").getBoundingClientRect(); return [Math.round(r.height), innerHeight]; });
  check(Math.abs(fit[0] - fit[1]) <= 1, `${tag}: the overlay follows the visible height (${fit})`);
  await page.setViewportSize({ width: vw, height: vh }); await page.waitForTimeout(400);

  // Names for screen readers.
  const names = await page.evaluate(() => ({
    dialog: document.querySelector(".fk-unfurl")?.getAttribute("aria-label"),
    buttons: [...document.querySelectorAll(".fk-unfurl button")].every((b) => (b.getAttribute("aria-label") || b.textContent).trim().length > 0),
    live: !!document.querySelector('.fk-unfurl [aria-live="polite"]'),
    cards: [...document.querySelectorAll(".fk-dl-card")].every((c) => /^Picture \d+ of \d+/.test(c.getAttribute("aria-label") || "")),
    slider: document.querySelector("#s")?.getAttribute("aria-roledescription") === "carousel" && !!document.querySelector("#s .fk-track")?.getAttribute("aria-label"),
  }));
  check(names.dialog && names.buttons && names.live && names.cards && names.slider, `${tag}: every control has a name, changes are announced`);
  await page.locator(".fk-unfurl-close").tap(); await page.waitForTimeout(800);
  check(errors.length === 0, `${tag}: no page errors ${errors.join(" ")}`);
  await ctx.close();
}

const browser = await chromium.launch({ args: glArgs });
try {
  const phones = [["iphone", devices["iPhone 15"] || devices["iPhone 14"]], ["android", devices["Pixel 7"] || devices["Pixel 5"]]];
  for (const [name, profile] of phones) for (const renderer of ["webgl", "css"]) await touchSuite(browser, name, profile, renderer);

  // Landscape with safe areas (the notch side).
  const land = devices["iPhone 15 landscape"] || devices["iPhone 14 landscape"];
  const ctx = await browser.newContext({ ...land });
  const page = await ctx.newPage();
  await page.goto(url); await page.waitForFunction(() => window.ready);
  await page.evaluate(() => window.open(1, (n) => window.thumbs[n], { strip: "ruler", items: undefined }));
  await page.waitForTimeout(1300);
  const L = await page.evaluate(() => {
    const vw = innerWidth, vh = innerHeight, q = (s) => document.querySelector(s)?.getBoundingClientRect();
    const inside = (r) => !r || (r.left >= 0 && r.top >= 0 && r.right <= vw + 1 && r.bottom <= vh + 1);
    return { close: inside(q(".fk-unfurl-close")), strip: inside(q(".fk-unfurl-strip")), counter: inside(q(".fk-unfurl-n")), prev: inside(q(".fk-unfurl-prev")), next: inside(q(".fk-unfurl-next")), photo: inside(q(".fk-unfurl-frame") || q(".fk-unfurl-gl")) };
  });
  check(Object.values(L).every(Boolean), `landscape: the close button, counter, arrows, photo and filmstrip all sit on screen (${JSON.stringify(L)})`);
  await ctx.close();
} finally {
  await browser.close();
}

// WebKit (Safari's engine): taps, the scroll lock, the visible viewport, and drumline taps.
const wk = await webkit.launch();
try {
  const ctx = await wk.newContext({ ...(devices["iPhone 15"] || devices["iPhone 14"]) });
  const page = await ctx.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(url); await page.waitForFunction(() => window.ready);
  await page.locator("#g button").nth(0).tap(); await page.waitForTimeout(900);
  await page.locator(".fk-unfurl-next").tap(); await page.waitForTimeout(600);
  check((await counter(page)) === "2 / 4", "webkit: tapping next works");
  await page.locator(".fk-unfurl-prev").tap(); await page.waitForTimeout(600);
  check((await counter(page)) === "1 / 4", "webkit: tapping previous works");
  const m = await page.evaluate(async () => {
    const before = document.getElementById("d").getBoundingClientRect().top;
    window.scrollBy(0, 400);
    await new Promise((r) => setTimeout(r, 150));
    const lb = document.querySelector(".fk-unfurl").getBoundingClientRect();
    return { moved: document.getElementById("d").getBoundingClientRect().top - before, h: lb.height, vh: window.visualViewport?.height ?? innerHeight };
  });
  check(m.moved === 0, "webkit: the page behind does not scroll");
  check(Math.abs(m.h - m.vh) < 2, "webkit: the overlay fills the visible viewport");
  await page.locator(".fk-unfurl-close").tap(); await page.waitForTimeout(900);
  await page.locator('#d .fk-dl-card[aria-current="true"]').tap(); await page.waitForTimeout(1300);
  check((await counter(page)) === "3 / 12", `webkit: a tap on a drumline picture opens it (${await counter(page)})`);
  await page.locator(".fk-unfurl-close").tap(); await page.waitForTimeout(900);
  await page.evaluate(() => window.open(0, (n) => window.thumbs[n], { strip: "numbers" }));
  await page.waitForTimeout(1300);
  await page.locator(".fk-unfurl-strip .fk-dl-card").nth(2).tap(); await page.waitForTimeout(900);
  check((await counter(page)) === "3 / 4", "webkit: a tap on the filmstrip moves the photo");
  check(errors.length === 0, `webkit: no page errors ${errors.join(" ")}`);
  await ctx.close();
} finally {
  await wk.close();
  server.close();
}
if (failures.length) { console.log(`\n${failures.length} failed`); process.exit(1); }
console.log("\nall touch checks passed");
