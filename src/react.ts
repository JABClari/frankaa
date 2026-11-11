// Thin React bindings. The core does the work; these only mount it, keep the latest callbacks, and clean up.
// Safe to import during server rendering: nothing touches the DOM until an effect runs.
//   <Procession items={items} />            the slider
//   <Drumline items={items} preset="ruler" />  the strip
//   const lb = useUnfurl(items, { strip: "ruler" }); lb.open(i)   the lightbox (with its filmstrip)
import { createElement, forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { procession, type Procession as Slider, type ProcessionOptions } from "./slider";
import { unfurl, type Unfurl, type UnfurlApi, type UnfurlOptions } from "./lightbox";
import { drumline, type Drumline as DrumlineCore, type DrumlineOptions } from "./drumline";
import { slideSrc, toItem, type Items } from "./items";

// The placeholder as React style (a colour, or an image address), matching what the parts set.
function placeholderCss(v: string | undefined): CSSProperties | undefined {
  if (!v) return undefined;
  const t = v.trim();
  return /^(#|rgb|hsl|hwb|lab|lch|oklab|oklch|color\(|var\()/i.test(t) || /^[a-z]+$/i.test(t) ? { backgroundColor: t } : { backgroundImage: `url(${JSON.stringify(t)})`, backgroundSize: "cover", backgroundPosition: "center" };
}

// Every on* option is wrapped so it always calls the latest prop without rebuilding.
function latestHooks<T extends object>(ref: { current: T }, keys: string[]): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (k.startsWith("on")) out[k] = (...a: unknown[]) => (ref.current as Record<string, ((...x: unknown[]) => void) | undefined>)[k]?.(...a);
  return out as Partial<T>;
}
const listOf = (p: { items?: Items; photos?: Items }): Items => p.items ?? p.photos ?? [];
const keyOf = (items: Items) => items.map((x) => (typeof x === "string" ? x : x.src)).join("\n");
// Everything but functions and React's own props: when this changes, the part is rebuilt.
const optionsKey = (p: Record<string, unknown>) => JSON.stringify(p, (k, v) => (typeof v === "function" || k === "items" || k === "photos" || k === "className" || k === "style" || k === "children" ? undefined : v));

/**
 * React StrictMode mounts, unmounts and mounts again in development. Tidying up a moment later, and only if no
 * remount came, keeps that from closing or rebuilding things for real.
 */
function useLaterCleanup() {
  const timer = useRef(0);
  useEffect(() => { clearTimeout(timer.current); }, []);
  return (f: () => void) => { clearTimeout(timer.current); timer.current = window.setTimeout(f, 0); };
}

export type ProcessionProps = ProcessionOptions & { className?: string; style?: CSSProperties };
export type ProcessionHandle = Slider;

/** The slider. A ref gives its controls (index, go, next, prev, play, pause, image). */
export const Procession = forwardRef<ProcessionHandle | null, ProcessionProps>(function Procession(props, ref) {
  const root = useRef<HTMLDivElement>(null);
  const inst = useRef<Slider | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const items = listOf(props);
  const key = keyOf(items) + "|" + optionsKey(props as Record<string, unknown>);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const { className: _c, style: _s, ...p } = latest.current;
    const hooks = latestHooks(latest, Object.keys(p));
    const s = procession(el, listOf(p), { ...p, ...hooks, onSelect: p.onSelect ? hooks.onSelect : undefined });
    inst.current = s;
    return () => { s.destroy(); inst.current = null; };
  }, [key]);
  useImperativeHandle(ref, () => ({
    get index() { return inst.current?.index ?? 0; },
    get el() { return root.current as HTMLElement; },
    go: (i, smooth) => inst.current?.go(i, smooth),
    next: () => inst.current?.next(),
    prev: () => inst.current?.prev(),
    play: () => inst.current?.play(),
    pause: () => inst.current?.pause(),
    image: (i) => inst.current?.image(i),
    destroy: () => inst.current?.destroy(),
  }), []);
  // On the server (and the first client render) the first picture is already there, so the first paint is never
  // empty; the slider keeps it until its own picture has decoded.
  const raw = items[Math.max(0, Math.min(items.length - 1, props.start ?? 0))];
  const first = raw === undefined ? null : toItem(raw);
  const img = first && first.type !== "video" ? first : null;
  const ssr = first
    ? createElement("img", {
        className: "fk-ssr", src: slideSrc(first), srcSet: img?.srcset, sizes: img?.sizes, alt: "", "aria-hidden": true,
        width: img?.width ?? 1200, height: img?.height ?? 900, decoding: "async", loading: props.priority ? "eager" : "lazy",
        draggable: false, style: placeholderCss(first.placeholder),
      })
    : null;
  return createElement("div", { ref: root, className: props.className ? `fk-procession ${props.className}` : "fk-procession", style: props.style, suppressHydrationWarning: true }, ssr);
});

