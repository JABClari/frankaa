// Pure helpers for drumline: the strip's layout as pictures grow, the ticks' lift, the wheel and the numbers.
// No DOM here, so they run under node --test.
// Functions starting with "worklet" also run on the UI thread in frankaa/native (Reanimated); the web build strips it.
import { project } from "./lightbox-math.ts";

/** How much a picture d steps from the focus grows or lifts: 1 at the focus, easing to 0 by `reach` steps away. */
export function bump(d: number, reach = 1): number {
  "worklet";
  const t = Math.max(0, 1 - Math.abs(d) / Math.max(0.001, reach));
  return t * t * (3 - 2 * t);
}

/**
 * Centres of the pictures along the strip when picture i is scaled by s[i]: each keeps `gap` px from its
 * neighbours at its scaled width, so a growing picture pushes the others aside instead of covering them.
 */
export function centres(scales: number[], width: number, gap: number): number[] {
  "worklet";
  const c: number[] = [];
  let x = 0;
  for (let i = 0; i < scales.length; i++) {
    const w = width * scales[i];
    if (i === 0) x = w / 2;
    else x += (width * scales[i - 1]) / 2 + gap + w / 2;
    c.push(x);
  }
  return c;
}

/** The strip position at fractional index pos (between two centres). */
export function centreAt(c: number[], pos: number): number {
  "worklet";
  if (!c.length) return 0;
  const p = Math.min(c.length - 1, Math.max(0, pos));
  const i = Math.floor(p), f = p - i;
  return i >= c.length - 1 ? c[c.length - 1] : c[i] + (c[i + 1] - c[i]) * f;
}

/** Scales for every picture with the focus at pos: grow at the focus, 1 far away. */
export function scalesAt(n: number, pos: number, grow: number, reach = 1): number[] {
  "worklet";
  const s: number[] = [];
  for (let i = 0; i < n; i++) s.push(1 + (grow - 1) * bump(i - pos, reach));
  return s;
}

/**
 * Where every picture sits with the focus at pos centred in a viewport vw wide: its left edge x (px, before its
 * scale, which is about its centre) and its scale. Past the first or last picture the strip moves on 1:1.
 */
export function stripLayout(n: number, pos: number, grow: number, width: number, gap: number, vw: number): { x: number[]; s: number[] } {
  "worklet";
  const s = scalesAt(n, pos, grow);
  const c = centres(s, width, gap);
  const pitch = width + gap;
  const off = vw / 2 - centreAt(c, pos) - (pos < 0 ? pos * pitch : pos > n - 1 ? (pos - (n - 1)) * pitch : 0);
  const x: number[] = [];
  for (let i = 0; i < n; i++) x.push(off + c[i] - width / 2);
  return { x, s };
}

/**
 * How much tick j of a ruler of t ticks lifts (0 to 1) with the focus at pos among n pictures: the ruler spans the
 * pictures, and the ticks within about three ticks of the focus lift. Without feedback only the focus tick does.
 */
export function tickLift(j: number, t: number, n: number, pos: number, feedback = true): number {
  "worklet";
  const step = t > 1 && n > 1 ? (n - 1) / (t - 1) : 1;
  const d = j * step - pos;
  if (!feedback) return j === Math.round(pos / step) ? 1 : 0;
  return bump(d, 3 * step);
}

/** How quickly "lerp" eases toward its target (per second): while held, after a drag or wheel (a slow glide out),
 *  and after a jump from the keys, the ruler, a tap or code. */
export const LERP_RATE = { held: 16, glide: 4.6, jump: 10 } as const;

/** One "lerp" frame: x eases toward target, frame-rate independent (dt in seconds, k from LERP_RATE). */
export function lerpStep(x: number, target: number, dt: number, k: number): number {
  "worklet";
  return x + (target - x) * (1 - Math.exp(-dt * k));
}

/**
 * Where the strip comes to rest after a drag released at from (a fractional index) with velocity vx (px/s): the
 * flick is projected on (inertia), then snapped to the nearest picture (snap), within the strip.
 */
export function releaseTarget(from: number, vx: number, pitch: number, n: number, inertia = true, snap = true): number {
  "worklet";
  const end = from + (inertia ? -project(vx) : 0) / Math.max(1, pitch);
  const max = Math.max(0, n - 1);
  return Math.min(max, Math.max(0, snap ? Math.round(end) : end));
}

/** Which wheel delta moves the strip: the larger axis ("both"), only one axis, or none. Lines and pages count as px. */
export function wheelDelta(dx: number, dy: number, mode: number, axis: "both" | "x" | "y" | false): number {
  const k = mode === 1 ? 16 : mode === 2 ? 400 : 1;
  if (axis === false) return 0;
  if (axis === "x") return dx * k;
  if (axis === "y") return dy * k;
  return (Math.abs(dx) > Math.abs(dy) ? dx : dy) * k;
}

