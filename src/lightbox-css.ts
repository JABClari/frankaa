// The CSS renderer: no WebGL. Each photo is a layer laid out at its open size; one spring moves the current layer
// with transform only (FLIP: the layer moves and scales, its photo scales back so it stays undistorted), and photos
// crossfade with opacity. will-change is set only while something moves. A finger can catch the photo at any time;
// on release the spring carries on from the finger's velocity.
import { containBox, draggedBox, flipFrame, radiusAt, stepBox, SPRING_CLOSE, SPRING_OPEN, type Box, type Stage, type StageCtx } from "./lightbox-math";
import type { CssTransition } from "./effects";
import { el } from "./dom";

const FADE_MS = 160;
const UI_MAX_MS = 300;
const EASE_OUT = "cubic-bezier(.23, 1, .32, 1)";

type Layer = { frame: HTMLDivElement; img: HTMLImageElement; rest: Box; aspect: number };

export function createCssStage(host: HTMLElement, srcs: { src: string; alt?: string }[], transition: CssTransition, ctx: StageCtx): Stage {
  let cur: Layer | null = null;
  let token = 0;
  let dead = false;

  // ---------- Layers ----------
  const load = (i: number): Promise<Layer | null> => new Promise((resolve) => {
    const frame = el("div", "fk-unfurl-frame");
    const img = el("img", "fk-unfurl-img", { alt: "", decoding: "async", draggable: "false" });
    frame.append(img);
    let done = false;
    const ok = () => {
      if (done) return;
      done = true;
      const aspect = img.naturalWidth / Math.max(1, img.naturalHeight) || 1.5;
      resolve({ frame, img, aspect, rest: { x: 0, y: 0, w: 1, h: 1 } });
    };
    img.onload = ok;
    img.onerror = () => { if (!done) { done = true; resolve(null); } };
    img.src = srcs[i].src;
    if (img.complete && img.naturalWidth) ok();
  });
  const place = (l: Layer) => {
    l.rest = containBox(l.aspect, ctx.area());
    const s = l.frame.style;
    s.left = `${l.rest.x}px`; s.top = `${l.rest.y}px`; s.width = `${l.rest.w}px`; s.height = `${l.rest.h}px`;
    s.borderRadius = `${ctx.rOpen}px`;
  };
  const paint = (l: Layer, box: Box, r: number) => {
    const f = flipFrame(box, l.rest);
    l.frame.style.transform = `translate3d(${f.tx}px, ${f.ty}px, 0) scale(${f.sx}, ${f.sy})`;
    l.img.style.transform = `scale(${f.ix}, ${f.iy})`;
    // The radius is divided back out of the scale so the corners stay round.
    l.frame.style.borderRadius = `${r / f.sx}px / ${r / f.sy}px`;
  };
  const settle = (l: Layer) => {
    l.frame.style.transform = l.img.style.transform = l.frame.style.willChange = l.img.style.willChange = "";
    l.frame.style.borderRadius = `${ctx.rOpen}px`;
  };
  const fade = (node: HTMLElement, frames: Keyframe[], ms: number) => new Promise<void>((resolve) => {
    if (typeof node.animate !== "function" || ms <= 0) { resolve(); return; }
    const a = node.animate(frames, { duration: ms, easing: EASE_OUT, fill: "both" });
    a.onfinish = a.oncancel = () => resolve();
  });

  // ---------- One spring for the current layer ----------
  const sp = { box: { x: 0, y: 0, w: 1, h: 1 } as Box, vel: [0, 0, 0, 0], target: { x: 0, y: 0, w: 1, h: 1 } as Box, closing: false };
  let raf = 0, last = 0, held = false;
  let waiters: (() => void)[] = [];
  const frame = (now: number) => {
    const l = cur;
    if (dead || !l) { raf = 0; return; }
    const dt = Math.min(1 / 15, last ? (now - last) / 1000 : 1 / 60);
    last = now;
    let moving = true;
    if (held) moving = true;
    else if (ctx.still) { sp.box = { ...sp.target }; moving = false; }
    else moving = stepBox(sp.box, sp.vel, sp.target, dt, sp.closing ? SPRING_CLOSE : SPRING_OPEN);
    paint(l, sp.box, radiusAt(sp.closing, sp.box, sp.target, ctx.rSpot, ctx.rOpen));
    if (moving) { raf = requestAnimationFrame(frame); return; }
    raf = 0; last = 0;
    if (!sp.closing) settle(l);
    const w = waiters; waiters = [];
    w.forEach((f) => f());
  };
  const run = () => new Promise<void>((resolve) => {
    if (dead || !cur) { resolve(); return; }
    waiters.push(resolve);
    cur.frame.style.willChange = cur.img.style.willChange = "transform";
    if (!raf) raf = requestAnimationFrame(frame);
  });
  const atRest = () => !raf && !held;

  return {
    kind: "css",
    async open(i, from, started) {
      const t = ++token;
      const l = await load(i);
      if (!l || dead || t !== token) return !!l;
      host.append(l.frame);
      place(l);
      cur = l;
      started?.();
      if (ctx.still || !from) {
        await fade(l.frame, [{ opacity: 0, transform: ctx.still ? "none" : "scale(.96)" }, { opacity: 1, transform: "none" }], ctx.still ? FADE_MS : 220);
        return true;
      }
      sp.box = { ...from }; sp.vel = [0, 0, 0, 0]; sp.target = l.rest; sp.closing = false;
      paint(l, sp.box, ctx.rSpot);
      await run();
      return true;
    },
    async show(i, dir) {
      const t = ++token;
      const l = await load(i);
      if (dead) return true;
      if (!l) return false;
      if (t !== token) return true;
      const old = cur;
      // Was the photo moved by a finger (or still springing)? Then the new photo takes over from where the old one
      // is, with its velocity, and the two crossfade with opacity only.
      const moved = !!old && !atRest();
      host.append(l.frame);
      place(l);
      const ms = ctx.still ? FADE_MS : Math.min(UI_MAX_MS, ctx.duration);
      if (moved && old) {
        const off = { x: sp.box.x - old.rest.x, y: sp.box.y - old.rest.y };
        cur = l;
        sp.box = { x: l.rest.x + off.x, y: l.rest.y + off.y, w: l.rest.w, h: l.rest.h };
        sp.target = l.rest;
        paint(l, sp.box, ctx.rOpen);
        const spring = run();
        await Promise.all([fade(l.frame, [{ opacity: 0 }, { opacity: 1 }], ms), fade(old.frame, [{ opacity: 1 }, { opacity: 0 }], ms), spring]);
        old.frame.remove();
        l.frame.getAnimations?.().forEach((a) => a.cancel());
        return true;
      }
      cur = l;
      const kind = ctx.still ? "fade" : transition;
      if (kind === "none" || ms <= 0) { old?.frame.remove(); return true; }
      const x = `${dir * 4}%`;
      const inFrom = kind === "slide" ? `translate3d(${x}, 0, 0)` : kind === "zoom" ? "scale(1.04)" : "none";
      const outTo = kind === "slide" ? `translate3d(${-dir * 4}%, 0, 0)` : kind === "zoom" ? "scale(.98)" : "none";
      for (const n of [l.frame, old?.frame]) if (n) n.style.willChange = "transform, opacity";
      await Promise.all([
        fade(l.frame, [{ opacity: 0, transform: inFrom }, { opacity: 1, transform: "none" }], ms),
        old ? fade(old.frame, [{ opacity: 1, transform: "none" }, { opacity: 0, transform: outTo }], ms) : Promise.resolve(),
      ]);
      old?.frame.remove();
      l.frame.getAnimations?.().forEach((a) => a.cancel());
      l.frame.style.willChange = "";
      return true;
    },
    async close(to) {
      const l = cur;
      token++;
      held = false;
      if (!l) return;
      if (ctx.still || !to) {
        cancelAnimationFrame(raf); raf = 0;
        await fade(l.frame, [{ opacity: 1 }, { opacity: 0, transform: ctx.still ? l.frame.style.transform || "none" : `${l.frame.style.transform || ""} scale(.94)` }], FADE_MS);
        return;
      }
      sp.target = { ...to }; sp.closing = true;
      await run();
    },
    track(o) {
      const l = cur;
      if (!l || dead) return;
      held = true;
      sp.box = draggedBox(l.rest, o);
      sp.vel = [0, 0, 0, 0];
      l.frame.style.willChange = l.img.style.willChange = "transform";
      if (!raf) paint(l, sp.box, ctx.rOpen);
    },
    release(v) {
      held = false;
      if (!cur) return;
      sp.vel = [v.vx, v.vy, 0, 0];
      sp.target = cur.rest;
      void run();
    },
    resize() { if (cur) { place(cur); sp.target = cur.rest; } },
    destroy() {
      dead = true;
      cancelAnimationFrame(raf);
      const w = waiters; waiters = []; w.forEach((f) => f());
      host.replaceChildren();
    },
  };
}
