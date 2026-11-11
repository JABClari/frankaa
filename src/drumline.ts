// drumline (dondo, the talking drum): a strip of tall pictures under a ruler of ticks, like a line of drummers
// keeping time. Drag or flick it, turn the wheel either way, run along the ruler or use the keys; the picture in
// focus grows and the ticks near it lift. A tap opens the picture in the lightbox, springing from its card. It
// also sits under the lightbox as its filmstrip (unfurl's strip option).
//
// One position drives everything. How it moves is the fluid option:
// - "off": a critically damped spring, 1:1 under the finger;
// - "lerp": the position eases toward its target every frame, trailing the finger a touch, and a fling decays
//   smoothly (about 7% less speed a frame) with no overshoot;
// - "chain": lerp, and each card eases toward the strip at its own rate, nearer the middle first;
// - "bend": lerp, and speed bulges the strip around its middle (WebGL; a DOM version when WebGL is missing, the
//   pictures are cross-origin without CORS headers, or frames run slow).
// Frames are transforms and opacity (and one canvas for bend); layout is read on start and resize only.
import { bandPos, bump, centreAt, centres, drumlineLook, pad, readout, scalesAt, tickAt, wheelDelta, type DrumlineLook, type DrumlinePreset } from "./drumline-math";
export { DRUMLINE_PRESETS, drumlineLook, stripOptions, type DrumlineFluid, type DrumlineLook, type DrumlinePreset } from "./drumline-math";
import { project, springStep, settled, SPRING_OPEN } from "./lightbox-math";
import { fill, resolveReduced, velocity, type ReducedMotion } from "./shared";
import { el, emitter, placeholderStyle, systemReduces } from "./dom";
import { createBend, type BendCard, type BendRenderer } from "./drumline-gl";
import { readArgs, thumbSrc, isVideo, type Items } from "./items";
import type { UnfurlOptions } from "./lightbox";


export type DrumlineLabels = {
  /** The strip's name. Default "Pictures". */
  region: string;
  /** Read out on each change, and each card's name. {n}, {total}. Default "Picture {n} of {total}". */
  position: string;
};
export const DRUMLINE_LABELS: DrumlineLabels = { region: "Pictures", position: "Picture {n} of {total}" };

export type DrumHow = "drag" | "wheel" | "ruler" | "key" | "tap" | "api";
export type DrumlineError = { index: number; src: string; reason: "load" | "webgl" | "cors" | "slow"; fallback: "dom" | "none" };

export type DrumlineHooks = {
  /** The picture in focus changed. */
  onChange?: (index: number, d: { index: number; from: number; how: DrumHow }) => void;
  /** The strip started and stopped moving. type is "scroll". */
  onAnimationStart?: (d: { type: "scroll"; index: number }) => void;
  onAnimationEnd?: (d: { type: "scroll"; index: number }) => void;
  /** A tap, click or Enter on a picture, before it opens. event.preventDefault() keeps it from opening. */
  onSelect?: (index: number, img: HTMLImageElement, event: Event) => void;
  /** The large view opened on a picture. */
  onExpand?: (d: { index: number }) => void;
  /** A picture failed to load, or bend fell back to the DOM (no WebGL, CORS, or slow frames). */
  onError?: (d: DrumlineError) => void;
};