/** Rubber-band a fractional position past the first or last picture. */
export function bandPos(pos: number, n: number, k = 0.35): number {
  "worklet";
  const max = Math.max(0, n - 1);
  if (pos < 0) return -(1 - 1 / (1 + (-pos * k))) / k * 0.6;
  if (pos > max) return max + ((1 - 1 / (1 + (pos - max) * k)) / k) * 0.6;
  return pos;
}

/** A number for the readout, padded ("07"). */
export const pad = (n: number, width: number): string => String(n).padStart(width, "0");

/** The readout around picture i: the number before, the current one (framed), the one after; null past the ends. */
export function readout(i: number, n: number): { prev: number | null; cur: number; next: number | null } {
  return { prev: i > 0 ? i : null, cur: i + 1, next: i < n - 1 ? i + 2 : null };
}

/** The tick under x px along a ruler of n ticks spread over width px (fractional). */
export function tickAt(x: number, width: number, n: number): number {
  "worklet";
  if (n < 2 || width <= 0) return 0;
  return Math.min(n - 1, Math.max(0, (x / width) * (n - 1)));
}

export type DrumlinePreset = "ruler" | "numbers" | "minimal";
export type DrumlineFluid = "off" | "lerp" | "chain" | "bend";

/** Everything a preset sets; every one can also be set on its own. */
export type DrumlineLook = {
  /** The ruler of ticks. */
  ticks?: boolean;
  /** Hovering the ruler with a mouse runs through the pictures (dragging on it always does). */
  rulerHover?: boolean;
  /** "frame" ("28 [29] 30"), "fraction" ("29 / 30") or false. */
  numbers?: "frame" | "fraction" | false;
  /** Ticks near the focus lift and brighten; cards away from it dim a little. */
  focusFeedback?: boolean;
  /** Pictures away from the focus lose a little colour and light (lightly). */
  colorFocus?: boolean;
  /** How much the picture in focus grows (1 = not at all). */
  grow?: number;
  /** How the strip moves: "off", "lerp", "chain" or "bend". */
  fluid?: DrumlineFluid;
  /** "stories" (tall rounded cards) or "bars" (narrow tall bars). Size them with --fk-dl-w and --fk-dl-h. */
  look?: "stories" | "bars";
};

export const DRUMLINE_PRESETS: Record<DrumlinePreset, Required<DrumlineLook>> = {
  ruler: { ticks: true, rulerHover: true, numbers: false, focusFeedback: true, colorFocus: true, grow: 1.55, fluid: "bend", look: "stories" },
  numbers: { ticks: true, rulerHover: true, numbers: "frame", focusFeedback: true, colorFocus: false, grow: 1.3, fluid: "chain", look: "bars" },
  minimal: { ticks: false, rulerHover: false, numbers: "fraction", focusFeedback: false, colorFocus: false, grow: 1.18, fluid: "lerp", look: "stories" },
};

/** Resolve a preset and options into the final look (options win). */
export function drumlineLook(o: DrumlineLook & { preset?: DrumlinePreset }): Required<DrumlineLook> {
  const base = DRUMLINE_PRESETS[o.preset ?? "ruler"] ?? DRUMLINE_PRESETS.ruler;
  const out = { ...base } as Required<DrumlineLook>;
  for (const k of Object.keys(base) as (keyof DrumlineLook)[]) if (o[k] !== undefined) (out as Record<string, unknown>)[k] = o[k];
  return out;
}


/** What unfurl's strip option means: true or "drumline" is the ruler preset, a name is that preset, an object is
 *  drumline options as given; false or nothing is no strip. */
export function stripOptions<O extends { preset?: DrumlinePreset }>(strip: boolean | "drumline" | DrumlinePreset | O | undefined | null): O | { preset: DrumlinePreset } | null {
  if (!strip) return null;
  if (strip === true || strip === "drumline") return { preset: "ruler" };
  if (typeof strip === "string") return DRUMLINE_PRESETS[strip] ? { preset: strip } : { preset: "ruler" };
  return strip;
}

/** The strip's labels: the default English strings. */
export type DrumlineLabels = {
  /** The strip's name. Default "Pictures". */
  region: string;
  /** Read out on each change, and each card's name. {n}, {total}. Default "Picture {n} of {total}". */
  position: string;
};
export const DRUMLINE_LABELS: DrumlineLabels = { region: "Pictures", position: "Picture {n} of {total}" };
