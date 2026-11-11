// Thin React bindings. The core does the work; these only mount it, keep the latest callbacks, and clean up.
// Safe to import during server rendering: nothing touches the DOM until an effect runs.
import { createElement, forwardRef, useCallback, useEffect, useImperativeHandle, useRef, type CSSProperties } from "react";
import { procession, type Procession as Slider, type ProcessionOptions } from "./slider";
import { unfurl, type Unfurl, type UnfurlOptions } from "./lightbox";

export type ProcessionProps = ProcessionOptions & { className?: string; style?: CSSProperties };
export type ProcessionHandle = Slider;

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
  const key = [props.photos.map((p) => (typeof p === "string" ? p : p.src)).join("\n"), props.loop, props.autoplay, props.snap, props.dots, props.arrows, props.reducedMotion, JSON.stringify(props.labels ?? null), props.label].join("|");
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
  return createElement("div", { ref: root, className: props.className, style: props.style });
});

/**
 * The lightbox as a hook: `const lightbox = useUnfurl(photos, { origin })`, then `lightbox.open(i)`.
 * Options are read when it opens; hooks (onChange, onCloseEnd, ...) always see the latest props.
 * It closes on unmount.
 */
export function useUnfurl(photos: UnfurlOptions["photos"], options: Omit<UnfurlOptions, "photos" | "start"> = {}) {
  const inst = useRef<Unfurl | null>(null);
  const latest = useRef({ photos, ...options } as UnfurlOptions);
  latest.current = { photos, ...options };
  useEffect(() => () => { inst.current?.destroy(); inst.current = null; }, []);
  const open = useCallback((start = 0) => {
    inst.current?.destroy();
    const o = latest.current;
    const hooks = latestHooks(latest, ["onOpenStart", "onOpenEnd", "onCloseStart", "onChange", "onAnimationStart", "onAnimationEnd", "onError"]);
    inst.current = unfurl({
      ...o, ...hooks, start,
      onCloseEnd: (d) => { inst.current = null; latest.current.onCloseEnd?.(d); },
    });
  }, []);
  const close = useCallback(() => inst.current?.close(), []);
  return { open, close, get current() { return inst.current; } };
}

export { procession, unfurl };
export type { ProcessionOptions, UnfurlOptions, Unfurl };
