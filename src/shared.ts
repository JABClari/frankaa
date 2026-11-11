// Pure helpers shared by both parts. No DOM here, so they run under node --test.

/** Fill a label template: "Photo {n} of {total}" with { n: 2, total: 5 } gives "Photo 2 of 5". Unknown keys stay. */
export function fill(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (all, k: string) => (k in vars ? String(vars[k]) : all));
}

export type ReducedMotion = "system" | "always" | "never";

/** Whether to reduce motion: "always" and "never" win; "system" follows the person's setting. */
export function resolveReduced(pref: ReducedMotion | undefined, systemReduces: boolean): boolean {
  if (pref === "always") return true;
  if (pref === "never") return false;
  return systemReduces;
}

/** The index one step away, wrapping when loop is on; null when there is nowhere to go. */
export function nextIndex(i: number, d: number, n: number, loop: boolean): number | null {
  if (n < 2) return null;
  const t = i + d;
  if (t >= 0 && t < n) return t;
  return loop ? ((t % n) + n) % n : null;
}

/** Hook name to event name: "onOpenStart" becomes "frankaa:open-start". */
export function eventName(hook: string): string {
  return "frankaa:" + hook.replace(/^on/, "").replace(/[A-Z]/g, (c, i: number) => (i ? "-" : "") + c.toLowerCase());
}

/** True when the URL points at another origin than the page (WebGL then needs CORS headers on it). */
export function isCrossOrigin(src: string, base: string): boolean {
  try {
    const u = new URL(src, base);
    if (u.protocol === "data:" || u.protocol === "blob:") return false;
    return u.origin !== new URL(base).origin;
  } catch {
    return false;
  }
}

export type LightboxKeyAction = "next" | "prev" | "first" | "last" | "close";
/** What a key does in the lightbox. Arrows move, Home and End jump, Escape closes. Others pass through. */
export function lightboxKey(key: string): LightboxKeyAction | null {
  switch (key) {
    case "ArrowRight": return "next";
    case "ArrowLeft": return "prev";
    case "Home": return "first";
    case "End": return "last";
    case "Escape": case "Esc": return "close";
    default: return null;
  }
}

export type SliderKeyAction = "next" | "prev" | "first" | "last" | "select";
/** What a key does on the focused slider track. In right-to-left text the arrows swap. */
export function sliderKey(key: string, rtl = false): SliderKeyAction | null {
  if (key === "ArrowRight") return rtl ? "prev" : "next";
  if (key === "ArrowLeft") return rtl ? "next" : "prev";
  if (key === "Home") return "first";
  if (key === "End") return "last";
  if (key === "Enter") return "select";
  return null;
}

/** Velocity in px/s from recent pointer samples (the last ~100 ms), for seeding the settle spring. */
export function velocity(samples: { x: number; y: number; t: number }[]): { vx: number; vy: number } {
  if (samples.length < 2) return { vx: 0, vy: 0 };
  const last = samples[samples.length - 1];
  let first = samples[0];
  for (const s of samples) if (last.t - s.t <= 100) { first = s; break; }
  const dt = (last.t - first.t) / 1000;
  if (dt <= 0) return { vx: 0, vy: 0 };
  return { vx: (last.x - first.x) / dt, vy: (last.y - first.y) / dt };
}

/** Rubber-band: past a limit, a drag moves only a fraction of the distance (Apple-style resistance). */
export function rubber(d: number, limit: number, k = 0.55): number {
  if (d <= 0 || limit <= 0) return d <= 0 ? 0 : d;
  return (1 - 1 / ((d * k) / limit + 1)) * limit;
}
