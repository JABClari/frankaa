// The CSS renderer: no WebGL. Each photo is a layer laid out at its open size; transforms alone move it (FLIP: the
// layer moves and scales, its photo scales back so it stays undistorted), and photos crossfade with opacity.
// - One spring moves the current photo (open, close, pull down); another moves the strip of photos sideways
//   while swiping, with the neighbours beside it.
// - Photos are decoded (img.decode()) before they are shown, and the neighbours are loaded and decoded ahead.
// - Layout is read only when a layer is placed or the window resizes, never inside an animation frame, and
//   will-change is set only while something moves.
import { containBox, draggedBox, flipFrame, neighbours, radiusAt, stepBox, stripStep, STRIP_GAP, SPRING_CLOSE, SPRING_OPEN, type Box, type Stage, type StageCtx } from "./lightbox-math";
import type { CssTransition } from "./effects";
import { el } from "./dom";

const FADE_MS = 160;
const UI_MAX_MS = 300;
const EASE_OUT = "cubic-bezier(.23, 1, .32, 1)";

type Layer = { i: number; frame: HTMLDivElement; img: HTMLImageElement; rest: Box; aspect: number };

export function createCssStage(host: HTMLElement, srcs: { src: string; alt?: string }[], transition: CssTransition, ctx: StageCtx): Stage {
  let cur: Layer | null = null;
  let token = 0;
  let dead = false;
  let area = ctx.area();
  const pitch = () => area.w + STRIP_GAP;

  // ---------- Layers: loaded and decoded once, kept, attached only when near ----------
  const layers = new Map<number, Promise<Layer | null>>();
  const layer = (i: number): Promise<Layer | null> => {
    let p = layers.get(i);
    if (!p) {
      p = new Promise<Layer | null>((resolve) => {
        const frame = el("div", "fk-unfurl-frame");
        const img = el("img", "fk-unfurl-img", { alt: "", decoding: "async", draggable: "false" });
        frame.append(img);
        img.src = srcs[i].src;
        const done = () => resolve({ i, frame, img, aspect: img.naturalWidth / Math.max(1, img.naturalHeight) || 1.5, rest: { x: 0, y: 0, w: 1, h: 1 } });
        const wait = typeof img.decode === "function" ? img.decode() : new Promise<void>((r, j) => { img.onload = () => r(); img.onerror = j; });
        wait.then(done, () => (img.complete && img.naturalWidth ? done() : resolve(null)));
      });
      layers.set(i, p);
    }
    return p;
  };
  const place = (l: Layer) => {
    l.rest = containBox(l.aspect, area);
    const s = l.frame.style;
    s.left = `${l.rest.x}px`; s.top = `${l.rest.y}px`; s.width = `${l.rest.w}px`; s.height = `${l.rest.h}px`;
    s.borderRadius = `${ctx.rOpen}px`;
  };
  const attach = (l: Layer, hidden: boolean) => {
    if (!l.frame.isConnected) host.append(l.frame);
    place(l);
    l.frame.style.visibility = hidden ? "hidden" : "";
  };
  // Load, decode and attach (hidden) the neighbours of photo i, so a swipe shows them at once.
  const near = new Map<number, Layer>();
  const prefetch = (i: number) => {
    const { prev, next } = neighbours(i, srcs.length, ctx.loop);
    for (const j of [next, prev]) if (j !== null) void layer(j).then((l) => {
      if (!l || dead || !cur) return;
      const { prev: p, next: n } = neighbours(cur.i, srcs.length, ctx.loop);
      if (j !== p && j !== n) return;
      near.set(j, l);
      if (!l.frame.isConnected) attach(l, true);
    });
    // Drop layers that are no longer beside the current photo (they stay cached, off the page).
    for (const [j, l] of near) {
      const { prev: p, next: n } = neighbours(i, srcs.length, ctx.loop);
      if (j !== p && j !== n && l !== cur) { l.frame.remove(); near.delete(j); }
    }
  };

  // ---------- Painting ----------
  const paint = (l: Layer, box: Box, r: number, dx: number) => {
    const f = flipFrame(box, l.rest);
    l.frame.style.transform = `translate3d(${f.tx + dx}px, ${f.ty}px, 0) scale(${f.sx}, ${f.sy})`;
    l.img.style.transform = `scale(${f.ix}, ${f.iy})`;
    // The radius is divided back out of the scale so the corners stay round.
    l.frame.style.borderRadius = `${r / f.sx}px / ${r / f.sy}px`;
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
    l.frame.style.borderRadius = `${ctx.rOpen}px`;
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
    paint(l, sp.box, radiusAt(sp.closing, sp.box, sp.target, ctx.rSpot, ctx.rOpen), strip.x);
    paintNeighbours();
    if (moving) { raf = requestAnimationFrame(frame); return; }
    raf = 0; last = 0;
    if (!sp.closing) rest(l);
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

  return {
    kind: "css",
    async open(i, from, started) {
      area = ctx.area();
      const t = ++token;
      const l = await layer(i);
      if (!l || dead || t !== token) return !!l;
      attach(l, false);
      cur = l;
      started?.();
      if (ctx.still || !from) {
        await fade(l.frame, [{ opacity: 0, transform: ctx.still ? "none" : "scale(.96)" }, { opacity: 1, transform: "none" }], ctx.still ? FADE_MS : 220);
        l.frame.getAnimations?.().forEach((a) => a.cancel());
      } else {
        sp.box = { ...from }; sp.vel = [0, 0, 0, 0]; sp.target = l.rest; sp.closing = false; springing = true;
        paint(l, sp.box, ctx.rSpot, 0);
        await run();
      }
      prefetch(i);
      return true;
    },
    rect() { return cur ? { ...cur.rest } : null; },
    async show(i, dir, plain) {
      const t = ++token;
      const l = await layer(i);
      if (dead) return true;
      if (!l) return false;
      if (t !== token) return true;
      const old = cur;
      const moved = !!old && !atRest();
      attach(l, false);
      near.delete(i);
      cur = l;
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
      prefetch(i);
      return true;
    },
    async close(to) {
      const l = cur;
      token++;
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
          const old = cur;
          rest(old);
          near.delete(j);
          near.set(old.i, old);
          cur = l;
          l.frame.style.visibility = "";
          sp.box = { ...l.rest }; sp.target = l.rest; sp.vel = [0, 0, 0, 0]; springing = false;
          strip.x += dir * pitch();
        }
      }
      await run();
      if (cur) prefetch(cur.i);
    },
    resize() {
      // Spring from where the photo is now to its new place, so a toolbar showing or hiding never makes it jump.
      area = ctx.area();
      const l = cur;
      for (const [, n] of near) if (n !== l) place(n);
      if (!l) return;
      const from = held || raf ? { ...sp.box } : { ...l.rest };
      place(l);
      sp.target = l.rest;
      if (held) return;
      sp.box = ctx.still ? { ...l.rest } : from;
      springing = true;
      paint(l, sp.box, ctx.rOpen, strip.x);
      void run();
    },
    destroy() {
      dead = true;
      cancelAnimationFrame(raf);
      const w = waiters; waiters = []; w.forEach((f) => f());
      host.replaceChildren();
    },
  };
}
