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
