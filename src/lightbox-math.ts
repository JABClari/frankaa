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
export const SPRING_OPEN: SpringCfg = { stiffness: 320, damping: 32 };
export const SPRING_CLOSE: SpringCfg = { stiffness: 380, damping: 36 };

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

/** What a finished pointer gesture means: a sideways swipe moves, a pull down closes, a still tap is a tap. */
export type Swipe = "next" | "prev" | "close" | "tap" | null;
export function swipeIntent(dx: number, dy: number, ms: number): Swipe {
  const dt = Math.max(1, ms);
  if (Math.abs(dx) > Math.abs(dy) && (Math.abs(dx) > 48 || Math.abs(dx) / dt > 0.4)) return dx < 0 ? "next" : "prev";
  if (dy > 80 || (dy > 24 && dy / dt > 0.5)) return "close";
  if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return "tap";
  return null;
}

/** A rect is usable as a spot to spring from or back to: big enough and at least partly on screen. */
export function onScreen(r: { left: number; top: number; width: number; height: number }, vw: number, vh: number): boolean {
  return r.width > 4 && r.height > 4 && r.left + r.width > 0 && r.top + r.height > 0 && r.left < vw && r.top < vh;
}
