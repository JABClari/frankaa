// Drumline for React Native: tall cards over a ruler of ticks. The card in focus grows, the ticks near it lift.
// One position drives it all, on the UI thread: with "lerp" (the default here) it eases toward its target every
// frame, trails the finger a touch, and a flick is projected on and glides to the picture it was heading for.
// Tap a card to select it; drag along the ruler to run through the pictures. The lightbox uses it as its
// filmstrip (Unfurl's strip option).
import { useMemo, useState } from "react";
import { StyleSheet, Text, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { cancelAnimation, useAnimatedReaction, useAnimatedRef, useAnimatedStyle, useDerivedValue, useReducedMotion, useSharedValue, withSpring, type SharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { bandPos, bump, drumlineLook, LERP_RATE, pad, readout, releaseTarget, stripLayout, tickAt, tickLift, type DrumlineLook, type DrumlinePreset } from "../drumline-math";
import { thumbSrc, toItem, type Item, type Items } from "../items";
import { DRUMLINE_LABELS, type DrumlineLabels } from "../drumline-math";
import { fill, resolveReduced } from "../shared";
import { clampIndex } from "../slider-math";
import { ItemImage, type RenderImage } from "./image";
import { SNAP, withLerp, type HapticFn, type ReducedMotion } from "./motion";
import { adjustable, useFocusIndex } from "./focus";
import { useOriginSource, type Origins } from "./origins";

/** Card sizes in pt, per look, and smaller ones for the lightbox's filmstrip (the web's CSS defaults). */
export const DRUMLINE_SIZES = {
  stories: { width: 72, height: 128, gap: 12, radius: 14 },
  bars: { width: 44, height: 176, gap: 10, radius: 3 },
  filmStories: { width: 36, height: 56, gap: 8, radius: 8 },
  filmBars: { width: 20, height: 64, gap: 6, radius: 2 },
} as const;

/** The ruler's tick spacing in pt, and how many ticks it has at the least (more pictures, one tick each). */
const TICK_STEP = 8.5;
const MIN_TICKS = 41;

export type DrumlineProps = Omit<DrumlineLook, "rulerHover"> & {
  /** The items (the shared format; strings are taken as src). The cards show thumb (or src). */
  items: Items;
  /** A starting point for every look option: "ruler" (default), "numbers" or "minimal". */
  preset?: DrumlinePreset;
  /** The picture in focus. Pass it with onChange to keep it in step with a Procession or the lightbox. */
  index?: number;
  /** The picture to start on when index is not passed. Default 0. */
  start?: number;
  /** The picture in focus changed (a drag, a flick, the ruler, a tap, an accessibility action). */
  onChange?: (index: number) => void;
  /** A tap on a card (the strip also moves to it). Open the lightbox here. */
  onSelect?: (index: number) => void;
  /** Register as the spot the lightbox springs from and back to (see useOrigins). */
  origins?: Origins;
  /** Card size in pt. Defaults per look (DRUMLINE_SIZES). */
  cardWidth?: number;
  cardHeight?: number;
  gap?: number;
  radius?: number;
  /** Ticks and numbers drawn for a light background (dark ink, default) or a dark one (white). */
  tone?: "light" | "dark";
  /** The ruler under the cards (default) or over them. */
  rulerPosition?: "bottom" | "top";
  /** Drag with a finger. Default true. */
  drag?: boolean;
  /** A flick carries on and slows (projected from its speed). Default true. */
  inertia?: boolean;
  /** Come to rest on a picture. Default true. */
  snap?: boolean;
  /** Digits for the numbers. Default 2 ("07"). */
  pad?: number;
  /** Shorthand for labels.region. */
  label?: string;
  labels?: Partial<DrumlineLabels>;
  haptics?: HapticFn;
  reducedMotion?: ReducedMotion;
  renderImage?: RenderImage;
  style?: StyleProp<ViewStyle>;
  /** Internal: the lightbox's filmstrip (smaller cards by default). */
  film?: boolean;
};

export function Drumline(props: DrumlineProps) {
  const { items: raw, origins } = props;
  const items = useMemo(() => raw.map(toItem), [raw]);
  const n = items.length;
  const look = drumlineLook(props);
  const L: DrumlineLabels = { ...DRUMLINE_LABELS, ...(props.label ? { region: props.label } : {}), ...props.labels };
  const reduced = resolveReduced(props.reducedMotion, useReducedMotion());
  // "chain" and "bend" draw on the web only; here they move as "lerp".
  const spring = look.fluid === "off";
  const size = DRUMLINE_SIZES[props.film ? (look.look === "bars" ? "filmBars" : "filmStories") : look.look === "bars" ? "bars" : "stories"];
  const W = props.cardWidth ?? size.width;
  const H = props.cardHeight ?? size.height;
  const GAP = props.gap ?? size.gap;
  const R = props.radius ?? size.radius;
  const grow = Math.max(1, look.grow);
  const pitch = W + GAP;
  const VH = Math.ceil(H * grow + 8);
  const ink = props.tone === "dark" ? "#fff" : "#1a1a1a";
  // Plain values for the worklets (a worklet copies what it captures to the UI thread: never the whole props).
  const dragOn = props.drag !== false, inertia = props.inertia !== false, snap = props.snap !== false;
  const ticksOn = look.ticks && n > 1;
  const T = Math.max(n, MIN_TICKS);
  // The ruler's width: TICK_STEP a tick, narrower when that would not fit (measured on layout only).
  const [width, setWidth] = useState(0);
  const rulerW = Math.min((T - 1) * TICK_STEP, Math.max(0, width - 32));
  const tickStep = rulerW / Math.max(1, T - 1);

  const first = clampIndex(props.index ?? props.start ?? 0, n);
  // pos: the fractional picture in focus; goal: where it is heading; vw: the viewport's width.
  const pos = useSharedValue(first);
  const goal = useSharedValue(first);
  const p0 = useSharedValue(first);
  const vw = useSharedValue(0);
  const ownHidden = useSharedValue(-1);
  const hidden = origins?.hidden ?? ownHidden;
  const viewport = useAnimatedRef<View>();

  // The app's index prop moves the focus without reporting back (go is defined below; this runs in an effect).
  const { current, changed, latest } = useFocusIndex(props, n, first, (i) => go(i, LERP_RATE.jump));
  const selected = (i: number) => latest.current.onSelect?.(i);

  // Head for picture (or fractional position) t at rate k; a spring for fluid "off", a step for reduced motion.
  const go = (t: number, k: number, v = 0) => {
    "worklet";
    goal.set(t);
    if (reduced) pos.set(t);
    else if (spring) pos.set(withSpring(t, { ...SNAP, velocity: v }));
    else pos.set(withLerp(t, k, 0.3 / W));
  };

  // The picture in focus changes as the position passes the half-way point: reported once per picture.
  useAnimatedReaction(
    () => clampIndex(pos.get(), n),
    (i, prev) => { if (prev !== null && i !== prev) scheduleOnRN(changed, i); },
    [n],
  );

  const layout = useDerivedValue(() => stripLayout(n, pos.get(), grow, W, GAP, vw.get()));

  // The lightbox measures the viewport and asks where card i sits in it, at its current size.
  useOriginSource(origins, () => ({
    ref: viewport,
    rect: (i: number) => {
      "worklet";
      const l = layout.get();
      if (i < 0 || i >= l.x.length) return null;
      const s = l.s[i];
      return { x: l.x[i] + (W - W * s) / 2, y: (VH - H * s) / 2, w: W * s, h: H * s };
    },
    radius: R,
  }), [W, H, VH, R]);

  const gesture = useMemo(() => {
    const pan = Gesture.Pan()
      .enabled(dragOn)
      .activeOffsetX([-6, 6])
      .failOffsetY([-12, 12])
      .onStart(() => {
        "worklet";
        cancelAnimation(pos);
        p0.set(pos.get());
      })
      .onUpdate((e) => {
        "worklet";
        const t = bandPos(p0.get() - e.translationX / pitch, n);
        goal.set(t);
        if (reduced || spring) pos.set(t);
        else pos.set(withLerp(t, LERP_RATE.held, 0.3 / W));
      })
      .onEnd((e) => {
        "worklet";
        const t = releaseTarget(spring || reduced ? pos.get() : goal.get(), e.velocityX, pitch, n, inertia, snap);
        go(t, LERP_RATE.glide, -e.velocityX / pitch);
      });
    const tap = Gesture.Tap()
      .maxDuration(300)
      .onEnd((e, ok) => {
        "worklet";
        if (!ok) return;
        // The card under the finger, at its current size.
        const l = layout.get();
        for (let i = 0; i < l.x.length; i++) {
          const half = (W * l.s[i]) / 2, c = l.x[i] + W / 2;
          if (e.x >= c - half - GAP / 2 && e.x <= c + half + GAP / 2) {
            go(i, LERP_RATE.jump);
            scheduleOnRN(selected, i);
            return;
          }
        }
      });
    return Gesture.Race(pan, tap);
  }, [n, pitch, W, GAP, reduced, spring, dragOn, inertia, snap]);

  // The ruler: a drag (or tap) along it runs through the pictures.
  const ruler = useMemo(() => {
    const at = (x: number) => {
      "worklet";
      return tickAt(x - (vw.get() - rulerW) / 2, rulerW, n);
    };
    const pan = Gesture.Pan()
      .activeOffsetX([-2, 2])
      .failOffsetY([-12, 12])
      .onUpdate((e) => { "worklet"; go(at(e.x), LERP_RATE.jump); })
      .onEnd(() => { "worklet"; go(clampIndex(goal.get(), n), LERP_RATE.jump); });
    const tap = Gesture.Tap().onEnd((e, ok) => { "worklet"; if (ok) go(clampIndex(at(e.x), n), LERP_RATE.jump); });
    return Gesture.Race(pan, tap);
  }, [n, rulerW, reduced, spring]);

  const onLayout = (e: LayoutChangeEvent) => {
    vw.set(e.nativeEvent.layout.width);
    setWidth(e.nativeEvent.layout.width);
  };
  const item = items[current];
  const a11y = adjustable({
    label: L.region,
    value: fill(L.position, { n: current + 1, total: n }) + (item?.alt ? `. ${item.alt}` : ""),
    step: (d) => go(clampIndex(current + d, n), LERP_RATE.jump),
    activate: () => selected(current),
  });

  const r = readout(current, n);
  const digits = props.pad ?? 2;
  const numbers = look.numbers === "fraction"
    ? <Text style={[styles.num, { color: ink }]}>{`${pad(r.cur, digits)} / ${pad(n, digits)}`}</Text>
    : look.numbers === "frame"
      ? (
        <View style={styles.frameRow}>
          <Text style={[styles.num, styles.dim, { color: ink }]}>{r.prev === null ? "  " : pad(r.prev, digits)}</Text>
          <Text style={[styles.num, styles.cur, { color: ink, borderColor: ink }]}>{pad(r.cur, digits)}</Text>
          <Text style={[styles.num, styles.dim, { color: ink }]}>{r.next === null ? "  " : pad(r.next, digits)}</Text>
        </View>
      )
      : null;

  // The row keeps its height before layout; the ticks come with the width.
  const rulerRow = ticksOn ? (
    <GestureDetector gesture={ruler}>
      <View style={styles.ruler}>
        {rulerW > 0 ? (
          <View style={[styles.ticks, { width: rulerW }]}>
            {Array.from({ length: T }, (_, j) => (
              <Tick key={j} j={j} T={T} n={n} left={j * tickStep} pos={pos} feedback={look.focusFeedback} color={ink} />
            ))}
          </View>
        ) : null}
      </View>
    </GestureDetector>
  ) : null;

  return (
    <View style={props.style} {...a11y}>
      {props.rulerPosition === "top" ? rulerRow : null}
      <GestureDetector gesture={gesture}>
        <Animated.View ref={viewport} onLayout={onLayout} style={[styles.viewport, { height: VH }]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          {items.map((it, i) => (
            <Card key={i} item={it} index={i} top={(VH - H) / 2} width={W} height={H} radius={R} layout={layout} pos={pos} hidden={hidden}
              feedback={look.focusFeedback} colorFocus={look.colorFocus} film={!!props.film} render={props.renderImage} />
          ))}
        </Animated.View>
      </GestureDetector>
      {props.rulerPosition === "top" ? null : rulerRow}
      {numbers ? <View style={styles.numbers} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>{numbers}</View> : null}
    </View>
  );
}

type CardProps = {
  item: Item; index: number; top: number; width: number; height: number; radius: number;
  layout: SharedValue<{ x: number[]; s: number[] }>; pos: SharedValue<number>; hidden: SharedValue<number>;
  feedback: boolean; colorFocus: boolean; film: boolean; render?: RenderImage;
};

function Card(p: CardProps) {
  const { layout, pos, hidden, index: i, feedback, colorFocus } = p;
  const style = useAnimatedStyle(() => {
    const l = layout.get();
    const near = bump(i - pos.get(), 2.5);
    // Cards away from the focus dim a little (feedback), and lose a little light (colorFocus: opacity stands in
    // for the web's saturate and brightness filter, which is not a transform).
    const alpha = (feedback ? 1 - 0.4 * (1 - near) : 1) * (colorFocus ? 0.84 + 0.16 * near : 1);
    return {
      opacity: hidden.get() === i ? 0 : alpha,
      transform: [{ translateX: l.x[i] ?? 0 }, { scale: l.s[i] ?? 1 }],
    };
  });
  return (
    <Animated.View style={[styles.card, { top: p.top, width: p.width, height: p.height, borderRadius: p.radius }, p.film ? styles.filmCard : null, style]}>
      <ItemImage item={p.item} uri={thumbSrc(p.item)} index={i} render={p.render} />
    </Animated.View>
  );
}

function Tick(p: { j: number; T: number; n: number; left: number; pos: SharedValue<number>; feedback: boolean; color: string }) {
  const { j, T, n, pos, feedback } = p;
  const style = useAnimatedStyle(() => {
    const lift = tickLift(j, T, n, pos.get(), feedback);
    return { opacity: 0.3 + 0.7 * lift, transform: [{ scaleY: 1 + 1.25 * lift }] };
  });
  return <Animated.View style={[styles.tick, { left: p.left, backgroundColor: p.color }, style]} />;
}

const styles = StyleSheet.create({
  viewport: { width: "100%", overflow: "hidden" },
  card: { position: "absolute", left: 0, overflow: "hidden", backgroundColor: "rgba(127, 127, 127, 0.14)" },
  filmCard: { backgroundColor: "rgba(255, 255, 255, 0.08)" },
  // 44 pt tall, so the ruler is easy to catch; the ticks sit in its middle.
  ruler: { height: 44, alignItems: "center", justifyContent: "center" },
  ticks: { height: 18 },
  tick: { position: "absolute", top: 4, width: 1, height: 10, borderRadius: 0.5, transformOrigin: "50% 50%" },
  numbers: { alignItems: "center", paddingTop: 2 },
  frameRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  num: { fontSize: 11, fontWeight: "500", fontVariant: ["tabular-nums"], letterSpacing: 0.2 },
  dim: { opacity: 0.45 },
  cur: { paddingHorizontal: 6, paddingVertical: 3, borderRadius: 3, borderWidth: StyleSheet.hairlineWidth },
});
