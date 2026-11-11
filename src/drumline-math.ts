// Pure helpers for drumline: the strip's layout as pictures grow, the ticks' lift, the wheel and the numbers.
// No DOM here, so they run under node --test.

/** How much a picture d steps from the focus grows or lifts: 1 at the focus, easing to 0 by `reach` steps away. */
export function bump(d: number, reach = 1): number {
  const t = Math.max(0, 1 - Math.abs(d) / Math.max(0.001, reach));
  return t * t * (3 - 2 * t);
}

/**
 * Centres of the pictures along the strip when picture i is scaled by s[i]: each keeps `gap` px from its
 * neighbours at its scaled width, so a growing picture pushes the others aside instead of covering them.
 */
export function centres(scales: number[], width: number, gap: number): number[] {
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
  if (!c.length) return 0;
  const p = Math.min(c.length - 1, Math.max(0, pos));
  const i = Math.floor(p), f = p - i;
  return i >= c.length - 1 ? c[c.length - 1] : c[i] + (c[i + 1] - c[i]) * f;
}

/** Scales for every picture with the focus at pos: grow at the focus, 1 far away. */
export function scalesAt(n: number, pos: number, grow: number, reach = 1): number[] {
  const s: number[] = [];
  for (let i = 0; i < n; i++) s.push(1 + (grow - 1) * bump(i - pos, reach));
  return s;
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
