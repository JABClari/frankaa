// unfurl: a photo lightbox. The photo lifts out of its spot and springs to full view, moves between photos with
// an effect, and springs back to its spot when closed. Two renderers: WebGL (a canvas, with shader effects) and
// CSS (transform and opacity only). "auto" uses WebGL where it is there. With reduced motion it is a plain fade.
// If WebGL cannot draw a photo (no WebGL, or a cross-origin photo without CORS headers) it switches to CSS and
// says so through onError, so nothing fails silently.
import { onScreen, pickRenderer, stageBox, swipeIntent, type Box, type RendererPref, type Stage, type StageCtx } from "./lightbox-math";
import { checkEffect, createGlStage, supported } from "./lightbox-gl";
import { createCssStage } from "./lightbox-css";
import { getEffect, registerEffect, effectNames, type Effect, type EffectName, type CssTransition, type Easing, type UniformValue } from "./effects";
import { fill, lightboxKey, resolveReduced, rubber, velocity, type ReducedMotion } from "./shared";
import { CHEVRON, CROSS, el, emitter, icon, systemReduces } from "./dom";

export { supported, checkEffect, registerEffect, effectNames };
export type { Effect, EffectName, CssTransition, Easing, UniformValue, RendererPref, ReducedMotion };

export type UnfurlPhoto = { src: string; alt?: string; caption?: string };
export type MoveHow = "key" | "button" | "swipe" | "api";
export type AnimationType = "open" | "close" | "change";

export type UnfurlLabels = {
  /** The dialog's name. Default "Photos". */
  dialog: string;
  close: string;
  next: string;
  previous: string;
  /** Read out on each photo. {n}, {total}. Default "Photo {n} of {total}". The photo's alt follows it. */
  position: string;
  /** The visible counter. {n}, {total}. Default "{n} / {total}". */
  counter: string;
};
export const UNFURL_LABELS: UnfurlLabels = { dialog: "Photos", close: "Close", next: "Next photo", previous: "Previous photo", position: "Photo {n} of {total}", counter: "{n} / {total}" };

/** cors: a cross-origin photo without CORS headers; load: the photo did not load; webgl: no WebGL (only when
 *  renderer is "webgl"); shader: the effect did not compile (message has the log). */
export type UnfurlError = { index: number; src: string; reason: "cors" | "load" | "webgl" | "shader"; fallback: "css" | "none"; message?: string };

export type UnfurlHooks = {
  onOpenStart?: (d: { index: number }) => void;
  onOpenEnd?: (d: { index: number; renderer: "webgl" | "css" }) => void;
  onCloseStart?: (d: { index: number }) => void;
  onCloseEnd?: (d: { index: number }) => void;
  onChange?: (index: number, d: { index: number; from: number; how: MoveHow }) => void;
  onAnimationStart?: (d: { type: AnimationType; index: number }) => void;
  onAnimationEnd?: (d: { type: AnimationType; index: number }) => void;
  onError?: (d: UnfurlError) => void;
};

export type UnfurlOptions = UnfurlHooks & {
  /** The photos, in order. Strings are taken as `src`. Full-size sources; same-origin or CORS-enabled for WebGL. */
  photos: (UnfurlPhoto | string)[];
  /** The photo to open on. Default 0. */
  start?: number;
  /** Where photo i sits on the page now: an element or a rect. Null (or off screen) means it fades instead. */
  origin?: (i: number) => Element | DOMRect | null;
  /** Shorthand for labels.dialog. */
  label?: string;
  /** Every string the lightbox shows or reads out, for other languages. */
  labels?: Partial<UnfurlLabels>;
  /** The effect between photos: a built-in or registered name, or your own { fragment, uniforms, duration, easing }.
   *  Default "displacement". The CSS renderer shows each as a fade, slide, zoom or cut. */
  effect?: EffectName | (string & {}) | Effect;
  /** "auto" (default) uses WebGL where it is there, else CSS. "css" never touches WebGL. */
  renderer?: RendererPref;
  /** "system" (default) follows the person's setting; "always" and "never" override it. */
  reducedMotion?: ReducedMotion;
  /** Keep Tab inside the dialog. Default true. */
  focusTrap?: boolean;
  /** Where focus goes on close: true (default) back to where it was, an element, or false to leave it. */
  returnFocus?: boolean | HTMLElement;
  /** Read each photo out through a polite live region. Default true. */
  announce?: boolean;
  /** Hide the origin element while its photo is out, so it looks lifted. Default true. */
  hideOrigin?: boolean;
  /** Corner radius of the photo in its spot, and open, in CSS px. Defaults 16 and 12. */
  radius?: number;
  openRadius?: number;
  /** Where the dialog mounts, and where its events are dispatched. Default document.body. */
  container?: HTMLElement;
};

