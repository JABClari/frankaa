// The CSS renderer: no WebGL. Each photo is a layer laid out at its open size; transforms alone move it (FLIP: the
// layer moves and scales, its photo scales back so it stays undistorted), and photos crossfade with opacity.
// - One spring moves the current photo (open, close, pull down); another moves the strip of photos sideways
//   while swiping, with the neighbours beside it.
// - Photos are decoded (img.decode()) before they are shown, and the neighbours are loaded and decoded ahead.
// - A move never waits for the next photo: its layer exists at once, in the photo's shape, and while the photo
//   loads it shows the loading film (a CSS sheen on a neutral frame, transform-only) under it; the photo then fades
//   in, in place. Only the latest move ever changes the picture.
// - Layout is read only when a layer is placed or the window resizes, never inside an animation frame, and
//   will-change is set only while something moves.
import { containBox, draggedBox, flipFrame, neighbours, radiusAt, stepBox, stripStep, STRIP_GAP, SPRING_CLOSE, SPRING_OPEN, type Box, type R4, type Stage, type StageCtx, type StageSource } from "./lightbox-math";
import type { CssTransition } from "./effects";
import { el, placeholderStyle } from "./dom";
import { LOAD_GRACE_MS, REVEAL_MS, REVEAL_STILL_MS, frameAspect, latest } from "./loading-math";

const FADE_MS = 160;
const UI_MAX_MS = 300;
const EASE_OUT = "cubic-bezier(.23, 1, .32, 1)";

/** state: loading, ok or failed. shown: drawn on screen while loading (so it fades in when it arrives). */
type Layer = { i: number; frame: HTMLDivElement; img: HTMLImageElement; rest: Box; aspect: number; state: "loading" | "ok" | "failed"; ready: Promise<boolean>; shown: boolean; preview: number | null };

