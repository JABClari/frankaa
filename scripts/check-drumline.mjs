// A browser check of drumline and the combinations, on desktop (mouse, wheel, keys) and a phone (real touches):
// every preset, WebGL bend and its DOM fallback, wheel on both axes, drag and flick, the ruler, keys, tap to
// expand, the lightbox filmstrip (unfurl's strip option), reduced motion, the slider's double tap, and React
// StrictMode not closing the lightbox. Run after `npm run build`:
//   PLAYWRIGHT=/path/to/node_modules/playwright node scripts/check-drumline.mjs
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { chromium, devices } = require(process.env.PLAYWRIGHT || "playwright");
const root = fileURLToPath(new URL("../docs/", import.meta.url));
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".txt": "text/plain" };
let extra = {};
const server = createServer(async (req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (extra[path]) { res.writeHead(200, { "content-type": extra[path][0] }).end(extra[path][1]); return; }
  const file = normalize(join(root, path));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try { res.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream" }).end(await readFile(file.endsWith("/") ? join(file, "index.html") : file)); } catch { res.writeHead(404).end(); }
}).listen(0);
const base = `http://localhost:${server.address().port}`;
const page0 = "/check.html";
extra[page0] = ["text/html", `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><link rel=stylesheet href="lib/style.css"><body style="margin:0;background:#141412;color:#ddd"><div id=host style="padding:24px 0"></div><div id=s style="width:320px;margin:20px"></div><script type=module>
import * as m from "./lib/index.js";
const ids = ["h04","h01","h10","h16","h21","h23","h30","h38","h17","h11","h03","h18"];
window.items = [...ids, ...ids].map((id) => ({ src: "photos/" + id + ".jpg", thumb: "photos/" + id + "-800.jpg", alt: id }));
window.m = m; window.ev = [];
for (const n of ["change","expand","error","open-end","close-end"]) document.addEventListener("frankaa:" + n, (e) => window.ev.push([n, e.detail]));
window.ready = true;
</script>`];

const failures = [];
const check = (ok, what) => { console.log(`${ok ? "ok  " : "FAIL"} ${what}`); if (!ok) failures.push(what); };
const glArgs = process.platform === "darwin" ? ["--use-angle=metal", "--ignore-gpu-blocklist"] : ["--ignore-gpu-blocklist"];

const browser = await chromium.launch({ args: glArgs });
try {
  // ---------- Desktop ----------
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(base + page0); await page.waitForFunction(() => window.ready);
  const make = (o) => page.evaluate((o) => { window.d?.destroy(); window.ev.length = 0; window.d = window.m.drumline(document.getElementById("host"), window.items, { start: 5, ...o }); return { r: window.d.renderer, i: window.d.index }; }, o);
  for (const preset of ["ruler", "numbers", "minimal"]) {
    const r = await make({ preset });
    const parts = await page.evaluate(() => ({ ticks: document.querySelectorAll(".fk-dl-tick").length, frame: !!document.querySelector(".fk-dl-numbers:not(.fk-dl-fraction) .fk-dl-cur"), below: !!document.querySelector(".fk-dl-below"), cards: document.querySelectorAll(".fk-dl-card").length }));
    const want = { ruler: [24, false, false], numbers: [24, true, false], minimal: [0, false, true] }[preset];
    check(parts.cards === 24 && parts.ticks === want[0] && parts.frame === want[1] && parts.below === want[2], `preset ${preset}: ${parts.ticks} ticks, frame ${parts.frame}, count below ${parts.below}`);
    if (preset === "ruler") check(r.r === "webgl", `preset ruler draws its bend in WebGL (${r.r})`);
  }
  check((await make({ preset: "ruler", renderer: "dom" })).r === "dom", "renderer: \"dom\" keeps the bend in the DOM");

  await make({ preset: "numbers", fluid: "off" });
  const vp = await page.locator("#host .fk-dl-viewport").boundingBox();
  const cur = () => page.evaluate(() => window.d.index);
  await page.mouse.move(vp.x + vp.width / 2, vp.y + vp.height / 2);
  await page.mouse.wheel(0, 300); await page.waitForTimeout(700);
  const afterY = await cur();
  check(afterY > 5, `the vertical wheel moves it (5 to ${afterY})`);
  await page.mouse.wheel(-300, 0); await page.waitForTimeout(700);
  check((await cur()) < afterY, "the sideways wheel moves it back");
  for (const fluid of ["off", "lerp", "chain", "bend"]) {
    await make({ preset: "ruler", fluid });
    const i0 = await cur();
    await page.mouse.move(vp.x + vp.width * 0.7, vp.y + vp.height / 2); await page.mouse.down();
    for (let k = 1; k <= 6; k++) { await page.mouse.move(vp.x + vp.width * 0.7 - k * 50, vp.y + vp.height / 2); await page.waitForTimeout(16); }
    await page.mouse.up(); await page.waitForTimeout(1600);
    const i1 = await cur();
    const snapped = await page.evaluate(() => { const c = document.querySelector('#host .fk-dl-card[aria-current="true"]'); return !!c; });
    check(i1 > i0 && snapped, `fluid ${fluid}: a drag and flick moves on (${i0} to ${i1}) and comes to rest on a picture`);
  }
  await make({ preset: "numbers" });
  const ruler = await page.locator("#host .fk-dl-ruler").boundingBox();
  for (let x = ruler.x; x < ruler.x + ruler.width * 0.9; x += 8) { await page.mouse.move(x, ruler.y + ruler.height / 2); await page.waitForTimeout(10); }
  await page.waitForTimeout(500);
  check((await cur()) >= 19, `hovering the ruler runs through the pictures (at ${await cur()})`);
  const frameText = await page.evaluate(() => document.querySelector("#host .fk-dl-cur").textContent);
  check(frameText === String((await cur()) + 1).padStart(2, "0"), `the number frame shows the picture (${frameText})`);
  await page.locator('#host .fk-dl-card[aria-current="true"]').focus();
  const k0 = await cur();
  await page.keyboard.press("ArrowLeft"); await page.waitForTimeout(500);
  check((await cur()) === k0 - 1 && (await page.evaluate(() => document.activeElement?.getAttribute("aria-current"))) === "true", "Left moves and focus follows the picture");
  await page.keyboard.press("Home"); await page.waitForTimeout(600);
  check((await cur()) === 0, "Home goes to the first");
  await page.keyboard.press("Enter"); await page.waitForTimeout(1100);
  const dbg = await page.evaluate(() => ({ lb: !!document.querySelector(".fk-unfurl"), ev: window.ev.map(([n]) => n).join(","), active: document.activeElement?.className }));
  check(dbg.lb && dbg.ev.includes("expand"), `Enter opens the picture in the lightbox (expand) ${JSON.stringify(dbg)}`);
  await page.keyboard.press("ArrowRight"); await page.waitForTimeout(600);
  check((await cur()) === 1, "moving in the lightbox keeps the strip in step");
  await page.keyboard.press("Escape"); await page.waitForTimeout(900);
  check(await page.evaluate(() => !document.querySelector(".fk-unfurl")), "Escape closes it");
  await page.locator("#host .fk-dl-card").nth(3).click(); await page.waitForTimeout(1100);
  check(await page.evaluate(() => document.querySelector(".fk-unfurl-n")?.textContent === "4 / 24"), "a click on a picture opens that picture");
  await page.keyboard.press("Escape"); await page.waitForTimeout(900);

  // The lightbox with its filmstrip.
  await page.evaluate(() => { window.d.destroy(); window.d = null; window.u = window.m.unfurl(window.items, { start: 2, strip: "numbers" }); });
  await page.waitForTimeout(1300);
  const sc = () => page.evaluate(() => document.querySelector('.fk-unfurl-strip .fk-dl-card[aria-current="true"]')?.getAttribute("aria-label").split(".")[0]);
  check((await sc()) === "Picture 3 of 24", `the filmstrip starts on the open photo (${await sc()})`);
  await page.keyboard.press("ArrowRight"); await page.waitForTimeout(700);
  check((await sc()) === "Picture 4 of 24", "the lightbox's keys move the filmstrip with it");
  await page.locator(".fk-unfurl-strip .fk-dl-card").nth(9).click(); await page.waitForTimeout(900);
  check(await page.evaluate(() => document.querySelector(".fk-unfurl-n").textContent === "10 / 24"), "a tap on the filmstrip moves the lightbox");
  const box = await page.evaluate(() => { const s = document.querySelector(".fk-unfurl-strip").getBoundingClientRect(); const f = document.querySelector(".fk-unfurl-gl, .fk-unfurl-frame"); return { stripTop: s.top }; });
  check(box.stripTop > 500, "the filmstrip sits along the bottom");
  await page.keyboard.press("Escape"); await page.waitForTimeout(900);
  check(await page.evaluate(() => !document.querySelector(".fk-unfurl") && !document.querySelector(".fk-unfurl-strip")), "closing removes the lightbox and its filmstrip");

  // Reduced motion: no glide.
  await page.evaluate(() => { window.d = window.m.drumline(document.getElementById("host"), window.items, { start: 5, reducedMotion: "always" }); window.d.go(12); });
  await page.waitForTimeout(60);
  check((await cur()) === 12, "reduced motion jumps straight to the picture");
  check(errors.length === 0, `desktop: no page errors ${errors.join(" ")}`);
  await page.close();

  // The slider's double tap: zoom only, never also the select.
  {
    const p = await browser.newPage({ viewport: { width: 400, height: 800 }, hasTouch: true });
    await p.goto(base + page0); await p.waitForFunction(() => window.ready);
    const sel = await p.evaluate(async () => {
      let n = 0;
      const s = window.m.procession(document.getElementById("s"), window.items.slice(0, 3), { zoom: true, onSelect: () => n++ });
      const img = s.image(0);
      document.getElementById("s").dispatchEvent(new PointerEvent("pointerdown", { pointerType: "touch", bubbles: true }));
      img.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1, clientX: 100, clientY: 100 }));
      img.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 2, clientX: 100, clientY: 100 }));
      await new Promise((r) => setTimeout(r, 450));
      return { n, zoomed: img.style.transform.includes("scale(2)") };
    });
    check(sel.zoomed && sel.n === 0, `slider: a double tap zooms and does not also select (selects ${sel.n})`);
    await p.close();
  }
} finally {
  await browser.close();
}

