// Thin React bindings. The core does the work; these only mount it, keep the latest callbacks, and clean up.
import { createElement, forwardRef, useCallback, useEffect, useImperativeHandle, useRef, type CSSProperties } from "react";
import { procession, type Procession as Slider, type ProcessionOptions } from "./slider";
import { unfurl, type Unfurl, type UnfurlOptions } from "./lightbox";

export type ProcessionProps = ProcessionOptions & { className?: string; style?: CSSProperties };
export type ProcessionHandle = Slider;

/** The photo slider. A ref gives the slider's controls (index, go, next, prev, image). */
export const Procession = forwardRef<ProcessionHandle | null, ProcessionProps>(function Procession(props, ref) {
  const root = useRef<HTMLDivElement>(null);
  const inst = useRef<Slider | null>(null);
  const latest = useRef(props);
  latest.current = props;
  // Rebuild only when the photos themselves change.
  const key = props.photos.map((p) => (typeof p === "string" ? p : p.src)).join("\n");
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const p = latest.current;
    const s = procession(el, {
      photos: p.photos, label: p.label, start: p.start, dots: p.dots, arrows: p.arrows, priority: p.priority, lazyMargin: p.lazyMargin,
      onChange: (i) => latest.current.onChange?.(i),
      onSelect: p.onSelect ? (i, img) => latest.current.onSelect?.(i, img) : undefined,
    });
    inst.current = s;
    return () => { s.destroy(); inst.current = null; };
  }, [key]);
  useImperativeHandle(ref, () => ({
    get index() { return inst.current?.index ?? 0; },
    get el() { return root.current as HTMLElement; },
    go: (i, smooth) => inst.current?.go(i, smooth),
    next: () => inst.current?.next(),
    prev: () => inst.current?.prev(),
    image: (i) => inst.current?.image(i),
    destroy: () => inst.current?.destroy(),
  }), []);
  return createElement("div", { ref: root, className: props.className, style: props.style });
});

/**
 * The lightbox as a hook: `const lightbox = useUnfurl(photos, { origin })`, then `lightbox.open(i)`.
 * Options are read when it opens; callbacks always see the latest props. It closes on unmount.
 */
export function useUnfurl(photos: UnfurlOptions["photos"], options: Omit<UnfurlOptions, "photos" | "start"> = {}) {
  const inst = useRef<Unfurl | null>(null);
  const latest = useRef({ photos, options });
  latest.current = { photos, options };
  useEffect(() => () => { inst.current?.destroy(); inst.current = null; }, []);
  const open = useCallback((start = 0) => {
    inst.current?.destroy();
    const { photos: ps, options: o } = latest.current;
    inst.current = unfurl({
      ...o, photos: ps, start,
      onChange: (i, how) => latest.current.options.onChange?.(i, how),
      onClose: (i) => { inst.current = null; latest.current.options.onClose?.(i); },
    });
  }, []);
  const close = useCallback(() => inst.current?.close(), []);
  return { open, close };
}

export { procession, unfurl };
export type { ProcessionOptions, UnfurlOptions, Unfurl };
