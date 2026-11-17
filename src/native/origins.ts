// Where the lightbox springs from and back to. A Procession or Drumline given `origins` registers itself here: an
// untransformed container (measured on the UI thread) and a worklet that says where picture i sits inside it now.
// The lightbox reads it when it opens and again when it closes, and hides the picture in its spot while open.
import { useEffect, useRef } from "react";
import type { View } from "react-native";
import { measure, useSharedValue, type AnimatedRef, type SharedValue } from "react-native-reanimated";
import type { Box } from "../lightbox-math";

export type OriginSource = {
  /** A container that is not itself moved by a transform. */
  ref: AnimatedRef<View>;
  /** Worklet: picture i's box inside that container right now, or null when it has none. */
  rect: (i: number) => Box | null;
  /** The pictures' corner radius in their spots. */
  radius: number;
};

export type Origins = {
  /** The registered source (set by the part you pass `origins` to). */
  current: OriginSource | null;
  /** The picture hidden in its spot while the lightbox shows it, or -1. */
  hidden: SharedValue<number>;
};

/** One registry, shared by the part the lightbox opens from and the lightbox: useOrigins() once per screen. */
export function useOrigins(): Origins {
  const hidden = useSharedValue(-1);
  const ref = useRef<Origins | null>(null);
  if (!ref.current) ref.current = { current: null, hidden };
  return ref.current;
}

/** Register source() as the origins' source while mounted (again when deps change). */
export function useOriginSource(origins: Origins | undefined, source: () => OriginSource, deps: unknown[]): void {
  useEffect(() => {
    if (!origins) return;
    const s = source();
    origins.current = s;
    return () => { if (origins.current === s) origins.current = null; };
  }, [origins, ...deps]);
}

/** On the UI thread: picture i's box on screen (window coordinates), or null when it cannot be measured. */
export function measureOrigin(ref: AnimatedRef<View>, rect: (i: number) => Box | null, i: number): Box | null {
  "worklet";
  const m = measure(ref);
  const r = rect(i);
  if (!m || !r) return null;
  return { x: m.pageX + r.x, y: m.pageY + r.y, w: r.w, h: r.h };
}
