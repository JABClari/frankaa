// unfurl: a photo lightbox. The tapped photo lifts out of its spot and springs to full view on a WebGL canvas;
// arrows, keys or a swipe move between photos with a displacement crossfade; closing springs it back into its
// spot. With reduced motion it is a plain fade. Without WebGL (or when a photo cannot be drawn) the same dialog
// shows the photo as a plain image instead.
import { containBox, easeInOut, onScreen, settled, springStep, stageBox, swipeIntent, SPRING_CLOSE, SPRING_OPEN, type Box } from "./lightbox-math";
import { createRenderer, supported, type Renderer } from "./lightbox-gl";

export { supported };

export type UnfurlPhoto = { src: string; alt?: string; caption?: string };
export type MoveHow = "key" | "button" | "swipe";

export type UnfurlOptions = {
  /** The photos, in order. Strings are taken as `src`. Use full-size sources; same-origin or CORS-enabled for WebGL. */
  photos: (UnfurlPhoto | string)[];
  /** The photo to open on. Default 0. */
  start?: number;
  /** Where photo i sits on the page now: an element or a rect. Return null when it is not on show (it then fades). */
  origin?: (i: number) => Element | DOMRect | null;
  /** The dialog's accessible name. Default "Photos". */
  label?: string;
  /** Hide the origin element while its photo is out, so it looks lifted. Default true. */
  hideOrigin?: boolean;
  /** Corner radius of the photo in its spot, and when open, in CSS px. Defaults 16 and 12. */
  radius?: number;
  openRadius?: number;
  /** Use WebGL when the browser has it. Set false to always use the plain image. Default true. */
  webgl?: boolean;
  /** Where the dialog mounts. Default document.body. */
  container?: HTMLElement;
  /** Called when the photo showing changes. */
  onChange?: (index: number, how: MoveHow) => void;
  /** Called once the dialog has closed and left the page. */
  onClose?: (index: number) => void;
};

export type Unfurl = {
  /** The photo showing now. */
  readonly index: number;
  /** "gl" when drawn with WebGL, "dom" when shown as a plain image. */
  readonly mode: "gl" | "dom";
  next(): void;
  prev(): void;
  /** Close, springing back to the spot. */
  close(): void;
  /** Remove at once, without animating. */
  destroy(): void;
};

type Phase = "opening" | "open" | "closing";
const SWAP_MS = 520, FADE_MS = 160, DOM_MS = 220;
const KEYS = ["x", "y", "w", "h"] as const;

const CHEV = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const X = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';

function node<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, attrs: Record<string, string> = {}): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}

