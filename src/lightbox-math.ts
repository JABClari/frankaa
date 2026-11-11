// Pure helpers for the lightbox (unfurl): boxes, the spring, the ease and the swipe rule.
// No DOM here, so they run under node --test.

export type Box = { x: number; y: number; w: number; h: number };

/** A box of this aspect ratio (w / h) fitted inside the area, centred. */
export function containBox(aspect: number, area: Box): Box {
  const a = aspect > 0 && Number.isFinite(aspect) ? aspect : 1.5;
  let w = area.w, h = w / a;
  if (h > area.h) { h = area.h; w = h * a; }
  return { x: area.x + (area.w - w) / 2, y: area.y + (area.h - h) / 2, w, h };
}

/** Where the open photo may sit: the viewport less room for the controls (more on a wide screen). */
export function stageBox(vw: number, vh: number): Box {
  const wide = vw >= 720;
  const side = wide ? 88 : 12, top = wide ? 72 : 64, bottom = wide ? 88 : 96;
  return { x: side, y: top, w: Math.max(1, vw - side * 2), h: Math.max(1, vh - top - bottom) };
}

export type SpringCfg = { stiffness: number; damping: number };
// Critically damped (damping = 2 * sqrt(stiffness)): it lands without a bounce, since a button or key applies no
// force. 95% of the way in about 250 ms (open) and 220 ms (close): the exit is quicker than the entrance.
export const SPRING_OPEN: SpringCfg = { stiffness: 380, damping: 39 };
export const SPRING_CLOSE: SpringCfg = { stiffness: 520, damping: 46 };

/** One spring step for one value (semi-implicit Euler). Returns the new value and speed. */
export function springStep(x: number, v: number, target: number, dt: number, c: SpringCfg): [number, number] {
  const a = -c.stiffness * (x - target) - c.damping * v;
  const nv = v + a * dt;
  return [x + nv * dt, nv];
}

/** Settled: close enough and slow enough that the next frame would not show. */
export const settled = (x: number, v: number, target: number): boolean => Math.abs(x - target) < 0.25 && Math.abs(v) < 2;

/** A strong ease-in-out (cubic), as a function of 0 to 1. */
export function easeInOut(t: number): number {
  const u = Math.min(1, Math.max(0, t));
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
}

/**
 * What a finished pointer gesture means, from its distance (px) and release velocity (px/s): a sideways swipe or
 * flick moves, a pull or flick down closes, a still tap is a tap, anything else springs back (null).
 * A flick counts even when short, and a drag released while moving back toward the start does not.
 */
export type Swipe = "next" | "prev" | "close" | "tap" | null;
export function swipeIntent(dx: number, dy: number, vx = 0, vy = 0): Swipe {
  if (Math.abs(dx) < 6 && Math.abs(dy) < 6 && Math.hypot(vx, vy) < 200) return "tap";
  if (Math.abs(dx) > Math.abs(dy)) {
    const back = vx * dx < 0 && Math.abs(vx) > 200;
    if (!back && (Math.abs(dx) > 48 || (Math.abs(dx) > 12 && Math.abs(vx) > 400))) return dx < 0 ? "next" : "prev";
    return null;
  }
  const back = vy < -200;
  if (!back && (dy > 96 || (dy > 24 && vy > 500))) return "close";
  return null;
}

/** A rect is usable as a spot to spring from or back to: big enough and at least partly on screen. */
export function onScreen(r: { left: number; top: number; width: number; height: number }, vw: number, vh: number): boolean {
  return r.width > 4 && r.height > 4 && r.left + r.width > 0 && r.top + r.height > 0 && r.left < vw && r.top < vh;
}

/** Spring all four sides of a box toward a target, in sub-steps of at most 1/120 s. Returns true while moving. */
export function stepBox(box: Box, vel: number[], target: Box, dt: number, cfg: SpringCfg): boolean {
  const steps = Math.max(1, Math.ceil(dt * 120)), h = dt / steps;
  let moving = false;
  (["x", "y", "w", "h"] as const).forEach((k, j) => {
    let x = box[k], v = vel[j];
    for (let s = 0; s < steps; s++) [x, v] = springStep(x, v, target[k], h, cfg);
    box[k] = x; vel[j] = v;
    if (!settled(x, v, target[k])) moving = true;
  });
  return moving;
}

