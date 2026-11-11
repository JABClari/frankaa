// Small DOM helpers. No innerHTML anywhere: elements and icons are built node by node, so the package works
// under a strict CSP with Trusted Types.
import { eventName } from "./shared";

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, attrs: Record<string, string> = {}): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = cls;
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  return e;
}

const NS = "http://www.w3.org/2000/svg";
/** A stroked 24px icon from one path. */
export function icon(d: string, size: number): SVGSVGElement {
  const s = document.createElementNS(NS, "svg");
  s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("width", String(size));
  s.setAttribute("height", String(size));
  s.setAttribute("aria-hidden", "true");
  s.setAttribute("focusable", "false");
  const p = document.createElementNS(NS, "path");
  p.setAttribute("d", d);
  p.setAttribute("fill", "none");
  p.setAttribute("stroke", "currentColor");
  p.setAttribute("stroke-width", "2");
  p.setAttribute("stroke-linecap", "round");
  p.setAttribute("stroke-linejoin", "round");
  s.append(p);
  return s;
}
export const CHEVRON = "M9 6l6 6-6 6";
export const CHEVRON_LEFT = "M15 6l-6 6 6 6";
export const CROSS = "M6 6l12 12M18 6L6 18";
export const PAUSE = "M9 6v12M15 6v12";
export const PLAY = "M8 5.5v13l10-6.5z";

/** Call the option hook (if any) and dispatch the same thing as a bubbling CustomEvent. */
export function emitter<O extends object>(options: O, target: () => EventTarget | null) {
  return (hook: string, detail: unknown, ...args: unknown[]) => {
    const fn = (options as Record<string, unknown>)[hook];
    if (typeof fn === "function") {
      try { fn(...(args.length ? args : [detail])); } catch (e) { setTimeout(() => { throw e; }); }
    }
    target()?.dispatchEvent(new CustomEvent(eventName(hook), { detail, bubbles: true }));
  };
}

export const systemReduces = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Your icons, as the d of a 24px stroked path, in place of the defaults. */
export type Icons = Partial<{ next: string; prev: string; close: string; play: string; pause: string }>;

/** A CSS background for a placeholder: a colour, or an image address (a tiny thumbnail or a decoded blurhash). */
export function placeholderStyle(el: HTMLElement, value: string | undefined): void {
  if (!value) return;
  const v = value.trim();
  if (/^(#|rgb|hsl|hwb|lab|lch|oklab|oklch|color\(|var\()/i.test(v) || /^[a-z]+$/i.test(v)) el.style.backgroundColor = v;
  else el.style.backgroundImage = `url(${JSON.stringify(v)})`;
}
