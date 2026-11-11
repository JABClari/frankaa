// A browser check of the 0.1.2 additions: top-bar actions and controls (inside the focus trap, before Close),
// video slides (poster, play button, players loaded only on tap, removed when moving on, plain crossfade), and
// destroy() firing the close hooks. Both renderers. Run after `npm run build`:
//   PLAYWRIGHT=/path/to/node_modules/playwright node scripts/check-media.mjs
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
    // Stay offline: third-party players are blocked, only their addresses are checked.
    await page.route(/^https:\/\/(?!localhost)/, (r) => r.abort());
    await page.goto(url, { waitUntil: "networkidle" });
    await page.evaluate(async (r) => {
      window.__m = await import("./lib/index.js");
      window.__r = r;
      window.__ev = [];
      for (const n of ["open-start", "open-end", "close-start", "close-end", "change", "animation-start", "animation-end", "error"]) {
        document.addEventListener("frankaa:" + n, (e) => window.__ev.push([n, e.detail]));
      }
    }, renderer);
    const wait = (n, k = 1) => page.waitForFunction(([nm, c]) => window.__ev.filter(([x]) => x === nm).length >= c, [n, k], { timeout: 8000 });

    // 1. Actions and controls.
    await page.evaluate(() => {
      window.__u = window.__m.unfurl({
        photos: ["photos/h04.jpg", "photos/h01.jpg"], renderer: window.__r,
        topActions: [{ label: "Remove this page", onClick: (api) => { window.__clicked = api.index; } }, { label: "Share", icon: "M4 12v7h16v-7M12 3v12M7 8l5-5 5 5", onClick: () => {} }],
        controls: (host) => { const b = document.createElement("button"); b.type = "button"; b.textContent = "Mine"; b.className = "mine"; host.append(b); return () => { window.__tidied = true; }; },
      });
    });
    await wait("open-end");
    const bar = await page.evaluate(() => [...document.querySelectorAll(".fk-unfurl-top button")].map((b) => b.getAttribute("aria-label") || b.textContent));
    check(JSON.stringify(bar) === JSON.stringify(["Remove this page", "Share", "Mine", "Close"]), `${renderer}: actions and controls sit before Close (${bar.join(", ")})`);
    const tabbed = [];
    for (let i = 0; i < 6; i++) { await page.keyboard.press("Tab"); tabbed.push(await page.evaluate(() => document.activeElement?.getAttribute("aria-label") || document.activeElement?.textContent)); }
    check(tabbed.includes("Remove this page") && tabbed.includes("Mine") && tabbed.includes("Close"), `${renderer}: Tab reaches them inside the focus trap`);
    await page.click("text=Remove this page");
    check((await page.evaluate(() => window.__clicked)) === 0, `${renderer}: an action gets the lightbox (index 0)`);
    await page.evaluate(() => window.__u.close());
    await wait("close-end");
    check(await page.evaluate(() => window.__tidied === true), `${renderer}: controls tidy up on close`);

    // 2. Video slides.
    await page.evaluate(() => { window.__ev.length = 0; });
    await page.evaluate(() => {
      window.__u = window.__m.unfurl({
        renderer: window.__r,
        photos: [
          "photos/h04.jpg",
          { type: "video", provider: "youtube", src: "https://youtu.be/dQw4w9WgXcQ", poster: "photos/h10.jpg", title: "Pool walk" },
          { type: "video", provider: "mp4", src: "photos/missing.mp4", poster: "photos/h16.jpg" },
          { type: "video", provider: "youtube", src: "not a video", poster: "photos/h01.jpg" },
        ],
      });
    });
    await wait("open-end");
    check(await page.evaluate(() => document.querySelector(".fk-unfurl-media").hidden), `${renderer}: no player on an image slide`);
    await page.evaluate(() => window.__u.next());
    await wait("animation-end", 2);
    const yt = await page.evaluate(() => ({ play: !!document.querySelector(".fk-unfurl-play"), label: document.querySelector(".fk-unfurl-play")?.getAttribute("aria-label"), iframe: !!document.querySelector(".fk-unfurl-media iframe"), sr: document.querySelector(".fk-unfurl .fk-sr").textContent }));
    check(yt.play && !yt.iframe, `${renderer}: a video slide shows its poster and a play button, no player yet`);
    check(yt.label === "Play video: Pool walk" && yt.sr.startsWith("Video 2 of 4"), `${renderer}: the play button and announcement name the video`);
    await page.click(".fk-unfurl-play");
    const src = await page.evaluate(() => document.querySelector(".fk-unfurl-media iframe")?.getAttribute("src"));
    check(!!src && src.startsWith("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"), `${renderer}: tapping play loads the privacy player`);
    const sandbox = await page.evaluate(() => document.querySelector(".fk-unfurl-media iframe")?.getAttribute("sandbox"));
    check(!!sandbox && sandbox.includes("allow-scripts"), `${renderer}: the player is sandboxed`);
    await page.evaluate(() => window.__u.next());
    await wait("animation-end", 3);
    check(await page.evaluate(() => !document.querySelector(".fk-unfurl-media iframe")), `${renderer}: moving on removes the player (stops it)`);
    await page.click(".fk-unfurl-play");
    check(await page.evaluate(() => !!document.querySelector(".fk-unfurl-media video[controls]")), `${renderer}: an mp4 plays in a <video>`);
    await page.evaluate(() => window.__u.next());
    await wait("animation-end", 4);
    await page.click(".fk-unfurl-play");
    await page.waitForTimeout(200);
    const err = await page.evaluate(() => window.__ev.filter(([n]) => n === "error").map(([, d]) => d.reason));
    check(err.includes("media"), `${renderer}: a source that is not a video fires onError (media)`);
    await page.evaluate(() => window.__u.close());
    await wait("close-end");

    // 3. destroy() fires the close hooks, also mid-animation.
    await page.evaluate(() => { window.__ev.length = 0; });
    const d = await page.evaluate(async () => {
      const u = window.__m.unfurl({ photos: ["photos/h04.jpg", "photos/h01.jpg"], renderer: window.__r });
      await new Promise((r) => setTimeout(r, 30));
      u.destroy();
      u.destroy();
      return window.__ev.map(([n, x]) => `${n}:${x?.reason ?? x?.type ?? ""}${x?.cancelled ? ":cancelled" : ""}`);
    });
    check(d.includes("close-start:destroy") && d.includes("close-end:destroy"), `${renderer}: destroy() fires onCloseStart and onCloseEnd (reason destroy)`);
    check(d.includes("animation-end:open:cancelled"), `${renderer}: the cut-short open animation still ends (cancelled)`);
    check(d.filter((x) => x.startsWith("close-end")).length === 1, `${renderer}: a second destroy() does nothing`);
    check(!(await page.evaluate(() => !!document.querySelector(".fk-unfurl"))), `${renderer}: destroy() removes the dialog`);
    check(errors.length === 0, `${renderer}: no page errors ${errors.join(" ")}`);
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
if (failures.length) { console.log(`\n${failures.length} failed`); process.exit(1); }
console.log("\nall media and controls checks passed");