/** Corner radii, top left, top right, bottom right, bottom left (CSS order). */
export type R4 = [number, number, number, number];
/** One radius for every corner, or four. */
export type Radius = number | R4;
export const toR4 = (r: Radius | undefined, fallback: number): R4 => (Array.isArray(r) ? [r[0], r[1], r[2], r[3]] : [r ?? fallback, r ?? fallback, r ?? fallback, r ?? fallback]);

/** The corner radii on the way: they follow how far the box still has to go (open: spot radii to open radii). */
export function radiusAt(closing: boolean, box: Box, target: Box, rSpot: R4, rOpen: R4): R4 {
  const left = Math.min(1, Math.abs(box.w - target.w) / Math.max(1, target.w));
  const k = closing ? 1 - left : left;
  return rOpen.map((o, j) => o + (rSpot[j] - o) * k) as R4;
}

/**
 * The CSS renderer's FLIP frame: a layer laid out at `rest` drawn as `box`. The layer moves and scales (origin top
 * left) and its photo scales back (origin centre) so it stays undistorted and covers the box.
 */
export function flipFrame(box: Box, rest: Box): { tx: number; ty: number; sx: number; sy: number; ix: number; iy: number } {
  const sx = box.w / Math.max(1, rest.w), sy = box.h / Math.max(1, rest.h);
  const c = Math.max(sx, sy);
  return { tx: box.x - rest.x, ty: box.y - rest.y, sx, sy, ix: c / sx, iy: c / sy };
}

export type RendererPref = "webgl" | "css" | "auto";
/** Which renderer to use: css when asked or when WebGL is missing, else WebGL. */
export function pickRenderer(pref: RendererPref | undefined, webgl: boolean): "webgl" | "css" {
  return pref === "css" || !webgl ? "css" : "webgl";
}

/** What both renderers share with the lightbox. */
export type StageCtx = { still: boolean; rSpot: (i: number) => R4; rOpen: R4; duration: number; area: () => Box; count: number; loop: boolean };
export type Stage = {
  kind: "webgl" | "css";
  /** Show photo i, springing from `from` (or fading in); `started` runs on its first frame. Resolves false when it cannot be shown. */
  open(i: number, from: Box | null, started?: () => void): Promise<boolean>;
  /** Move to photo i. plain: a short crossfade instead of the effect (used when a video is involved). Resolves
   *  false when it cannot be shown. */
  show(i: number, dir: 1 | -1, plain?: boolean): Promise<boolean>;
  /** Where the current photo rests when open (for laying a video player over it). */
  rect(): Box | null;
  /** Where the current photo is drawn now. */
  current(): Box | null;
  /** Zoom and pan, while fingers are down: draw the current photo at this box, 1:1, no spring. */
  place(box: Box): void;
  /** Zoom and pan, after release: spring the current photo to this box, carrying velocity v (px/s). */
  glide(box: Box, v: { vx: number; vy: number }): Promise<void>;
  /** Spring back to `to` (or fade out). */
  close(to: Box | null): Promise<void>;
  /** While a finger is down: draw the photo at its open box moved by x, y and scaled by s, 1:1, no spring. */
  track(o: { x: number; y: number; s: number }): void;
  /** The finger lifted: hand the photo to the spring, seeded with the release velocity (px/s). */
  release(v: { vx: number; vy: number }): void;
  /** While a finger drags sideways: the strip of photos sits x px off centre, the neighbours peeking in. */
  pan(x: number): void;
  /** The finger lifted after a sideways drag: dir 1 or -1 makes the next or previous photo current, 0 stays; the
   *  strip springs home carrying the release velocity vx (px/s). */
  settle(dir: -1 | 0 | 1, vx: number): Promise<void>;
  resize(): void;
  destroy(): void;
};

