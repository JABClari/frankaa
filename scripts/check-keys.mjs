// A quick browser check of the keyboard: the slider's arrows, and the lightbox's arrows, Home, End and Escape in
// both renderers, plus the focus ring a key move leaves and focus returning on close. Not part of npm test (it
// needs a browser). Run after `npm run build`:
//   npm i --no-save playwright && npx playwright install chromium && node scripts/check-keys.mjs
// or point PLAYWRIGHT at an existing install: PLAYWRIGHT=/path/to/node_modules/playwright node scripts/check-keys.mjs
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT || "playwright");
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

const browser = await chromium.launch();
try {
  for (const renderer of ["webgl", "css"]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.goto(url, { waitUntil: "networkidle" });
    await page.click(`label:has(> input[name="renderer"][value="${renderer === "webgl" ? "auto" : "css"}"])`);

    // Slider: focus the track, Right and Left step.
    const track = page.locator(".fk-track").first();
    await track.focus();
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(700);
    const dot = () => page.$eval(".fk-procession", (s) => [...s.querySelectorAll(".fk-dot")].findIndex((d) => d.classList.contains("fk-on")));
    check((await dot()) === 1, `${renderer}: slider ArrowRight steps to photo 2`);
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(700);
    check((await dot()) === 0, `${renderer}: slider ArrowLeft steps back`);
    check(await page.$eval(".fk-track", (t) => t.matches(":focus-visible")), `${renderer}: slider shows a focus ring`);

    // Lightbox, opened from the keyboard.
    const tile = page.locator("#gallery .tile").nth(1);
    await tile.focus();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(900);
    const state = () => page.evaluate(() => ({ n: document.querySelector(".fk-unfurl-n")?.textContent, r: document.querySelector(".fk-unfurl")?.dataset.renderer, focus: document.activeElement?.getAttribute("aria-label"), ring: document.activeElement?.matches(":focus-visible") }));
    let s = await state();
    check(s.r === renderer, `${renderer}: lightbox uses the ${renderer} renderer`);
    check(s.n === "2 / 9", `${renderer}: opens on photo 2`);
    await page.keyboard.press("ArrowRight"); await page.waitForTimeout(500);
    s = await state();
    check(s.n === "3 / 9", `${renderer}: ArrowRight moves to photo 3`);
    check(s.focus === "Next photo" && s.ring, `${renderer}: the next button shows a focus ring after ArrowRight`);
    await page.keyboard.press("ArrowLeft"); await page.waitForTimeout(500);
    s = await state();
    check(s.n === "2 / 9" && s.focus === "Previous photo" && s.ring, `${renderer}: ArrowLeft moves back, focus ring on previous`);
    await page.keyboard.press("End"); await page.waitForTimeout(500);
    check((await state()).n === "9 / 9", `${renderer}: End jumps to the last photo`);
    await page.keyboard.press("Home"); await page.waitForTimeout(500);
    check((await state()).n === "1 / 9", `${renderer}: Home jumps to the first photo`);
    await page.keyboard.press("Escape"); await page.waitForTimeout(900);
    const after = await page.evaluate(() => ({ open: !!document.querySelector(".fk-unfurl"), focus: document.activeElement?.getAttribute("aria-label") }));
    check(!after.open, `${renderer}: Escape closes`);
    check(after.focus === "Open photo 2: Resort Leisure", `${renderer}: focus returns to the thumbnail`);
    check(errors.length === 0, `${renderer}: no page errors ${errors.join(" ")}`);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
if (failures.length) { console.log(`\n${failures.length} failed`); process.exit(1); }
console.log("\nall keyboard checks passed");
