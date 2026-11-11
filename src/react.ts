// Thin React bindings. The core does the work; these only mount it, keep the latest callbacks, and clean up.
// Safe to import during server rendering: nothing touches the DOM until an effect runs.
import { createElement, forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { procession, type Procession as Slider, type ProcessionOptions } from "./slider";
import { unfurl, type Unfurl, type UnfurlApi, type UnfurlOptions } from "./lightbox";

export type ProcessionProps = ProcessionOptions & { className?: string; style?: CSSProperties };
export type ProcessionHandle = Slider;

// The placeholder as React style (a colour, or an image address), matching what the slider sets.
function placeholderCss(v: string | undefined): CSSProperties | undefined {
  if (!v) return undefined;
  const t = v.trim();
  return /^(#|rgb|hsl|hwb|lab|lch|oklab|oklch|color\(|var\()/i.test(t) || /^[a-z]+$/i.test(t) ? { backgroundColor: t } : { backgroundImage: `url(${JSON.stringify(t)})`, backgroundSize: "cover", backgroundPosition: "center" };
}

// Every on* option is wrapped so it always calls the latest prop without rebuilding the slider or lightbox.
function latestHooks<T extends object>(ref: { current: T }, keys: string[]): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const k of keys) if (k.startsWith("on")) out[k] = (...a: unknown[]) => (ref.current as Record<string, ((...x: unknown[]) => void) | undefined>)[k]?.(...a);
  return out as Partial<T>;
}

/** The photo slider. A ref gives the slider's controls (index, go, next, prev, play, pause, image). */
export const Procession = forwardRef<ProcessionHandle | null, ProcessionProps>(function Procession(props, ref) {
  const root = useRef<HTMLDivElement>(null);
  const inst = useRef<Slider | null>(null);
  const latest = useRef(props);
  latest.current = props;
  // Rebuild only when the photos or the shape-changing options change.
  const key = [props.photos.map((p) => (typeof p === "string" ? p : p.src)).join("\n"), props.loop, props.autoplay, props.snap, props.dots, props.arrows, props.reducedMotion, JSON.stringify(props.labels ?? null), props.label, props.href, props.tabbable, props.counter, props.zoom, props.zoomCursor, props.focusRing, JSON.stringify(props.icons ?? null)].join("|");
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const { className: _c, style: _s, ...p } = latest.current;
    const hooks = latestHooks(latest, Object.keys(p));
    const s = procession(el, { ...p, ...hooks, onSelect: p.onSelect ? hooks.onSelect : undefined });
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
  // On the server (and the first client render) the slider's first photo is already there, so the first paint is
  // never empty; the slider keeps it until its own photo has decoded.
  const first = props.photos[Math.max(0, Math.min(props.photos.length - 1, props.start ?? 0))];
  const p = typeof first === "string" ? { src: first } : first;
  const ssr = p
    ? createElement("img", {
        className: "fk-ssr", src: p.src, srcSet: p.srcset, sizes: p.sizes, alt: "", "aria-hidden": true,
        width: p.width ?? 1200, height: p.height ?? 900, decoding: "async", loading: props.priority ? "eager" : "lazy",
        draggable: false, style: placeholderCss(p.placeholder),
      })
    : null;
  return createElement("div", { ref: root, className: props.className ? `fk-procession ${props.className}` : "fk-procession", style: props.style, suppressHydrationWarning: true }, ssr);
});

export type UseUnfurlOptions = Omit<UnfurlOptions, "photos" | "start" | "controls"> & {
  /** Your own controls in the top bar (before Close, inside the focus trap). Render `lightbox.portal` anywhere in
   *  your tree for them to appear; they keep your React context. */
  renderControls?: (api: UnfurlApi) => ReactNode;
};

/**
 * The lightbox as a hook: `const lightbox = useUnfurl(photos, { origin })`, then `lightbox.open(i)`.
 * Options are read when it opens; hooks (onChange, onCloseEnd, ...) always see the latest props.
 * With renderControls, render `{lightbox.portal}` somewhere in your component. It closes on unmount (firing
 * onCloseStart and onCloseEnd with reason "destroy").
 */
export function useUnfurl(photos: UnfurlOptions["photos"], options: UseUnfurlOptions = {}) {
  const inst = useRef<Unfurl | null>(null);
  const latest = useRef({ photos, ...options } as UnfurlOptions & UseUnfurlOptions);
  latest.current = { photos, ...options };
  const [slot, setSlot] = useState<{ host: HTMLElement; api: UnfurlApi; index: number } | null>(null);
  useEffect(() => () => { inst.current?.destroy(); inst.current = null; }, []);
  const open = useCallback((start = 0) => {
    inst.current?.destroy();
    const { renderControls, ...o } = latest.current;
    const hooks = latestHooks(latest, ["onOpenStart", "onOpenEnd", "onCloseStart", "onAnimationStart", "onAnimationEnd", "onError"]);
    inst.current = unfurl({
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

export { procession, unfurl };
export type { ProcessionOptions, UnfurlOptions, Unfurl };