// WebGL missing: bend falls back to the DOM and says so.
{
  const b = await chromium.launch({ args: ["--disable-3d-apis", "--disable-webgl"] });
  const p = await b.newPage({ viewport: { width: 1280, height: 860 } });
  await p.goto(base + page0); await p.waitForFunction(() => window.ready);
  const r = await p.evaluate(async () => { window.d = window.m.drumline(document.getElementById("host"), window.items, { preset: "ruler" }); await new Promise((r) => setTimeout(r, 50)); return { r: window.d.renderer, err: window.ev.filter(([n]) => n === "error").map(([, d]) => d.reason) }; });
  check(r.r === "dom" && r.err.includes("webgl"), `no WebGL: bend uses the DOM and fires onError webgl (${r.r}, ${r.err})`);
  await b.close();
}

// ---------- Phone: real touches ----------
{
  const b = await chromium.launch({ args: glArgs });
  const ctx = await b.newContext({ ...(devices["iPhone 15"] || devices["iPhone 14"]) });
  const page = await ctx.newPage();
  const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(base + page0); await page.waitForFunction(() => window.ready);
  await page.evaluate(() => { window.d = window.m.drumline(document.getElementById("host"), window.items, { preset: "numbers", start: 5 }); });
  const cdp = await ctx.newCDPSession(page);
  const swipe = async (x0, y0, x1, y1, steps = 8) => {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: y0 }] });
    for (let i = 1; i <= steps; i++) { await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + ((x1 - x0) * i) / steps, y: y0 + ((y1 - y0) * i) / steps }] }); await page.waitForTimeout(16); }
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForTimeout(1200);
  };
  const cur = () => page.evaluate(() => window.d.index);
  const vp = await page.locator("#host .fk-dl-viewport").boundingBox();
  await swipe(300, vp.y + vp.height / 2, 80, vp.y + vp.height / 2);
  check((await cur()) > 5, `phone: a swipe left moves the strip on (to ${await cur()})`);
  const ruler = await page.locator("#host .fk-dl-ruler").boundingBox();
  await swipe(ruler.x + 4, ruler.y + ruler.height / 2, ruler.x + ruler.width + 20, ruler.y + ruler.height / 2, 12);
  check((await cur()) === 23, `phone: dragging along the ruler scrubs to the end (${await cur()})`);
  await page.locator('#host .fk-dl-card[aria-current="true"]').tap(); await page.waitForTimeout(1100);
  const want = `${(await cur()) + 1} / 24`;
  check(await page.evaluate((w) => document.querySelector(".fk-unfurl-n")?.textContent === w, want), `phone: a tap opens the picture (${want})`);
  await page.locator(".fk-unfurl-close").tap(); await page.waitForTimeout(900);
  await page.evaluate(() => { window.d.destroy(); window.u = window.m.unfurl(window.items, { start: 4, strip: "minimal" }); });
  await page.waitForTimeout(1300);
  await page.locator(".fk-unfurl-strip .fk-dl-card").nth(6).tap(); await page.waitForTimeout(900);
  check(await page.evaluate(() => document.querySelector(".fk-unfurl-n").textContent === "7 / 24"), "phone: a tap on the filmstrip moves the lightbox");
  const sb = await page.locator(".fk-unfurl-strip .fk-dl-viewport").boundingBox();
  await swipe(300, sb.y + sb.height / 2, 120, sb.y + sb.height / 2);
  const both = await page.evaluate(() => [document.querySelector(".fk-unfurl-n").textContent, document.querySelector('.fk-unfurl-strip .fk-dl-card[aria-current="true"]')?.getAttribute("aria-label").split(".")[0]]);
  check(both[0] !== "7 / 24" && both[1] === `Picture ${both[0].split(" / ")[0]} of 24`, `phone: scrubbing the filmstrip moves through the photos, the lightbox following (${both})`);
  check(errors.length === 0, `phone: no page errors ${errors.join(" ")}`);
  await b.close();
}