export type DrumlineOptions = DrumlineHooks & DrumlineLook & {
  /** The items (the shared format; strings are taken as src). The strip shows thumb (or src). Or pass them as
   *  the second argument. */
  items?: Items;
  /** The older name for items. */
  photos?: Items;
  /** A starting point for every look option: "ruler" (default), "numbers" or "minimal". */
  preset?: DrumlinePreset;
  /** Shorthand for labels.region. */
  label?: string;
  labels?: Partial<DrumlineLabels>;
  /** The picture to start on. Default 0. */
  start?: number;
  /** Digits for the numbers. Default 2 ("07"). */
  pad?: number;
  /** Which wheel axis moves the strip: "both" (default), "x", "y" or false. At either end the page scrolls on. */
  wheel?: "both" | "x" | "y" | false;
  /** Drag with a finger or the mouse. Default true. */
  drag?: boolean;
  /** A flick carries on and slows (projected from its speed). Default true. */
  inertia?: boolean;
  /** Come to rest on a picture. Default true. */
  snap?: boolean;
  /** For fluid "bend": "auto" (default) uses WebGL where it can, "dom" never does. */
  renderer?: "auto" | "dom";
  /** Open the picture in the lightbox on tap or Enter. Default true. */
  expand?: boolean;
  /** Options for that lightbox (effect, renderer, labels, hooks...). */
  lightbox?: Omit<UnfurlOptions, "items" | "photos" | "start" | "origin">;
  reducedMotion?: ReducedMotion;
  /** Announce changes through a polite live region. Default true. */
  announce?: boolean;
};

export type Drumline = {
  readonly index: number;
  readonly el: HTMLElement;
  /** Which renderer bend is using now: "webgl" or "dom" ("dom" for the other fluid modes). */
  readonly renderer: "webgl" | "dom";
  /** Go to picture i (moves there unless smooth is false or motion is reduced). */
  go(i: number, smooth?: boolean): void;
  next(): void;
  prev(): void;
  /** Open picture i (default the one in focus) in the lightbox. */
  expand(i?: number): void;
  image(i: number): HTMLImageElement | undefined;
  destroy(): void;
};

