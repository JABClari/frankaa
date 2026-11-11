// A browser check of the 0.1.2 additions, in both renderers: top-bar actions and controls; video slides; destroy()
// firing the close hooks; zoom (double click, Ctrl + wheel, pan, pinch); styles holding up against a site's resets;
// slider href, tabbable, counter, placeholder, inset focus ring; lightbox srcset and per-corner radius.
// Run after `npm run build`:
//   PLAYWRIGHT=/path/to/node_modules/playwright node scripts/check-features.mjs
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

    // 4. Zoom: double click in and out, Ctrl + wheel, drag to pan.
    await page.evaluate(() => { window.__ev.length = 0; window.__u = window.__m.unfurl({ photos: ["photos/h04.jpg", "photos/h01.jpg"], renderer: window.__r, srcset: undefined }); });
    await wait("open-end");
    const zoomState = () => page.evaluate(() => document.querySelector(".fk-unfurl").dataset.zoomed);
    await page.mouse.dblclick(640, 430);
    await page.waitForTimeout(700);
    check((await zoomState()) === "true", `${renderer}: a double click zooms in`);
    check((await page.evaluate(() => !!document.querySelector(".fk-unfurl"))), `${renderer}: the double click did not close it`);
    const frameX = () => page.evaluate(() => { const f = document.querySelector(".fk-unfurl-frame"); return f ? f.style.transform : document.querySelector(".fk-unfurl").dataset.zoomed; });
    const before = await frameX();
    await page.mouse.move(640, 430); await page.mouse.down();
    for (let i = 1; i <= 6; i++) { await page.mouse.move(640 + i * 20, 430 + i * 8); await page.waitForTimeout(16); }
    await page.mouse.up(); await page.waitForTimeout(700);
    check((await page.evaluate(() => document.querySelector(".fk-unfurl-n").textContent)) === "1 / 2" && (renderer === "webgl" || (await frameX()) !== before), `${renderer}: dragging pans the zoomed photo instead of swiping`);
    await page.mouse.dblclick(640, 430);
    await page.waitForTimeout(700);
    check((await zoomState()) === "false", `${renderer}: a second double click zooms out`);
    await page.mouse.move(640, 430);
    await page.keyboard.down("Control"); await page.mouse.wheel(0, -200); await page.keyboard.up("Control");
    await page.waitForTimeout(600);
    check((await zoomState()) === "true", `${renderer}: Ctrl + wheel (trackpad pinch) zooms`);
    await page.keyboard.press("ArrowRight"); await page.waitForTimeout(600);
    check((await zoomState()) === "false", `${renderer}: moving to another photo resets the zoom`);
    await page.keyboard.press("+"); await page.waitForTimeout(500);
    check((await zoomState()) === "true", `${renderer}: the + key zooms in`);
    await page.evaluate(() => window.__u.destroy());

    // 5. Per-corner radius and srcset (CSS renderer shows them on the layer).
    if (renderer === "css") {
      await page.evaluate(() => { window.__ev.length = 0; window.__u = window.__m.unfurl({ renderer: "css", openRadius: [0, 0, 20, 20], photos: [{ src: "photos/h04.jpg", srcset: "photos/h04-800.jpg 800w, photos/h04.jpg 1600w", sizes: "80vw", placeholder: "#334455" }] }); });
      await wait("open-end");
      const f = await page.evaluate(() => { const fr = document.querySelector(".fk-unfurl-frame"); const im = fr.querySelector("img"); return { r: fr.style.borderRadius, ss: im.getAttribute("srcset"), sz: im.getAttribute("sizes"), bg: fr.style.backgroundColor }; });
      check(f.r.startsWith("0px 0px 20px 20px"), `css: openRadius per corner (${f.r})`);
      check(f.ss?.includes("800w") && f.sz === "80vw", "css: lightbox photos use srcset and sizes");
      check(f.bg === "rgb(51, 68, 85)", "css: the placeholder colour sits behind the photo");
      await page.evaluate(() => window.__u.destroy());
    }

    check(errors.length === 0, `${renderer}: no page errors ${errors.join(" ")}`);
    await page.close();
  }

  // 6. Styles hold up against a site's resets.
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    await page.goto(url, { waitUntil: "networkidle" });
    await page.addStyleTag({ content: "button { all: unset; display: inline; background: red; } :focus-visible { outline: 3px solid navy; } img { max-width: 100%; height: auto; } svg { width: 1em; height: 1em; }" });
    await page.evaluate(async () => { window.__m = await import("./lib/index.js"); window.__u = window.__m.unfurl({ photos: ["photos/h04.jpg", "photos/h01.jpg"] }); });
    await page.waitForTimeout(900);
    const st = await page.evaluate(() => { const b = document.querySelector(".fk-unfurl-next"); const c = getComputedStyle(b); return { w: b.getBoundingClientRect().width, display: c.display, bg: c.backgroundColor }; });
    check(st.w === 44 && st.display === "grid" && st.bg !== "rgb(255, 0, 0)", `reset: the lightbox arrows keep their size and look (${st.w}px, ${st.display})`);
    await page.keyboard.press("ArrowRight"); await page.waitForTimeout(300);
    const ring = await page.evaluate(() => getComputedStyle(document.activeElement).outlineColor);
    check(ring !== "rgb(0, 0, 128)", `reset: the lightbox focus ring keeps its colour (${ring})`);
    await page.evaluate(() => window.__u.destroy());
    await page.addStyleTag({ content: ":focus-visible { outline-color: navy; }" });
    await page.locator(".fk-track").first().focus(); await page.keyboard.press("ArrowRight");
    const ring2 = await page.evaluate(() => getComputedStyle(document.querySelector(".fk-procession")).outlineColor);
    check(ring2 !== "rgb(0, 0, 128)", `reset: the slider focus ring keeps --fk-focus (${ring2})`);
    await page.close();
  }

  // 7. Slider options: href, tabbable, counter, placeholder, inset ring, zoom cursor, onSelect gets the event.
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
    await page.goto(url, { waitUntil: "networkidle" });
    const r = await page.evaluate(async () => {
      const m = await import("./lib/index.js");
      const host = document.createElement("div"); host.style.width = "360px"; document.body.prepend(host);
      const sel = [];
      const s = m.procession(host, { photos: [{ src: "photos/h04-800.jpg", placeholder: "#112233" }, "photos/h01-800.jpg", "photos/h10-800.jpg"], href: "#listing", tabbable: false, counter: true, focusRing: "inset", zoomCursor: true, onSelect: (i, img, e) => { sel.push([i, e.type, e.ctrlKey]); e.preventDefault(); } });
      const t = host.querySelector(".fk-track");
      const c1 = host.querySelector(".fk-count").textContent;
      s.go(1, false);
      await new Promise((r) => setTimeout(r, 200));
      t.querySelectorAll("img")[1].dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, ctrlKey: true, button: 0 }));
      return { tag: t.tagName, href: t.getAttribute("href"), tab: t.getAttribute("tabindex"), c1, c2: host.querySelector(".fk-count").textContent, ring: host.classList.contains("fk-ring-inset"), cursor: getComputedStyle(t).cursor, ph: host.querySelector("img").style.backgroundColor, sel };
    });
    check(r.tag === "A" && r.href === "#listing", "slider: href makes the track a real link");
    check(r.tab === "-1", "slider: tabbable false takes it out of the tab order");
    check(r.c1 === "1 / 3" && r.c2 === "2 / 3", `slider: the counter follows (${r.c1}, ${r.c2})`);
    check(r.ring && r.cursor === "zoom-in", "slider: inset focus ring and zoom cursor when asked");
    check(r.ph === "rgb(17, 34, 51)", "slider: per-photo placeholder colour");
    check(r.sel.length === 1 && r.sel[0][0] === 1 && r.sel[0][2] === true, "slider: onSelect gets the index and the event (Ctrl held)");
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
if (failures.length) { console.log(`\n${failures.length} failed`); process.exit(1); }
console.log("\nall feature checks passed");