export type DrumlineProps = DrumlineOptions & { className?: string; style?: CSSProperties };
export type DrumlineHandle = DrumlineCore;

/** The drumline strip: <Drumline items={items} preset="ruler" />. A ref gives its controls. */
export const Drumline = forwardRef<DrumlineHandle | null, DrumlineProps>(function Drumline(props, ref) {
  const root = useRef<HTMLDivElement>(null);
  const inst = useRef<DrumlineCore | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const key = keyOf(listOf(props)) + "|" + optionsKey(props as Record<string, unknown>);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const { className: _c, style: _s, ...p } = latest.current;
    const hooks = latestHooks(latest, Object.keys(p));
    const d = drumline(el, listOf(p), { ...p, ...hooks, onSelect: p.onSelect ? hooks.onSelect : undefined });
    inst.current = d;
    return () => { d.destroy(); inst.current = null; };
  }, [key]);
  useImperativeHandle(ref, () => ({
    get index() { return inst.current?.index ?? 0; },
    get renderer() { return inst.current?.renderer ?? "dom"; },
    get el() { return root.current as HTMLElement; },
    go: (i, smooth) => inst.current?.go(i, smooth),
    next: () => inst.current?.next(),
    prev: () => inst.current?.prev(),
    expand: (i) => inst.current?.expand(i),
    image: (i) => inst.current?.image(i),
    destroy: () => inst.current?.destroy(),
  }), []);
  return createElement("div", { ref: root, className: props.className ? `fk-drumline ${props.className}` : "fk-drumline", style: props.style });
});

export type UseUnfurlOptions = Omit<UnfurlOptions, "items" | "photos" | "start" | "controls"> & {
  /** Your own controls in the top bar (before Close, inside the focus trap). Render `lightbox.portal` anywhere in
   *  your tree for them to appear; they keep your React context. */
  renderControls?: (api: UnfurlApi) => ReactNode;
  /** The component unmounted while the lightbox was open. Unmounting does not fire onCloseStart or onCloseEnd
   *  (and React StrictMode's practice unmount in development does nothing at all). */
  onDestroy?: (d: { index: number }) => void;
};

/**
 * The lightbox as a hook: `const lightbox = useUnfurl(items, { origin, strip: "ruler" })`, then `lightbox.open(i)`.
 * Options are read when it opens; hooks always see the latest props. With renderControls, render
 * `{lightbox.portal}` somewhere in your component.
 */
export function useUnfurl(items: Items, options: UseUnfurlOptions = {}) {
  const inst = useRef<Unfurl | null>(null);
  const latest = useRef({ items, ...options } as UnfurlOptions & UseUnfurlOptions);
  latest.current = { items, ...options };
  const [slot, setSlot] = useState<{ host: HTMLElement; api: UnfurlApi; index: number } | null>(null);
  const later = useLaterCleanup();
  useEffect(() => () => later(() => {
    const u = inst.current;
    if (!u) return;
    inst.current = null;
    const index = u.index;
    u.destroy({ hooks: false });
    latest.current.onDestroy?.({ index });
  }), []);
  const open = useCallback((start = 0) => {
    inst.current?.destroy({ hooks: false });
    const { renderControls, onDestroy: _d, items: list, ...o } = latest.current;
    const hooks = latestHooks(latest, ["onOpenStart", "onOpenEnd", "onCloseStart", "onAnimationStart", "onAnimationEnd", "onError"]);
    inst.current = unfurl(list ?? [], {
      ...o, ...hooks, start,
      controls: renderControls ? (host, api) => { setSlot({ host, api, index: api.index }); return () => setSlot(null); } : undefined,
      onChange: (i, d) => { setSlot((s) => (s ? { ...s, index: i } : s)); latest.current.onChange?.(i, d); },
      onCloseEnd: (d) => { inst.current = null; latest.current.onCloseEnd?.(d); },
    });
  }, []);
  const close = useCallback(() => inst.current?.close(), []);
  const render = latest.current.renderControls;
  const portal = slot && render ? createPortal(render(slot.api), slot.host) : null;
  return { open, close, portal, get current() { return inst.current; } };
}

export { procession, unfurl, drumline };
export type { ProcessionOptions, UnfurlOptions, Unfurl, DrumlineOptions, Items };