/** The open box moved by a drag offset and scaled about its centre. */
export function draggedBox(rest: Box, o: { x: number; y: number; s: number }): Box {
  const w = rest.w * o.s, h = rest.h * o.s;
  return { x: rest.x + o.x + (rest.w - w) / 2, y: rest.y + o.y + (rest.h - h) / 2, w, h };
}

/** The space between photos in the swipe strip, in CSS px. */
export const STRIP_GAP = 16;

/** The photo before and after i, or null at the ends (unless loop). */
export function neighbours(i: number, n: number, loop: boolean): { prev: number | null; next: number | null } {
  if (n < 2) return { prev: null, next: null };
  return {
    prev: i > 0 ? i - 1 : loop ? n - 1 : null,
    next: i < n - 1 ? i + 1 : loop ? 0 : null,
  };
}

/** Where a fling would come to rest: the distance a release velocity (px/s) carries with iOS-like deceleration. */
export function project(v: number, decel = 0.998): number {
  return ((v / 1000) * decel) / (1 - decel);
}

/**
 * Which photo a sideways release lands on: project the strip's final offset from where it is (x) and how fast it
 * moves (vx), then take the nearest photo. 1 is the next photo, -1 the previous, 0 stays.
 */
export function pickSlide(x: number, vx: number, pitch: number, canPrev: boolean, canNext: boolean): -1 | 0 | 1 {
  const end = x + project(vx);
  if (end < -pitch / 2 && canNext) return 1;
  if (end > pitch / 2 && canPrev) return -1;
  return 0;
}

/**
 * Lock a drag to one axis once it has moved `slop` px. It is vertical only when clearly steeper than 56 degrees,
 * so a slightly diagonal sideways swipe never turns into a pull to close.
 */
export function lockAxis(dx: number, dy: number, slop = 10): "x" | "y" | null {
  if (Math.hypot(dx, dy) < slop) return null;
  return Math.abs(dy) > Math.abs(dx) * 1.5 ? "y" : "x";
}

/** A one-dimensional spring step for the strip (the same spring as opening). Returns the new value and speed. */
export function stripStep(x: number, v: number, dt: number): [number, number] {
  const steps = Math.max(1, Math.ceil(dt * 120)), h = dt / steps;
  for (let s = 0; s < steps; s++) [x, v] = springStep(x, v, 0, h, SPRING_OPEN);
  return [x, v];
}

/** A box scaled by s about the point m0 (in the box's coordinates at scale 1), then moved so m0 sits under m. */
export function zoomAbout(box0: Box, s: number, m0: { x: number; y: number }, m: { x: number; y: number }): Box {
  return { x: m.x - (m0.x - box0.x) * s, y: m.y - (m0.y - box0.y) * s, w: box0.w * s, h: box0.h * s };
}

/** Is the photo zoomed in past its open size? */
export const isZoomed = (box: Box | null, rest: Box | null): boolean => !!box && !!rest && box.w > rest.w * 1.01;

/**
 * Keep a zoomed photo covering the view: along an axis where it is bigger than the view, its edges may not come
 * inside the view's edges; where it is smaller, it centres on its open box.
 */
export function clampPan(box: Box, rest: Box, view: Box): Box {
  const axis = (p: number, size: number, vp: number, vs: number, rp: number, rs: number) =>
    size > vs ? Math.min(vp, Math.max(vp + vs - size, p)) : rp + (rs - size) / 2;
  return { x: axis(box.x, box.w, view.x, view.w, rest.x, rest.w), y: axis(box.y, box.h, view.y, view.h, rest.y, rest.h), w: box.w, h: box.h };
}

/** Where a zoom gesture settles: never smaller than the open box, never past max times it, about its centre. */
export function settleZoom(box: Box, rest: Box, max: number, view: Box): Box {
  const s = box.w / rest.w;
  if (s <= 1.01) return { ...rest };
  if (s > max) {
    const k = max / s, cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    box = { x: cx - (box.w * k) / 2, y: cy - (box.h * k) / 2, w: box.w * k, h: box.h * k };
  }
  return clampPan(box, rest, view);
}