/** Open the lightbox. It closes itself (Escape, the close button, a tap or a pull down) and calls onClose. */
export function unfurl(options: UnfurlOptions): Unfurl {
  const photos = options.photos.map((p) => (typeof p === "string" ? { src: p } : p));
  const n = photos.length;
  const R_GRID = options.radius ?? 16, R_OPEN = options.openRadius ?? 12;
  const hideOrigin = options.hideOrigin !== false;
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const returnFocus = document.activeElement as HTMLElement | null;
  let index = Math.min(n - 1, Math.max(0, options.start ?? 0));
  let phase: Phase = "opening";
  let mode: "gl" | "dom" = "dom";
  let gone = false;

  // The dialog and its controls.
  const root = node("div", "fk-unfurl", { role: "dialog", "aria-modal": "true", "aria-label": options.label ?? "Photos", "data-phase": "opening" });
  const bg = node("div", "fk-unfurl-bg", { "aria-hidden": "true" });
  const canvas = node("canvas", "fk-unfurl-gl", { "aria-hidden": "true" });
  const img = node("img", "fk-unfurl-img", { alt: "", decoding: "async" });
  const top = node("div", "fk-unfurl-top");
  const count = node("span", "fk-unfurl-n", { "aria-hidden": "true" });
  const status = node("span", "fk-sr", { "aria-live": "polite", "aria-atomic": "true" });
  const closeBtn = node("button", "fk-unfurl-btn fk-unfurl-close", { type: "button", "aria-label": "Close" });
  closeBtn.innerHTML = X;
  top.append(count, status, closeBtn);
  const prevBtn = node("button", "fk-unfurl-btn fk-unfurl-prev", { type: "button", "aria-label": "Previous photo" });
  const nextBtn = node("button", "fk-unfurl-btn fk-unfurl-next", { type: "button", "aria-label": "Next photo" });
  prevBtn.innerHTML = nextBtn.innerHTML = CHEV;
  const cap = node("p", "fk-unfurl-cap");
  root.append(bg, canvas, img, top);
  if (n > 1) root.append(prevBtn, nextBtn);
  root.append(cap);

  const label = () => {
    const p = photos[index];
    count.textContent = `${index + 1} / ${n}`;
    status.textContent = `Photo ${index + 1} of ${n}${p.alt ? `: ${p.alt}` : ""}`;
    cap.textContent = p.caption ?? "";
    cap.hidden = !p.caption;
    img.alt = p.alt ?? "";
  };
  label();

  // Where photo i sits on the page, and its element (to hide while it is out).
  const spot = (i: number): { box: Box | null; el: HTMLElement | null } => {
    const o = options.origin?.(i) ?? null;
    if (!o) return { box: null, el: null };
    const isEl = typeof Element !== "undefined" && o instanceof Element;
    const r = isEl ? (o as Element).getBoundingClientRect() : (o as DOMRect);
    const box = onScreen(r, window.innerWidth, window.innerHeight) ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
    return { box, el: isEl ? (o as HTMLElement) : null };
  };
  let hidden: HTMLElement | null = null;
  const hide = (i: number | null) => {
    if (hidden) hidden.style.visibility = "";
    hidden = null;
    if (i === null || !hideOrigin || mode !== "gl") return;
    const e = spot(i).el;
    if (e) { e.style.visibility = "hidden"; hidden = e; }
  };

  // Lock the page: no scroll behind, no layout jump where the scrollbar was.
  const html = document.documentElement;
  const prevOverflow = html.style.overflow, prevPad = html.style.paddingRight;
  const gap = window.innerWidth - html.clientWidth;
  html.style.overflow = "hidden";
  if (gap > 0) html.style.paddingRight = `${gap}px`;

  const setPhase = (p: Phase) => { phase = p; root.dataset.phase = p; };

  // ---------- WebGL: one rAF loop draws the spring and the crossfade ----------
  let gl: Renderer | null = null;
  const st = { box: { x: 0, y: 0, w: 1, h: 1 } as Box, vel: [0, 0, 0, 0], target: { x: 0, y: 0, w: 1, h: 1 } as Box, radius: R_GRID, a: index, b: index, mix: 0, dir: 1, swapAt: 0, alpha: 1, fadeAt: 0 };
  let raf = 0, last = 0;
  const fitFor = (i: number): Box => containBox(gl?.aspect(i) ?? 1.5, stageBox(window.innerWidth, window.innerHeight));

  const loop = () => {
    if (!gl) return;
    const now = performance.now();
    // Real time, so the spring keeps its speed on a slow device: sub-steps of at most 1/120 s, and the gap since
    // the last frame clamped to 1/15 s so a stalled tab does not jump.
    const dt = Math.min(1 / 15, Math.max(0, (now - (last || now - 1000 / 60)) / 1000));
    last = now;
    let moving = false;
    if (still) st.box = { ...st.target };
    else {
      const cfg = phase === "closing" ? SPRING_CLOSE : SPRING_OPEN;
      const steps = Math.max(1, Math.ceil(dt * 120)), h = dt / steps;
      KEYS.forEach((k, j) => {
        let x = st.box[k], v = st.vel[j];
        for (let s = 0; s < steps; s++) [x, v] = springStep(x, v, st.target[k], h, cfg);
        st.box[k] = x; st.vel[j] = v;
        if (!settled(x, v, st.target[k])) moving = true;
      });
    }
    // The corner radius follows how far the box still has to go.
    const left = Math.min(1, Math.abs(st.box.w - st.target.w) / Math.max(1, st.target.w));
    st.radius = phase === "closing" ? R_OPEN + (R_GRID - R_OPEN) * (1 - left) : R_OPEN + (R_GRID - R_OPEN) * left;
    if (st.swapAt) {
      const t = (now - st.swapAt) / (still ? FADE_MS : SWAP_MS);
      st.mix = easeInOut(t);
      if (t >= 1) { st.a = st.b; st.mix = 0; st.swapAt = 0; } else moving = true;
    }
    if (st.fadeAt) {
      const t = Math.min(1, (now - st.fadeAt) / FADE_MS);
      st.alpha = phase === "closing" ? 1 - t : t;
      if (t < 1) moving = true;
    }
    gl.draw({ box: st.box, radius: st.radius, a: st.a, b: st.b, mix: st.mix, dir: st.dir, wobble: still ? 0 : 0.06, alpha: st.alpha });
    if (moving) raf = requestAnimationFrame(loop);
    else {
      raf = 0; last = 0;
      if (phase === "opening") setPhase("open");
      else if (phase === "closing") finish();
    }
  };
  const kick = () => { if (!raf) raf = requestAnimationFrame(loop); };
  const onResize = () => {
    if (mode === "gl" && gl) { gl.resize(); st.target = fitFor(st.b); kick(); }
  };

  // ---------- Plain image: the fallback, and the whole show without WebGL ----------
  const fade = (from: number, to: number, ms: number, scale = 1) =>
    typeof img.animate === "function"
      ? img.animate([{ opacity: from, transform: `scale(${still ? 1 : scale})` }, { opacity: to, transform: "none" }], { duration: still ? FADE_MS : ms, easing: "cubic-bezier(.23,1,.32,1)", fill: "forwards" })
      : null;
  const startDom = () => {
    if (gone) return;
    mode = "dom";
    root.dataset.mode = "dom";
    if (gl) { cancelAnimationFrame(raf); raf = 0; gl.destroy(); gl = null; }
    hide(null);
    img.src = photos[index].src;
    const a = fade(0, 1, DOM_MS, 0.96);
    const done = () => { if (phase === "opening") setPhase("open"); };
    if (a) a.onfinish = done; else done();
  };

  // ---------- Open ----------
  (options.container ?? document.body).append(root);
  closeBtn.focus({ preventScroll: true });
  if (options.webgl !== false) gl = createRenderer(canvas, photos.map((p) => p.src));
  if (gl) {
    mode = "gl";
    root.dataset.mode = "gl";
    const g = gl;
    g.ready(index).then((ok) => {
      if (gone || gl !== g) return;
      if (!ok) { startDom(); return; }
      const from = spot(index).box, to = fitFor(index);
      st.target = to;
      if (still || !from) { st.box = { ...to }; st.alpha = 0; st.fadeAt = performance.now(); }
      else st.box = from;
      hide(index);
      kick();
      photos.forEach((_, i) => i !== index && void g.ready(i));
    });
  } else startDom();
  window.addEventListener("resize", onResize);

  // ---------- Moving and closing ----------
  const move = (d: 1 | -1, how: MoveHow = "button") => {
    if (phase === "closing" || n < 2) return;
    const next = (index + d + n) % n;
    index = next;
    label();
    if (mode === "gl" && gl) {
      st.a = st.swapAt ? st.b : st.a; st.b = next; st.dir = d; st.mix = 0; st.swapAt = performance.now();
      const g = gl;
      void g.ready(next).then((ok) => {
        if (gone || gl !== g) return;
        if (!ok) { startDom(); return; }
        st.target = fitFor(next); kick();
      });
      kick();
      hide(next);
    } else {
      img.src = photos[next].src;
      fade(0, 1, DOM_MS);
    }
    options.onChange?.(next, how);
  };

  const close = () => {
    if (phase === "closing" || gone) return;
    setPhase("closing");
    if (mode === "gl" && gl) {
      const home = spot(st.b).box;
      if (still || !home) {
        st.fadeAt = performance.now();
        if (!home) st.target = { x: st.box.x + st.box.w * 0.05, y: st.box.y + st.box.h * 0.05, w: st.box.w * 0.9, h: st.box.h * 0.9 };
      } else st.target = home;
      kick();
    } else {
      const a = fade(1, 0, FADE_MS);
      if (a) a.onfinish = finish; else finish();
    }
  };

  const finish = () => {
    if (gone) return;
    teardown();
    options.onClose?.(index);
  };
  const teardown = () => {
    gone = true;
    cancelAnimationFrame(raf); raf = 0;
    window.removeEventListener("resize", onResize);
    window.removeEventListener("keydown", onKey, true);
    gl?.destroy(); gl = null;
    hide(null);
    root.remove();
    html.style.overflow = prevOverflow;
    html.style.paddingRight = prevPad;
    if (returnFocus && document.contains(returnFocus)) returnFocus.focus({ preventScroll: true });
  };

  // Keys: Escape closes, arrows move, Tab stays inside the dialog.
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "ArrowRight") { e.preventDefault(); move(1, "key"); }
    else if (e.key === "ArrowLeft") { e.preventDefault(); move(-1, "key"); }
    else if (e.key === "Tab") {
      const f = Array.from(root.querySelectorAll<HTMLElement>("button, a[href]")).filter((b) => !b.hidden && b.offsetParent !== null);
      if (!f.length) { e.preventDefault(); return; }
      const i = f.indexOf(document.activeElement as HTMLElement);
      const to = e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : (i === -1 || i === f.length - 1 ? 0 : i + 1);
      e.preventDefault();
      f[to].focus();
    }
  };
  window.addEventListener("keydown", onKey, true);

  closeBtn.addEventListener("click", () => close());
  prevBtn.addEventListener("click", () => move(-1));
  nextBtn.addEventListener("click", () => move(1));

  // Swipe sideways to move, pull down to close, tap outside the controls to close.
  let drag: { x: number; y: number; t: number } | null = null;
  root.addEventListener("pointerdown", (e) => {
    if ((e.target as Element).closest("button, a")) return;
    drag = { x: e.clientX, y: e.clientY, t: e.timeStamp };
  });
  root.addEventListener("pointerup", (e) => {
    const d = drag; drag = null;
    if (!d) return;
    const intent = swipeIntent(e.clientX - d.x, e.clientY - d.y, e.timeStamp - d.t);
    if (intent === "next") move(1, "swipe");
    else if (intent === "prev") move(-1, "swipe");
    else if (intent === "close" || intent === "tap") close();
  });
  root.addEventListener("pointercancel", () => { drag = null; });

  return {
    get index() { return index; },
    get mode() { return mode; },
    next: () => move(1),
    prev: () => move(-1),
    close,
    destroy: () => { if (!gone) teardown(); },
  };
}