/** Turn an element into a drumline: drumline(el, items, options) or drumline(el, { items, ...options }). */
export function drumline(root: HTMLElement, items: Items, options?: Omit<DrumlineOptions, "items" | "photos">): Drumline;
export function drumline(root: HTMLElement, options: DrumlineOptions): Drumline;
export function drumline(root: HTMLElement, a: Items | DrumlineOptions, b?: Omit<DrumlineOptions, "items" | "photos">): Drumline {
  const { items, options } = readArgs<DrumlineOptions>(a, b);
  const n = items.length;
  const look = drumlineLook(options);
  const L: DrumlineLabels = { ...DRUMLINE_LABELS, ...(options.label ? { region: options.label } : {}), ...options.labels };
  const still = () => resolveReduced(options.reducedMotion, systemReduces());
  const emit = emitter(options, () => root);
  const grow = Math.max(1, look.grow);
  const feedback = look.focusFeedback;
  const snap = options.snap !== false;
  const inertia = options.inertia !== false;
  const wheelAxis = options.wheel === undefined ? "both" : options.wheel;
  const digits = options.pad ?? 2;
  const announce = options.announce !== false;
  const fluid = look.fluid;

  root.classList.add("fk-drumline", look.look === "bars" ? "fk-dl-bars" : "fk-dl-stories");
  root.setAttribute("role", "region");
  root.setAttribute("aria-roledescription", "carousel");
  root.setAttribute("aria-label", L.region);
  if (still()) root.dataset.motion = "reduced";
  const added: Element[] = [];

  // ---------- The ruler and the numbers ----------
  const ticks: HTMLElement[] = [];
  let ruler: HTMLElement | null = null;
  const head = el("div", "fk-dl-head", { "aria-hidden": "true" });
  if (look.ticks && n > 1) {
    ruler = el("div", "fk-dl-ruler");
    for (let i = 0; i < n; i++) ticks.push(ruler.appendChild(el("i", "fk-dl-tick")));
    head.append(ruler);
  }
  const nums = el("div", look.numbers === "fraction" ? "fk-dl-numbers fk-dl-fraction" : "fk-dl-numbers");
  const rPrev = el("span", "fk-dl-n"), rCur = el("span", "fk-dl-cur"), rNext = el("span", "fk-dl-n");
  nums.append(rPrev, rCur, rNext);
  // The frame sits beside the ruler; a plain count too, or under the strip when there is no ruler.
  const numbersBelow = look.numbers === "fraction" && !ruler;
  if (look.numbers && !numbersBelow) head.append(nums);
  if (head.children.length) { root.append(head); added.push(head); }

  // ---------- The strip ----------
  const viewport = el("div", "fk-dl-viewport");
  const strip = el("div", "fk-dl-strip", { role: "group", "aria-label": L.region });
  const cards: HTMLButtonElement[] = [];
  const srcs = items.map(thumbSrc);
  const imgs = items.map((p, i) => {
    const card = el("button", "fk-dl-card", { type: "button", tabindex: "-1", "aria-label": fill(L.position, { n: i + 1, total: n }) + (p.alt ? `. ${p.alt}` : "") });
    const img = el("img", "fk-dl-img", { alt: "", draggable: "false", decoding: "async", loading: Math.abs(i - (options.start ?? 0)) < 8 ? "eager" : "lazy" });
    placeholderStyle(img, p.placeholder);
    if (!isVideo(p) && !p.thumb && p.srcset) { img.sizes = p.sizes || "160px"; img.srcset = p.srcset; }
    img.src = srcs[i];
    img.addEventListener("error", () => emit("onError", { index: i, src: srcs[i], reason: "load", fallback: "none" } satisfies DrumlineError), { once: true });
    card.append(img);
    strip.append(card);
    cards.push(card);
    return img;
  });
  viewport.append(strip);
  root.append(viewport);
  added.push(viewport);
  if (numbersBelow) { nums.classList.add("fk-dl-below"); nums.setAttribute("aria-hidden", "true"); root.append(nums); added.push(nums); }
  const status = el("span", "fk-sr", announce ? { "aria-live": "polite", "aria-atomic": "true" } : {});
  root.append(status);
  added.push(status);

  // ---------- Bend in WebGL, with the DOM as the fallback ----------
  let gl: BendRenderer | null = null;
  let canvas: HTMLCanvasElement | null = null;
  const toDom = (reason: DrumlineError["reason"], i = -1) => {
    if (!gl) return;
    gl.destroy(); gl = null;
    canvas?.remove(); canvas = null;
    root.classList.remove("fk-dl-gl");
    emit("onError", { index: i, src: i >= 0 ? srcs[i] : "", reason, fallback: "dom" } satisfies DrumlineError);
    paint();
  };
  if (fluid === "bend" && options.renderer !== "dom" && !still()) {
    canvas = el("canvas", "fk-dl-canvas", { "aria-hidden": "true" });
    viewport.prepend(canvas);
    // A picture arriving repaints once (the next frame), so it shows even when the strip is still.
    let pending = 0;
    gl = createBend(canvas, srcs, (i) => toDom("cors", i), () => { if (!pending && !raf) pending = requestAnimationFrame(() => { pending = 0; paint(); }); });
    if (gl) root.classList.add("fk-dl-gl");
    else { canvas.remove(); canvas = null; queueMicrotask(() => emit("onError", { index: -1, src: "", reason: "webgl", fallback: "dom" } satisfies DrumlineError)); }
  }

  // Sizes, read once and on resize: never inside a frame.
  let W = 64, H = 112, GAP = 12, VW = 0, VH = 0, R = 14, rulerW = 0, rulerX = 0;
  const measure = () => {
    const cs = getComputedStyle(root);
    W = parseFloat(cs.getPropertyValue("--fk-dl-w")) || cards[0]?.offsetWidth || 64;
    H = parseFloat(cs.getPropertyValue("--fk-dl-h")) || cards[0]?.offsetHeight || 112;
    GAP = parseFloat(cs.getPropertyValue("--fk-dl-gap")) || 12;
    R = parseFloat(cs.getPropertyValue("--fk-dl-card-radius")) || 0;
    VH = Math.ceil(H * grow * (fluid === "bend" ? 1.22 : 1) + 8);
    viewport.style.height = `${VH}px`;
    VW = viewport.clientWidth;
    gl?.resize(VW, VH);
    if (ruler) { const r = ruler.getBoundingClientRect(); rulerW = r.width; rulerX = r.left; }
  };

  // ---------- Motion ----------
  let pos = Math.min(n - 1, Math.max(0, options.start ?? 0));
  let target = pos, vel = 0, held = false, focusPos: number | null = null, speed = 0;
  const cpos = items.map(() => pos);
  let at = -1;
  let raf = 0, last = 0, moving = false, lastHow: DrumHow = "api";
  let slowFrames = 0, slowSum = 0;
  const pitch = () => W + GAP;
  let focusWant = -1;

  const sat = (i: number) => (look.colorFocus ? 0.55 + 0.45 * bump(i - pos, 2.5) : 1);
  const light = (i: number) => (look.colorFocus ? 0.84 + 0.16 * bump(i - pos, 2.5) : 1);
  let lastFilter: string[] = [];
  const paint = () => {
    const s = scalesAt(n, pos, grow);
    const c = centres(s, W, GAP);
    const off = VW / 2 - centreAt(c, pos) - (pos < 0 ? pos * pitch() : pos > n - 1 ? (pos - (n - 1)) * pitch() : 0);
    const amt = fluid === "bend" && !still() ? Math.min(1, Math.abs(speed) / 2200) * 0.22 : 0;
    const reach = VW * 0.42, mid = VH / 2;
    const glCards: BendCard[] = [];
    for (let i = 0; i < n; i++) {
      const lag = fluid === "chain" ? (cpos[i] - pos) * pitch() : 0;
      const x = off + c[i] - W / 2 - lag;
      const card = cards[i];
      if (x + W * s[i] < -W * 2 || x - W * s[i] > VW + W * 2) { if (card.style.visibility !== "hidden") card.style.visibility = "hidden"; continue; }
      if (card.style.visibility) card.style.visibility = "";
      // Focus waits until its card is on screen (hidden cards cannot take it).
      if (focusWant === i) { focusWant = -1; card.focus({ preventScroll: true }); }
      const alpha = feedback ? 1 - 0.4 * (1 - bump(i - pos, 2.5)) : 1;
      if (gl) {
        // WebGL draws the picture; the button stays for focus and taps.
        card.style.transform = `translate3d(${x}px, 0, 0) scale(${s[i]})`;
        const w = W * s[i], h = H * s[i];
        glCards.push({ i, x: x + W / 2 - w / 2, y: mid - h / 2, w, h, radius: R * s[i], alpha, sat: sat(i), light: light(i) });
        continue;
      }
      if (amt > 0.001) {
        // The DOM bend: each card takes the slope of the bulge, so tops and bottoms trace a curve.
        const hAt = (px: number) => 1 + amt * bump(px - VW / 2, reach);
        const cx = x + W / 2, m = hAt(cx);
        const slope = ((hAt(cx + (W * s[i]) / 2) - hAt(cx - (W * s[i]) / 2)) * H) / 2 / W;
        card.style.transform = `translate3d(${x}px, 0, 0) skewY(${(-Math.atan(slope) * 180) / Math.PI}deg) scale(${s[i]}, ${s[i] * m})`;
      } else card.style.transform = `translate3d(${x}px, 0, 0) scale(${s[i]})`;
      card.style.opacity = String(alpha);
      if (look.colorFocus) {
        // Quantised, so a moving strip repaints a filter only when it visibly changes.
        const f = `saturate(${Math.round(sat(i) * 20) / 20}) brightness(${Math.round(light(i) * 40) / 40})`;
        if (lastFilter[i] !== f) { card.style.filter = f; lastFilter[i] = f; }
      }
    }
    if (gl) gl.draw(glCards, amt, VW / 2, reach, mid);
    const fp = focusPos ?? pos;
    for (let i = 0; i < ticks.length; i++) {
      const lift = feedback ? bump(i - fp, 3) : i === Math.round(fp) ? 1 : 0;
      ticks[i].style.transform = `scaleY(${1 + 1.25 * lift})`;
      ticks[i].style.opacity = String(0.3 + 0.7 * lift);
    }
  };
  const setIndex = (i: number, how: DrumHow) => {
    if (i === at) return;
    const from = at;
    at = i;
    cards.forEach((c, k) => {
      c.tabIndex = k === at ? 0 : -1;
      if (k === at) c.setAttribute("aria-current", "true"); else c.removeAttribute("aria-current");
    });
    const r = readout(at, n);
    if (look.numbers === "fraction") { rPrev.textContent = ""; rCur.textContent = pad(r.cur, digits); rNext.textContent = `/ ${pad(n, digits)}`; }
    else { rPrev.textContent = r.prev === null ? "" : pad(r.prev, digits); rCur.textContent = pad(r.cur, digits); rNext.textContent = r.next === null ? "" : pad(r.next, digits); }
    if (from >= 0) { nums.classList.remove("fk-dl-tick-in"); void nums.offsetWidth; nums.classList.add("fk-dl-tick-in"); }
    if (announce && from >= 0) status.textContent = fill(L.position, { n: at + 1, total: n }) + (items[at].alt ? `. ${items[at].alt}` : "");
    if (from >= 0) emit("onChange", { index: at, from, how }, at, { index: at, from, how });
  };
  const frame = (now: number) => {
    const dt = Math.min(1 / 15, last ? (now - last) / 1000 : 1 / 60);
    last = now;
    let busy = held;
    const before = pos;
    if (still()) { pos = target; vel = 0; }
    else if (fluid !== "off") {
      // Damped follow: ease toward the target (quicker while held, so the strip trails the hand a touch).
      // A flick or wheel glides out slowly (as measured); a jump from the keys, the ruler or the code is quicker.
      const k = held ? 16 : lastHow === "drag" || lastHow === "wheel" ? 4.6 : 10;
      pos += (target - pos) * (1 - Math.exp(-dt * k));
      if (!held && Math.abs(target - pos) * W < 0.3) pos = target; else busy = true;
    } else if (!held) {
      const steps = Math.max(1, Math.ceil(dt * 120)), h = dt / steps;
      for (let k = 0; k < steps; k++) [pos, vel] = springStep(pos, vel, target, h, SPRING_OPEN);
      if (settled(pos * W, vel * W, target * W)) { pos = target; vel = 0; } else busy = true;
    }
    speed += (((pos - before) * pitch()) / Math.max(dt, 0.001) - speed) * 0.25;
    if (Math.abs(speed) > 20) busy = true; else if (!busy) speed = 0;
    if (fluid === "chain") for (let i = 0; i < n; i++) {
      const k = 30 / (1 + 0.12 * Math.abs(i - pos));
      cpos[i] += (pos - cpos[i]) * (1 - Math.exp(-dt * k));
      if (Math.abs(cpos[i] - pos) * W > 0.3) busy = true; else cpos[i] = pos;
    }
    // WebGL that cannot hold about 50 fps while moving (frames averaging over 20 ms) hands over to the DOM.
    if (gl && last) { slowSum += dt; slowFrames++; if (slowFrames >= 45) { if (slowSum / slowFrames > 0.02) toDom("slow"); slowFrames = 0; slowSum = 0; } }
    paint();
    setIndex(Math.min(n - 1, Math.max(0, Math.round(pos))), lastHow);
    if (busy) { raf = requestAnimationFrame(frame); return; }
    raf = 0; last = 0; slowFrames = 0; slowSum = 0;
    if (moving) { moving = false; emit("onAnimationEnd", { type: "scroll", index: at }); }
    for (const c of cards) c.style.willChange = "";
  };
  const kick = () => {
    if (!moving) { moving = true; emit("onAnimationStart", { type: "scroll", index: at }); for (const c of cards) c.style.willChange = "transform"; }
    if (!raf) raf = requestAnimationFrame(frame);
  };
  const clampI = (i: number) => Math.min(n - 1, Math.max(0, i));
  const go = (i: number, smooth = true, how: DrumHow = "api", v = 0) => {
    lastHow = how;
    target = clampI(Math.round(i));
    if (!smooth || still()) { pos = target; vel = 0; cpos.fill(pos); speed = 0; } else vel = v;
    kick();
  };

  // ---------- Drag (finger or mouse); a flick is projected to the nearest picture ----------
  let drag: { id: number; x: number; p0: number; moved: boolean; samples: { x: number; y: number; t: number }[] } | null = null;
  // The click a drag ends with is swallowed; only for a moment, so a later tap or Enter always counts.
  let swallowUntil = 0;
  const onDown = (e: PointerEvent) => {
    swallowUntil = 0;
    if (options.drag === false || drag || !e.isPrimary || e.button > 0) return;
    drag = { id: e.pointerId, x: e.clientX, p0: pos, moved: false, samples: [{ x: e.clientX, y: e.clientY, t: e.timeStamp }] };
  };
  const onMove = (e: PointerEvent) => {
    const d = drag;
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x;
    d.samples.push({ x: e.clientX, y: e.clientY, t: e.timeStamp });
    if (d.samples.length > 8) d.samples.shift();
    if (!d.moved) {
      if (Math.abs(dx) < 6) return;
      d.moved = true;
      held = true; vel = 0;
      try { viewport.setPointerCapture(e.pointerId); } catch { /* gone */ }
      viewport.classList.add("fk-dl-dragging");
    }
    lastHow = "drag";
    target = bandPos(d.p0 - dx / pitch(), n);
    if (fluid === "off" || still()) pos = target;
    kick();
  };
  const onUp = (e: PointerEvent) => {
    const d = drag;
    if (!d || e.pointerId !== d.id) return;
    drag = null;
    viewport.classList.remove("fk-dl-dragging");
    if (!d.moved) return;
    swallowUntil = e.timeStamp + 400;
    held = false;
    const lastMove = d.samples[d.samples.length - 1];
    const vx = e.timeStamp - lastMove.t > 100 ? 0 : velocity(d.samples).vx;
    const from = fluid === "off" ? pos : target;
    const end = from + (inertia ? project(-vx) : 0) / pitch();
    target = snap ? clampI(Math.round(end)) : Math.min(n - 1, Math.max(0, end));
    vel = inertia ? -vx / pitch() : 0;
    kick();
  };

  // ---------- Wheel: either axis, follows while it turns, then snaps; at the ends the page scrolls on ----------
  let wheelIdle = 0, wheelAcc = 0;
  const onWheel = (e: WheelEvent) => {
    if (e.ctrlKey) return;
    const dl = wheelDelta(e.deltaX, e.deltaY, e.deltaMode, wheelAxis);
    if (!dl) return;
    if ((target <= 0 && dl < 0) || (target >= n - 1 && dl > 0)) return;
    e.preventDefault();
    lastHow = "wheel";
    if (still()) {
      wheelAcc += dl;
      if (Math.abs(wheelAcc) > 40) { go(at + Math.sign(wheelAcc), false, "wheel"); wheelAcc = 0; }
      return;
    }
    held = true;
    target = Math.min(n - 1, Math.max(0, target + dl / pitch()));
    if (fluid === "off") pos = target;
    kick();
    clearTimeout(wheelIdle);
    wheelIdle = window.setTimeout(() => {
      held = false;
      target = snap ? clampI(Math.round(target)) : target;
      kick();
    }, 140);
  };

  // ---------- The ruler: hover (mouse) or drag scrubs ----------
  let scrubbing = false;
  const rulerPos = (e: PointerEvent) => tickAt(e.clientX - rulerX, rulerW, n);
  const onRulerMove = (e: PointerEvent) => {
    if (!ruler) return;
    const hover = e.pointerType === "mouse" && look.rulerHover;
    if (!scrubbing && !hover) return;
    if (!rulerW) measure();
    focusPos = rulerPos(e);
    go(focusPos, true, "ruler");
  };
  const onRulerDown = (e: PointerEvent) => {
    if (!ruler) return;
    scrubbing = true;
    measure();
    try { ruler.setPointerCapture(e.pointerId); } catch { /* gone */ }
    onRulerMove(e);
  };
  const onRulerUp = () => { scrubbing = false; };
  const onRulerLeave = () => { if (!scrubbing) { focusPos = null; kick(); } };

  // ---------- Taps and keys ----------
  let lightboxOpen = false;
  const expand = (i = at) => {
    if (lightboxOpen) return;
    lightboxOpen = true;
    go(i, true, "tap");
    const lb = options.lightbox ?? {};
    // The lightbox loads only when first used.
    void import("./lightbox").then(({ unfurl }) => {
      unfurl(items, {
        radius: R, ...lb,
        start: i,
        origin: (k) => imgs[k],
        onChange: (k, d) => { go(k, false, "api"); lb.onChange?.(k, d); },
        onCloseEnd: (d) => { lightboxOpen = false; lb.onCloseEnd?.(d); },
      });
      emit("onExpand", { index: i });
    });
  };
  const open = (i: number, ev: Event) => {
    options.onSelect?.(i, imgs[i], ev);
    if (ev.defaultPrevented || options.expand === false) { go(i, true, "tap"); return; }
    expand(i);
  };
  const onClick = (e: MouseEvent) => {
    if (e.timeStamp < swallowUntil) { swallowUntil = 0; e.preventDefault(); e.stopPropagation(); return; }
    const card = (e.target as Element).closest?.(".fk-dl-card");
    if (card) open(cards.indexOf(card as HTMLButtonElement), e);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    let i: number | null = null;
    if (e.key === "ArrowRight") i = at + 1;
    else if (e.key === "ArrowLeft") i = at - 1;
    else if (e.key === "Home") i = 0;
    else if (e.key === "End") i = n - 1;
    if (i === null) return;
    e.preventDefault();
    const k = clampI(i);
    go(k, true, "key");
    cards[k].tabIndex = 0;
    if (cards[k].style.visibility === "hidden") focusWant = k; else cards[k].focus({ preventScroll: true });
  };

  viewport.addEventListener("pointerdown", onDown);
  viewport.addEventListener("pointermove", onMove);
  viewport.addEventListener("pointerup", onUp);
  viewport.addEventListener("pointercancel", onUp);
  viewport.addEventListener("click", onClick, true);
  viewport.addEventListener("wheel", onWheel, { passive: false });
  strip.addEventListener("keydown", onKey);
  ruler?.addEventListener("pointermove", onRulerMove);
  ruler?.addEventListener("pointerdown", onRulerDown);
  ruler?.addEventListener("pointerup", onRulerUp);
  ruler?.addEventListener("pointercancel", onRulerUp);
  ruler?.addEventListener("pointerleave", onRulerLeave);
  const onResize = () => { measure(); paint(); };
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(onResize) : null;
  ro?.observe(root);
  window.addEventListener("resize", onResize);

  // First paint.
  measure();
  setIndex(Math.round(pos), "api");
  paint();

  return {
    get index() { return at; },
    get renderer() { return gl ? "webgl" : "dom"; },
    el: root,
    go: (i, smooth = true) => go(i, smooth, "api"),
    next: () => go(at + 1, true, "api"),
    prev: () => go(at - 1, true, "api"),
    expand: (i) => expand(i ?? at),
    image: (i) => imgs[i],
    destroy() {
      cancelAnimationFrame(raf);
      clearTimeout(wheelIdle);
      ro?.disconnect();
      window.removeEventListener("resize", onResize);
      gl?.destroy(); gl = null;
      canvas?.remove();
      added.forEach((x) => x.remove());
      root.classList.remove("fk-drumline", "fk-dl-bars", "fk-dl-stories", "fk-dl-gl");
      ["role", "aria-roledescription", "aria-label", "data-motion"].forEach((x) => root.removeAttribute(x));
    },
  };
}