// ---------- React StrictMode: a lightbox opened on mount stays open; unmount fires onDestroy, not the close hooks ----------
{
  const { build } = await import("esbuild");
  const out = await build({
    stdin: { contents: `
      import { createElement as h, StrictMode, useEffect } from "react";
      import { createRoot } from "react-dom/client";
      import { useUnfurl, Drumline } from "../dist/react.js";
      window.log = [];
      const items = ["photos/h04.jpg", "photos/h01.jpg"];
      function App() {
        const lb = useUnfurl(items, { strip: "minimal", onCloseEnd: (d) => window.log.push("closeEnd:" + d.reason), onDestroy: () => window.log.push("destroy") });
        useEffect(() => { lb.open(0); }, []);
        return h("div", null, h(Drumline, { items, preset: "minimal" }), lb.portal);
      }
      const root = createRoot(document.getElementById("app"));
      root.render(h(StrictMode, null, h(App)));
      window.unmount = () => root.unmount();
    `, resolveDir: fileURLToPath(new URL("../test/", import.meta.url)), loader: "js" },
    bundle: true, write: false, format: "esm", define: { "process.env.NODE_ENV": '"development"' },
  });
  extra["/react.js"] = ["text/javascript", out.outputFiles[0].text];
  extra["/react.html"] = ["text/html", `<!doctype html><meta charset=utf-8><link rel=stylesheet href="lib/style.css"><div id=app></div><script type=module src="react.js"></script>`];
  const b = await chromium.launch();
  const p = await b.newPage();
  const errors = []; p.on("pageerror", (e) => errors.push(String(e)));
  await p.goto(base + "/react.html"); await p.waitForTimeout(1500);
  check(await p.evaluate(() => !!document.querySelector(".fk-unfurl") && !window.log.includes("closeEnd:destroy")), "React StrictMode: the lightbox opened on mount stays open");
  check(await p.evaluate(() => document.querySelectorAll(".fk-drumline").length >= 1), "React: <Drumline items preset> renders");
  await p.evaluate(() => window.unmount()); await p.waitForTimeout(200);
  const log = await p.evaluate(() => window.log);
  check(log.includes("destroy") && !log.some((x) => x.startsWith("closeEnd")) && (await p.evaluate(() => !document.querySelector(".fk-unfurl"))), `React: unmount removes it and fires onDestroy, not the close hooks (${log})`);
  check(errors.length === 0, `React: no page errors ${errors.join(" ")}`);
  await b.close();
}
server.close();
if (failures.length) { console.log(`\n${failures.length} failed`); process.exit(1); }
console.log("\nall drumline checks passed");