export type CssSource = StageSource;

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** film: draw the loading film (false for "none" and for your own loading view, which draws its own). */
export function createCssStage(host: HTMLElement, srcs: CssSource[], transition: CssTransition, ctx: StageCtx, film = true): Stage {
  let cur: Layer | null = null;
  const turn = latest();
  let dead = false;
  let area = ctx.area();
  // The shape of the last photo shown: a photo with nothing else to go by takes it while it loads.
  let lastAspect = 1.5;
  const pitch = () => area.w + STRIP_GAP;
  const live = (i: number) => srcs[i]?.live !== false;

  // ---------- Layers: made at once, loaded and decoded once, kept, attached only when near ----------
  const layers = new Map<number, Layer>();
  const load = (l: Layer) => {
    const s = srcs[l.i];
    const img = el("img", "fk-unfurl-img", { alt: "", decoding: "async", draggable: "false" });
    if (l.img) l.img.replaceWith(img); else l.frame.append(img);
    l.img = img;
    l.state = "loading";
    if (live(l.i)) l.frame.dataset.load = "loading";
    if (s.srcset) { img.sizes = s.sizes || "100vw"; img.srcset = s.srcset; }
    img.src = s.src;
    l.ready = new Promise<boolean>((resolve) => {
      const done = () => { l.aspect = img.naturalWidth / Math.max(1, img.naturalHeight) || l.aspect; l.state = "ok"; resolve(true); };
      const wait = typeof img.decode === "function" ? img.decode() : new Promise<void>((r, j) => { img.onload = () => r(); img.onerror = j; });
      wait.then(done, () => { if (img.complete && img.naturalWidth) done(); else { l.state = "failed"; resolve(false); } });
    });
    void l.ready.then((ok) => { if (l.img === img) landed(l, ok); });
  };
  const layer = (i: number): Layer => {
    let l = layers.get(i);
    if (l) return l;
    const s = srcs[i];
    const frame = el("div", "fk-unfurl-frame");
    placeholderStyle(frame, s.placeholder);
    l = { i, frame, img: null as unknown as HTMLImageElement, rest: { x: 0, y: 0, w: 1, h: 1 }, aspect: frameAspect({ given: s.aspect, previous: lastAspect }), state: "loading", ready: Promise.resolve(false), shown: false, preview: null };
    layers.set(i, l);
    // The preview gives the frame its shape when the photo's own size is not given (usually from the cache).
    if (s.preview && !s.aspect && live(i)) {
      const p = new Image();
      const got = () => {
        const L = l!;
        L.preview = p.naturalWidth / Math.max(1, p.naturalHeight);
        if (L.state !== "ok") { L.aspect = L.preview; if (L.frame.isConnected) refit(L); }
      };
      p.onload = got;
      p.src = s.preview;
      if (p.complete && p.naturalWidth) { p.onload = null; l.preview = p.naturalWidth / Math.max(1, p.naturalHeight); l.aspect = l.preview; }
    }
    load(l);
    return l;
  };
  const place = (l: Layer) => {
    l.rest = containBox(l.aspect, area);
    const s = l.frame.style;
    s.left = `${l.rest.x}px`; s.top = `${l.rest.y}px`; s.width = `${l.rest.w}px`; s.height = `${l.rest.h}px`;
    s.borderRadius = css(ctx.rOpen);
  };
  const css = (r: R4, sx = 1, sy = 1) => `${r[0] / sx}px ${r[1] / sx}px ${r[2] / sx}px ${r[3] / sx}px / ${r[0] / sy}px ${r[1] / sy}px ${r[2] / sy}px ${r[3] / sy}px`;
  // The loading film sits under the photo inside the frame (added only while the photo is loading or failed).
  const film$ = (l: Layer) => {
    if (!film || l.frame.querySelector(".fk-unfurl-mat")) return;
    l.frame.prepend(el("div", "fk-unfurl-mat", { "aria-hidden": "true" }));
  };
  const attach = (l: Layer, hidden: boolean) => {
    if (!l.frame.isConnected) host.append(l.frame);
    if (l.state !== "ok" && live(l.i)) film$(l);
    place(l);
    l.frame.style.visibility = hidden ? "hidden" : "";
  };
  // The photo's load settled. A layer on screen while loading fades the photo in over its film, in place (springing
  // to the photo's own shape if that differs), or shows that it failed.
  const landed = (l: Layer, ok: boolean) => {
    if (dead || !live(l.i)) return;
    const mine = cur === l && l.shown;
    if (!ok) {
      l.frame.dataset.load = "failed";
      if (mine) ctx.status?.(l.i, "failed");
      return;
    }
    if (!mine) { delete l.frame.dataset.load; l.frame.querySelector(".fk-unfurl-mat")?.remove(); l.shown = false; return; }
    l.frame.dataset.load = "reveal";
    if (l.frame.isConnected) refit(l);
    ctx.status?.(l.i, "ready");
    const ms = ctx.still ? REVEAL_STILL_MS : REVEAL_MS;
    void fade(l.img, [{ opacity: 0 }, { opacity: 1 }], ms).then(() => {
      if (l.state !== "ok") return;
      delete l.frame.dataset.load;
      l.img.getAnimations?.().forEach((a) => a.cancel());
      l.frame.querySelector(".fk-unfurl-mat")?.remove();
      l.shown = false;
    });
  };
  // Load, decode and attach (hidden) the neighbours of photo i, so a swipe shows them at once.
  const near = new Map<number, Layer>();
  const prefetch = (i: number) => {
    const { prev, next } = neighbours(i, srcs.length, ctx.loop);
    for (const j of [next, prev]) {
      if (j === null) continue;
      const l = layer(j);
      if (dead || !cur || l === cur) continue;
      near.set(j, l);
      if (!l.frame.isConnected) attach(l, true);
    }
    // Drop layers that are no longer beside the current photo (they stay cached, off the page).
    for (const [j, l] of near) {
      if (j !== prev && j !== next && l !== cur) { l.frame.remove(); near.delete(j); }
    }
  };

  // ---------- Painting ----------
  const paint = (l: Layer, box: Box, r: R4, dx: number) => {
    const f = flipFrame(box, l.rest);
    l.frame.style.transform = `translate3d(${f.tx + dx}px, ${f.ty}px, 0) scale(${f.sx}, ${f.sy})`;
    l.img.style.transform = `scale(${f.ix}, ${f.iy})`;
    // The radius is divided back out of the scale so the corners stay round.
    l.frame.style.borderRadius = css(r, f.sx, f.sy);
  };
  const paintNeighbours = () => {
    if (!cur) return;
    const show = strip.held || Math.abs(strip.x) > 0.5;
    const { prev, next } = neighbours(cur.i, srcs.length, ctx.loop);
    for (const [j, k] of [[prev, -1], [next, 1]] as const) {
      const l = j === null ? undefined : near.get(j);
      if (!l || l === cur) continue;
      l.frame.style.visibility = show ? "" : "hidden";
      l.frame.style.transform = show ? `translate3d(${k * pitch() + strip.x}px, 0, 0)` : "";
      l.frame.style.willChange = show ? "transform" : "";
    }
  };
  const rest = (l: Layer) => {
    l.frame.style.transform = l.img.style.transform = l.frame.style.willChange = l.img.style.willChange = "";
    l.frame.style.borderRadius = css(ctx.rOpen);
  };
  const fade = (node: HTMLElement, frames: Keyframe[], ms: number) => new Promise<void>((resolve) => {
    if (typeof node.animate !== "function" || ms <= 0) { resolve(); return; }
    const a = node.animate(frames, { duration: ms, easing: EASE_OUT, fill: "both" });
    a.onfinish = a.oncancel = () => resolve();
  });

  // ---------- Springs: the current photo, and the strip ----------
  const sp = { box: { x: 0, y: 0, w: 1, h: 1 } as Box, vel: [0, 0, 0, 0], target: { x: 0, y: 0, w: 1, h: 1 } as Box, closing: false };
  const strip = { x: 0, v: 0, held: false };
  let raf = 0, last = 0, held = false, springing = false;
  let waiters: (() => void)[] = [];
  const frame = (now: number) => {
    const l = cur;
    if (dead || !l) { raf = 0; return; }
    const dt = Math.min(1 / 15, last ? (now - last) / 1000 : 1 / 60);
    last = now;
    let moving = false;
    if (held) moving = true;
    else if (springing) {
      if (ctx.still) { sp.box = { ...sp.target }; springing = false; }
      else { springing = stepBox(sp.box, sp.vel, sp.target, dt, sp.closing ? SPRING_CLOSE : SPRING_OPEN); moving = springing; }
    }
    if (strip.held) moving = true;
    else if (strip.x !== 0 || strip.v !== 0) {
      if (ctx.still) { strip.x = 0; strip.v = 0; }
      else {
        [strip.x, strip.v] = stripStep(strip.x, strip.v, dt);
        if (Math.abs(strip.x) < 0.25 && Math.abs(strip.v) < 2) { strip.x = 0; strip.v = 0; } else moving = true;
      }
    }
    paint(l, sp.box, radiusAt(sp.closing, sp.box, sp.target, ctx.rSpot(l.i), ctx.rOpen), strip.x);
    paintNeighbours();
    if (moving) { raf = requestAnimationFrame(frame); return; }
    raf = 0; last = 0;
    // At rest: back to plain layout when open at its size; when zoomed keep the transform but drop will-change,
    // so the browser redraws the photo sharp at its zoomed size.
    if (!sp.closing) {
      const r = l.rest, b = sp.box;
      if (Math.abs(b.w - r.w) < 0.5 && Math.abs(b.x - r.x) < 0.5 && Math.abs(b.y - r.y) < 0.5) rest(l);
      else l.frame.style.willChange = l.img.style.willChange = "";
    }
    const w = waiters; waiters = [];
    w.forEach((f) => f());
  };
  const run = () => new Promise<void>((resolve) => {
    if (dead || !cur) { resolve(); return; }
    waiters.push(resolve);
    cur.frame.style.willChange = cur.img.style.willChange = "transform";
    if (!raf) raf = requestAnimationFrame(frame);
  });
  const atRest = () => !raf && !held && !strip.held;
  // Re-place a layer whose shape changed (resize, or its photo's own shape arrived); the current one springs from
  // where it is now to its new place, so nothing jumps.
  const refit = (l: Layer) => {
    if (l !== cur) { place(l); return; }
    const from = held || raf ? { ...sp.box } : { ...l.rest };
    place(l);
    sp.target = l.rest;
    if (held) return;
    sp.box = ctx.still ? { ...l.rest } : from;
    springing = true;
    paint(l, sp.box, ctx.rOpen, strip.x);
    void run();
  };
  // Layer l is on screen while still loading (or failed): say so.
  const showing = (l: Layer) => {
    if (!live(l.i) || l.state === "ok") return;
    l.shown = true;
    film$(l);
    ctx.status?.(l.i, "loading");
    if (l.state === "failed") ctx.status?.(l.i, "failed");
  };

  return {
    kind: "css",
    async open(i, from, started) {
      area = ctx.area();
      const t = turn.take();
      const l = layer(i);
      const ok = await l.ready;
      if (dead || !turn.is(t)) return ok;
      if (!ok && !live(i)) return false;
      attach(l, false);
      cur = l;
      lastAspect = l.aspect;
      started?.();
      // A photo that did not load opens as its frame, which says so (and offers to try again).
      if (!ok) { l.shown = true; film$(l); from = null; }
      if (ctx.still || !from) {
        sp.box = { ...l.rest }; sp.target = l.rest; sp.vel = [0, 0, 0, 0];
        await fade(l.frame, [{ opacity: 0, transform: ctx.still ? "none" : "scale(.96)" }, { opacity: 1, transform: "none" }], ctx.still ? FADE_MS : 220);
        l.frame.getAnimations?.().forEach((a) => a.cancel());
      } else {
        sp.box = { ...from }; sp.vel = [0, 0, 0, 0]; sp.target = l.rest; sp.closing = false; springing = true;
        paint(l, sp.box, ctx.rSpot(i), 0);
        await run();
      }
      prefetch(i);
      return ok;
    },
    rect() { return cur ? { ...cur.rest } : null; },
    current() { return cur && cur.state === "ok" && !cur.shown ? { ...sp.box } : null; },
    place(box) {
      const l = cur;
      if (!l || dead) return;
      held = true;
      sp.box = { ...box }; sp.vel = [0, 0, 0, 0];
      l.frame.style.willChange = l.img.style.willChange = "transform";
      if (!raf) paint(l, sp.box, ctx.rOpen, strip.x);
    },
    async glide(box, v) {
      held = false;
      if (!cur) return;
      sp.target = { ...box }; sp.vel = [v.vx, v.vy, 0, 0]; springing = true;
      await run();
    },
    async show(i, dir, plain) {
      const t = turn.take();
      const l = layer(i);
      // A photo that failed before is asked for again.
      if (l.state === "failed" && live(i)) load(l);
      if (!live(i)) {
        // A video's poster: shown once decoded, as before.
        if (!(await l.ready)) return dead || !turn.is(t);
      } else {
        // A photo in the cache lands within a frame or two; any other shows at once with its loading film.
        await Promise.race([l.ready, sleep(LOAD_GRACE_MS)]);
      }
      if (dead || !turn.is(t)) return true;
      const old = cur;
      const moved = !!old && !atRest();
      if (old && l.state !== "ok" && !srcs[i].aspect && l.preview === null) { l.aspect = old.aspect; }
      attach(l, false);
      near.delete(i);
      cur = l;
      if (l.state === "ok") lastAspect = l.aspect;
      showing(l);
      if (!moved) { sp.box = { ...l.rest }; sp.target = l.rest; sp.vel = [0, 0, 0, 0]; springing = false; }
      if (old && old !== l) { old.frame.style.visibility = ""; }
      const ms = ctx.still ? FADE_MS : Math.min(UI_MAX_MS, ctx.duration);
      if (moved && old && old !== l) {
        // The photo was moving: the new one takes over from where the old one is, and they crossfade.
        const off = { x: sp.box.x - old.rest.x + strip.x, y: sp.box.y - old.rest.y };
        strip.x = 0; strip.v = 0;
        sp.box = { x: l.rest.x + off.x, y: l.rest.y + off.y, w: l.rest.w, h: l.rest.h }; sp.target = l.rest; springing = true;
        paint(l, sp.box, ctx.rOpen, 0);
        await Promise.all([fade(l.frame, [{ opacity: 0 }, { opacity: 1 }], ms), fade(old.frame, [{ opacity: 1 }, { opacity: 0 }], ms), run()]);
      } else {
        const kind = ctx.still || plain ? "fade" : transition;
        if (kind !== "none" && ms > 0 && old && old !== l) {
          const x = `${dir * 4}%`;
          const inFrom = kind === "slide" ? `translate3d(${x}, 0, 0)` : kind === "zoom" ? "scale(1.04)" : "none";
          const outTo = kind === "slide" ? `translate3d(${-dir * 4}%, 0, 0)` : kind === "zoom" ? "scale(.98)" : "none";
          for (const n of [l.frame, old.frame]) n.style.willChange = "transform, opacity";
          await Promise.all([
            fade(l.frame, [{ opacity: 0, transform: inFrom }, { opacity: 1, transform: "none" }], ms),
            fade(old.frame, [{ opacity: 1, transform: "none" }, { opacity: 0, transform: outTo }], ms),
          ]);
        }
      }
      if (old && old !== l && cur === l) { old.frame.getAnimations?.().forEach((a) => a.cancel()); old.frame.remove(); rest(old); }
      l.frame.getAnimations?.().forEach((a) => a.cancel());
      l.frame.style.willChange = "";
      if (cur === l) prefetch(i);
      return true;
    },
    retry(i) {
      const l = layers.get(i);
      if (dead || !l || l !== cur || l.state !== "failed") return;
      l.frame.dataset.load = "loading";
      load(l);
      ctx.status?.(i, "loading");
    },
    async close(to) {
      const l = cur;
      turn.take();
      held = false; strip.held = false;
      if (!l) return;
      // Hide the neighbours, and close from where the photo is on screen.
      for (const [, n] of near) if (n !== l) n.frame.style.visibility = "hidden";
      if (ctx.still || !to) {
        cancelAnimationFrame(raf); raf = 0;
        await fade(l.frame, [{ opacity: 1 }, { opacity: 0 }], FADE_MS);
        return;
      }
      sp.box = { ...sp.box, x: sp.box.x + strip.x }; strip.x = 0; strip.v = 0;
      sp.target = { ...to }; sp.closing = true; springing = true;
      await run();
    },
    track(o) {
      const l = cur;
      if (!l || dead) return;
      held = true;
      sp.box = draggedBox(l.rest, o);
      sp.vel = [0, 0, 0, 0];
      l.frame.style.willChange = l.img.style.willChange = "transform";
      if (!raf) paint(l, sp.box, ctx.rOpen, strip.x);
    },
    release(v) {
      held = false;
      if (!cur) return;
      sp.vel = [v.vx, v.vy, 0, 0]; sp.target = cur.rest; springing = true;
      void run();
    },
    pan(x) {
      const l = cur;
      if (!l || dead) return;
      strip.held = true; strip.x = x; strip.v = 0;
      l.frame.style.willChange = "transform";
      if (!raf) raf = requestAnimationFrame(frame);
    },
    async settle(dir, vx) {
      strip.held = false;
      strip.v = vx;
      if (dir !== 0 && cur) {
        const { prev, next } = neighbours(cur.i, srcs.length, ctx.loop);
        const j = dir > 0 ? next : prev;
        const l = j === null ? undefined : near.get(j);
        if (j !== null && l) {
          // The neighbour becomes current; the strip is re-based so nothing moves on screen.
          turn.take();
          const old = cur;
          rest(old);
          near.delete(j);
          near.set(old.i, old);
          cur = l;
          if (l.state === "failed" && live(j)) load(l);
          showing(l);
          l.frame.style.visibility = "";
          sp.box = { ...l.rest }; sp.target = l.rest; sp.vel = [0, 0, 0, 0]; springing = false;
          strip.x += dir * pitch();
        }
      }
      await run();
      if (cur) prefetch(cur.i);
    },
    resize() {
      area = ctx.area();
      const l = cur;
      for (const [, n] of near) if (n !== l) place(n);
      if (l) refit(l);
    },
    destroy() {
      dead = true;
      cancelAnimationFrame(raf);
      const w = waiters; waiters = []; w.forEach((f) => f());
      host.replaceChildren();
    },
  };
}
