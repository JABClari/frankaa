// The CSS renderer: no WebGL. Each photo is a layer laid out at its open size; a spring moves it with transform
// only (FLIP: the layer moves and scales, its photo scales back so it stays undistorted), and photos crossfade
// with opacity. will-change is set only while something moves.
import { containBox, flipFrame, radiusAt, stepBox, SPRING_CLOSE, SPRING_OPEN, type Box, type Stage, type StageCtx } from "./lightbox-math";
import type { CssTransition } from "./effects";
import { el } from "./dom";

const FADE_MS = 160;
const EASE = "cubic-bezier(.23, 1, .32, 1)";

type Layer = { frame: HTMLDivElement; img: HTMLImageElement; rest: Box; aspect: number };

export function createCssStage(host: HTMLElement, srcs: { src: string; alt?: string }[], transition: CssTransition, ctx: StageCtx): Stage {
  let cur: Layer | null = null;
  let token = 0;
  let raf = 0;
  let dead = false;

  const load = (i: number): Promise<Layer | null> => new Promise((resolve) => {
    const frame = el("div", "fk-unfurl-frame");
    const img = el("img", "fk-unfurl-img", { alt: "", decoding: "async", draggable: "false" });
    frame.append(img);
    const done = () => {
      const aspect = img.naturalWidth / Math.max(1, img.naturalHeight) || 1.5;
      resolve({ frame, img, aspect, rest: { x: 0, y: 0, w: 1, h: 1 } });
    };
    img.onload = done;
    img.onerror = () => resolve(null);
    img.src = srcs[i].src;
    if (img.complete && img.naturalWidth) done();
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
    l.frame.style.borderRadius = `${r / f.sx}px / ${r / f.sy}px`;
  };
  const rest = (l: Layer) => {
    l.frame.style.transform = l.img.style.transform = l.frame.style.willChange = l.img.style.willChange = "";
    l.frame.style.borderRadius = `${ctx.rOpen}px`;
  };

  // A spring from one box to another, transform only.
  const spring = (l: Layer, from: Box, to: Box, closing: boolean) => new Promise<void>((resolve) => {
    const box = { ...from }, vel = [0, 0, 0, 0];
    l.frame.style.willChange = l.img.style.willChange = "transform";
    let last = 0;
    const tick = (now: number) => {
      if (dead) { resolve(); return; }
      const dt = Math.min(1 / 15, last ? (now - last) / 1000 : 1 / 60);
      last = now;
      const moving = stepBox(box, vel, to, dt, closing ? SPRING_CLOSE : SPRING_OPEN);
      paint(l, box, radiusAt(closing, box, to, ctx.rSpot, ctx.rOpen));
      if (moving) raf = requestAnimationFrame(tick);
      else { raf = 0; resolve(); }
    };
    paint(l, box, ctx.rSpot);
    raf = requestAnimationFrame(tick);
  });

  const animate = (node: HTMLElement, frames: Keyframe[], ms: number) => new Promise<void>((resolve) => {
    if (typeof node.animate !== "function" || ms <= 0) { resolve(); return; }
    node.style.willChange = "transform, opacity";
    const a = node.animate(frames, { duration: ms, easing: EASE, fill: "both" });
    a.onfinish = a.oncancel = () => { node.style.willChange = ""; resolve(); };
  });

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
      if (ctx.still || !from) await animate(l.frame, [{ opacity: 0, transform: ctx.still ? "none" : "scale(.96)" }, { opacity: 1, transform: "none" }], ctx.still ? FADE_MS : 220);
      else await spring(l, from, l.rest, false);
      rest(l);
      return true;
    },
    async show(i, dir) {
      const t = ++token;
      const l = await load(i);
      if (dead) return true;
      if (!l) return false;
      if (t !== token) return true;
      const old = cur;
      host.append(l.frame);
      place(l);
      cur = l;
      const kind = ctx.still ? "fade" : transition;
      const ms = ctx.still ? FADE_MS : ctx.duration;
      if (kind === "none" || ms <= 0) { old?.frame.remove(); return true; }
      const x = `${dir * 6}%`;
      const inFrom = kind === "slide" ? `translate3d(${x}, 0, 0)` : kind === "zoom" ? "scale(1.06)" : "none";
      const outTo = kind === "slide" ? `translate3d(${-dir * 6}%, 0, 0)` : kind === "zoom" ? "scale(.97)" : "none";
      await Promise.all([
        animate(l.frame, [{ opacity: 0, transform: inFrom }, { opacity: 1, transform: "none" }], ms),
        old ? animate(old.frame, [{ opacity: 1, transform: "none" }, { opacity: 0, transform: outTo }], ms) : Promise.resolve(),
      ]);
      old?.frame.remove();
      l.frame.getAnimations?.().forEach((a) => a.cancel());
      return true;
    },
    async close(to) {
      const l = cur;
      token++;
      if (!l) return;
      if (ctx.still || !to) await animate(l.frame, [{ opacity: 1, transform: "none" }, { opacity: 0, transform: ctx.still ? "none" : "scale(.94)" }], FADE_MS);
      else await spring(l, l.rest, to, true);
    },
    resize() { if (cur) place(cur); },
    destroy() {
      dead = true;
      cancelAnimationFrame(raf);
      host.replaceChildren();
    },
  };
}