export type Unfurl = {
  /** The photo showing now. */
  readonly index: number;
  /** The renderer in use: "webgl" or "css". */
  readonly renderer: "webgl" | "css";
  next(): void;
  prev(): void;
  /** Go to photo i. */
  show(i: number): void;
  /** Close, springing back to the spot. */
  close(): void;
  /** Remove at once, without animating. */
  destroy(): void;
};

type Phase = "opening" | "open" | "closing" | "closed";

/** Open the lightbox. It closes itself (Escape, the close button, a tap, or a pull down). */
export function unfurl(options: UnfurlOptions): Unfurl {
  const photos = options.photos.map((p) => (typeof p === "string" ? { src: p } : p));
  const n = photos.length;
  const L: UnfurlLabels = { ...UNFURL_LABELS, ...(options.label ? { dialog: options.label } : {}), ...options.labels };
  const still = resolveReduced(options.reducedMotion, systemReduces());
  const effect = getEffect(still ? "fade" : options.effect);
  const trap = options.focusTrap !== false;
  const announce = options.announce !== false;
  const hideOrigin = options.hideOrigin !== false;
  const container = options.container ?? document.body;
  const before = document.activeElement as HTMLElement | null;
  const emit = emitter(options, () => container);
  let index = Math.min(n - 1, Math.max(0, options.start ?? 0));
  let phase = "opening" as Phase;

  // The dialog and its controls. Text goes in with textContent only.
  const root = el("div", "fk-unfurl", { role: "dialog", "aria-label": L.dialog, "data-phase": "opening" });
  if (trap) root.setAttribute("aria-modal", "true");
  if (still) root.dataset.motion = "reduced";
  const bg = el("div", "fk-unfurl-bg", { "aria-hidden": "true" });
  const canvas = el("canvas", "fk-unfurl-gl", { "aria-hidden": "true" });
  const cssHost = el("div", "fk-unfurl-css");
  const top = el("div", "fk-unfurl-top");
  const count = el("span", "fk-unfurl-n", { "aria-hidden": "true" });
  const status = el("span", "fk-sr", announce ? { "aria-live": "polite", "aria-atomic": "true" } : {});
  const closeBtn = el("button", "fk-unfurl-btn fk-unfurl-close", { type: "button", "aria-label": L.close });
  closeBtn.append(icon(CROSS, 18));
  top.append(count, status, closeBtn);
  const prevBtn = el("button", "fk-unfurl-btn fk-unfurl-prev", { type: "button", "aria-label": L.previous });
  const nextBtn = el("button", "fk-unfurl-btn fk-unfurl-next", { type: "button", "aria-label": L.next });
  prevBtn.append(icon(CHEVRON, 18));
  nextBtn.append(icon(CHEVRON, 18));
  const cap = el("p", "fk-unfurl-cap");
  root.append(bg, canvas, cssHost, top);
  if (n > 1) root.append(prevBtn, nextBtn);
  root.append(cap);

  const label = () => {
    const p = photos[index], v = { n: index + 1, total: n };
    count.textContent = fill(L.counter, v);
    if (announce) status.textContent = fill(L.position, v) + (p.alt ? `. ${p.alt}` : "");
    cap.textContent = p.caption ?? "";
    cap.hidden = !p.caption;
  };
  label();

  const spot = (i: number): { box: Box | null; el: HTMLElement | null } => {
    const o = options.origin?.(i) ?? null;
    if (!o) return { box: null, el: null };
    const isEl = o instanceof Element;
    const r = isEl ? o.getBoundingClientRect() : o;
    const box = onScreen(r, window.innerWidth, window.innerHeight) ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
    return { box, el: isEl ? (o as HTMLElement) : null };
  };
  let hidden: HTMLElement | null = null;
  const hide = (i: number | null) => {
    if (hidden) hidden.style.visibility = "";
    hidden = null;
    if (i === null || !hideOrigin) return;
    const e = spot(i).el;
    if (e) { e.style.visibility = "hidden"; hidden = e; }
  };

  // Lock the page without a layout jump where the scrollbar was.
  const html = document.documentElement;
  const prevOverflow = html.style.overflow, prevPad = html.style.paddingRight;
  const gap = window.innerWidth - html.clientWidth;
  html.style.overflow = "hidden";
  if (gap > 0) html.style.paddingRight = `${gap}px`;

  const setPhase = (p: Phase) => { phase = p; root.dataset.phase = p; };

  // ---------- Renderers ----------
  const ctx: StageCtx = {
    still, rSpot: options.radius ?? 16, rOpen: options.openRadius ?? 12, duration: effect.duration ?? 480,
    area: () => stageBox(window.innerWidth, window.innerHeight),
  };
  const wantGl = pickRenderer(options.renderer, true) === "webgl";
  let stage: Stage | null = null;
  if (wantGl) {
    const built = createGlStage(canvas, photos.map((p) => p.src), effect, ctx);
    if (built.stage) stage = built.stage;
    // A shader that does not compile is always reported; missing WebGL only when WebGL was asked for by name.
    else if (built.error.reason === "shader" || options.renderer === "webgl") {
      const err = built.error;
      queueMicrotask(() => emit("onError", { index, src: photos[index].src, reason: err.reason, fallback: "css", message: err.message } satisfies UnfurlError));
    }
  }
  const useCss = () => {
    stage?.destroy();
    stage = createCssStage(cssHost, photos, effect.css ?? "fade", ctx);
    root.dataset.renderer = "css";
    return stage;
  };
  if (!stage) useCss(); else root.dataset.renderer = "webgl";

  // WebGL could not draw photo i: tell the caller, switch to CSS, and show it there without the spring.
  const fallBack = async (i: number) => {
    const s = useCss();
    const ok = await s.open(i, null, () => hide(i));
    emit("onError", { index: i, src: photos[i].src, reason: ok ? "cors" : "load", fallback: ok ? "css" : "none" } satisfies UnfurlError);
    return ok;
  };

  // ---------- Open ----------
  container.append(root);
  closeBtn.focus({ preventScroll: true });
  emit("onOpenStart", { index });
  emit("onAnimationStart", { type: "open", index });
  void (async () => {
    const from = spot(index).box;
    const s = stage!;
    let ok = await s.open(index, from, () => hide(index));
    if (phase === "closed") return;
    if (!ok && s.kind === "webgl") ok = await fallBack(index);
    else if (!ok) emit("onError", { index, src: photos[index].src, reason: "load", fallback: "none" } satisfies UnfurlError);
    if (phase !== "opening") return;
    setPhase("open");
    emit("onAnimationEnd", { type: "open", index });
    emit("onOpenEnd", { index, renderer: stage!.kind });
  })();

  const onResize = () => stage?.resize();
  window.addEventListener("resize", onResize);

  // ---------- Moving ----------
  const show = (to: number, how: MoveHow, dir?: 1 | -1) => {
    if (phase === "closing" || phase === "closed" || n < 2) return;
    const next = ((to % n) + n) % n;
    if (next === index) return;
    const from = index, d = dir ?? (next > from ? 1 : -1);
    index = next;
    label();
    hide(next);
    emit("onChange", { index: next, from, how }, next, { index: next, from, how });
    emit("onAnimationStart", { type: "change", index: next });
    const s = stage!;
    void s.show(next, d).then(async (ok) => {
      if (!ok && phase !== "closed" && s.kind === "webgl" && stage === s) await fallBack(next);
      else if (!ok && phase !== "closed") emit("onError", { index: next, src: photos[next].src, reason: "load", fallback: "none" } satisfies UnfurlError);
      emit("onAnimationEnd", { type: "change", index: next });
    });
  };
  const move = (d: 1 | -1, how: MoveHow) => show(index + d, how, d);

  // ---------- Closing ----------
  const close = () => {
    if (phase === "closing" || phase === "closed") return;
    setPhase("closing");
    emit("onCloseStart", { index });
    emit("onAnimationStart", { type: "close", index });
    void stage!.close(spot(index).box).then(() => {
      if (phase === "closed") return;
      teardown();
      emit("onAnimationEnd", { type: "close", index });
      emit("onCloseEnd", { index });
    });
  };

  const teardown = () => {
    setPhase("closed");
    window.removeEventListener("resize", onResize);
    window.removeEventListener("keydown", onKey, true);
    stage?.destroy(); stage = null;
    hide(null);
    root.remove();
    html.style.overflow = prevOverflow;
    html.style.paddingRight = prevPad;
    const back = options.returnFocus === false ? null : options.returnFocus instanceof HTMLElement ? options.returnFocus : before;
    if (back && document.contains(back)) back.focus({ preventScroll: true });
  };

  // Keys: arrows move, Home and End jump, Escape closes, Tab stays inside (unless focusTrap is false). A key move
  // puts focus on the matching arrow button, so the person sees a clear focus ring on what they just did.
  const ring = (b: HTMLElement) => { if (b.offsetParent !== null && root.contains(document.activeElement)) b.focus({ preventScroll: true }); };
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const act = lightboxKey(e.key);
    if (act) {
      e.preventDefault();
      if (act === "close") close();
      else if (act === "next") { move(1, "key"); ring(nextBtn); }
      else if (act === "prev") { move(-1, "key"); ring(prevBtn); }
      else if (act === "first") show(0, "key", -1);
      else show(n - 1, "key", 1);
    } else if (e.key === "Tab" && trap) {
      const f = Array.from(root.querySelectorAll<HTMLElement>("button, a[href]")).filter((b) => !b.hidden && b.offsetParent !== null);
      e.preventDefault();
      if (!f.length) return;
      const i = f.indexOf(document.activeElement as HTMLElement);
      f[e.shiftKey ? (i <= 0 ? f.length - 1 : i - 1) : (i === -1 || i === f.length - 1 ? 0 : i + 1)].focus();
    }
  };
  window.addEventListener("keydown", onKey, true);

  closeBtn.addEventListener("click", close);
  prevBtn.addEventListener("click", () => move(-1, "button"));
  nextBtn.addEventListener("click", () => move(1, "button"));

  // Gestures. While the finger is down the photo follows it 1:1 (sideways to change photo, down to close, up with
  // resistance); the backdrop fades with the pull. On release the spring takes over with the finger's velocity:
  // it moves, closes or settles back. The photo can be caught at any point, even mid-animation.
  type Drag = { id: number; x: number; y: number; axis: "x" | "y" | null; samples: { x: number; y: number; t: number }[] };
  let drag: Drag | null = null;
  const pull = (dy: number) => Math.min(1, Math.max(0, dy) / (window.innerHeight * 0.5));
  root.addEventListener("pointerdown", (e) => {
    if (drag || !e.isPrimary || (e.target as Element).closest("button, a") || phase === "closing" || phase === "closed") return;
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, axis: null, samples: [{ x: e.clientX, y: e.clientY, t: e.timeStamp }] };
    try { root.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
  });
  root.addEventListener("pointermove", (e) => {
    const d = drag;
    if (!d || e.pointerId !== d.id || !stage) return;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    d.samples.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
    if (d.samples.length > 8) d.samples.shift();
    if (!d.axis) {
      if (Math.hypot(dx, dy) < 8) return;
      d.axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
    }
    if (d.axis === "x") stage.track({ x: n > 1 ? dx : rubber(Math.abs(dx), 60) * Math.sign(dx), y: 0, s: 1 });
    else {
      const p = pull(dy);
      stage.track({ x: dx * 0.5, y: dy > 0 ? dy : -rubber(-dy, 60), s: 1 - 0.15 * p });
      bg.style.transition = "none";
      bg.style.opacity = String(1 - p * 0.75);
    }
  });
  const end = (e: PointerEvent, cancelled: boolean) => {
    const d = drag;
    if (!d || e.pointerId !== d.id) return;
    drag = null;
    const dx = e.clientX - d.x, dy = e.clientY - d.y;
    const v = velocity([...d.samples, { x: e.clientX, y: e.clientY, t: e.timeStamp }]);
    bg.style.transition = "";
    bg.style.opacity = "";
    const intent = cancelled ? null : d.axis === "x" ? swipeIntent(dx, 0, v.vx, 0) : d.axis === "y" ? swipeIntent(0, dy, 0, v.vy) : swipeIntent(dx, dy, v.vx, v.vy);
    if (d.axis) stage?.release(v);
    if (intent === "next" && n > 1) move(1, "swipe");
    else if (intent === "prev" && n > 1) move(-1, "swipe");
    else if (intent === "close" || (intent === "tap" && !d.axis)) close();
  };
  root.addEventListener("pointerup", (e) => end(e, false));
  root.addEventListener("pointercancel", (e) => end(e, true));

  return {
    get index() { return index; },
    get renderer() { return stage?.kind ?? "css"; },
    next: () => move(1, "api"),
    prev: () => move(-1, "api"),
    show: (i: number) => show(i, "api"),
    close,
    destroy: () => { if (phase !== "closed") teardown(); },
  };
}
