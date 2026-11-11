// Pure helpers for the slider (procession). No DOM here, so they run under node --test.

/** The photo a scroll-snap track is showing: its scroll offset over one photo's width, clamped. */
export function indexAt(scroll: number, width: number, count: number): number {
  if (!(width > 0) || count < 1) return 0;
  return Math.min(count - 1, Math.max(0, Math.round(Math.abs(scroll) / width)));
}

/** Clamp a wanted photo index into the list. */
export function clampIndex(i: number, count: number): number {
  if (count < 1 || !Number.isFinite(i)) return 0;
  return Math.min(count - 1, Math.max(0, Math.round(i)));
}
