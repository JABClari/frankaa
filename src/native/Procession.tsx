// Procession for React Native: a horizontal strip of photos that follows the finger 1:1, with the next photo
// peeking in. Past the first or last photo it rubber-bands; on release it springs to the photo the flick was
// heading for (distance or velocity), carrying the finger's speed. All of it on the UI thread.
import { useEffect, useMemo, useState } from "react";
import { StyleSheet, View, type LayoutChangeEvent, type StyleProp, type ViewStyle } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { cancelAnimation, useAnimatedRef, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, type SharedValue } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";
import { slideSrc, toItem, type Item, type Items } from "../items";
import { PROCESSION_LABELS, type ProcessionLabels } from "../slider-math";
import { pickSlide } from "../lightbox-math";
import { band, fill, resolveReduced } from "../shared";
import { clampIndex } from "../slider-math";
import { adjustable, useFocusIndex } from "./focus";
import { ItemImage, type RenderImage } from "./image";
import { SNAP, type HapticFn, type ReducedMotion } from "./motion";
import { useOriginSource, type Origins } from "./origins";

export type ProcessionProps = {
  /** The items (the shared format; strings are taken as src). The strip shows src (a video's poster). */
  items: Items;
  /** The photo in view. Pass it with onChange to keep the strip in step with a Drumline or the lightbox. */
  index?: number;
  /** The photo to start on when index is not passed. Default 0. */
  start?: number;
  /** The photo in view changed (a swipe, a tap on the peeking photo, or an accessibility action). */
  onChange?: (index: number) => void;
  /** A tap on the photo in view (open the lightbox here). */
  onPress?: (index: number) => void;
  /** Register as the spot the lightbox springs from and back to (see useOrigins). */
  origins?: Origins;
  /** Each photo's width over its height. Default 4 / 3. */
  aspectRatio?: number;
  /** How much of the next photo shows, in pt. Default 24. */
  peek?: number;
  /** Space between photos, in pt. Default 10. */
  gap?: number;
  /** Corner radius of each photo, in pt. Default 16. */
  radius?: number;
  /** Shorthand for labels.region. */
  label?: string;
  labels?: Partial<ProcessionLabels>;
  /** Plays a haptic: "selection" as each photo comes into view. */
  haptics?: HapticFn;
  reducedMotion?: ReducedMotion;
  renderImage?: RenderImage;
  style?: StyleProp<ViewStyle>;
};

export function Procession(props: ProcessionProps) {
  const { items: raw, origins, peek = 24, gap = 10, radius = 16 } = props;
  const items = useMemo(() => raw.map(toItem), [raw]);
  const n = items.length;
  const L: ProcessionLabels = { ...PROCESSION_LABELS, ...(props.label ? { region: props.label } : {}), ...props.labels };
  const reduced = resolveReduced(props.reducedMotion, useReducedMotion());
  const aspect = props.aspectRatio && props.aspectRatio > 0 ? props.aspectRatio : 4 / 3;

  // Sizes come from layout (read on layout only, never per frame).
  const [width, setWidth] = useState(0);
  const photoW = n > 1 ? Math.max(1, width - gap - peek) : width;
  const photoH = photoW / aspect;
  const pitch = photoW + gap;

  const first = clampIndex(props.index ?? props.start ?? 0, n);
  // at: the photo the strip is on or heading to; x: the strip's offset in pt (both on the UI thread).
  const at = useSharedValue(first);
  const x = useSharedValue(0);
  const x0 = useSharedValue(0);
  const ownHidden = useSharedValue(-1);
  const hidden = origins?.hidden ?? ownHidden;
  const container = useAnimatedRef<View>();

  // The app's index prop moves the strip without reporting back (settle is defined below; this runs in an effect).
  const { current, changed, latest } = useFocusIndex(props, n, first, (i) => settle(i, 0, false));
  // Move to photo i: a spring carrying velocity v (pt/s), or a step when motion is reduced. Runs on either thread.
  const settle = (i: number, v: number, report = true) => {
    "worklet";
    const to = -i * pitch;
    x.set(reduced || !pitch ? to : withSpring(to, { ...SNAP, velocity: v }));
    if (i !== at.get()) { at.set(i); if (report) scheduleOnRN(changed, i); }
  };
  const press = (i: number) => latest.current.onPress?.(i);

  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  // A new width keeps the photo in view.
  useEffect(() => { if (pitch > 0) x.set(-at.get() * pitch); }, [pitch]);

  // The lightbox measures this container and asks where photo i sits in it.
  useOriginSource(origins, () => ({
    ref: container,
    rect: (i: number) => {
      "worklet";
      return pitch > 0 ? { x: i * pitch + x.get(), y: 0, w: photoW, h: photoH } : null;
    },
    radius,
  }), [pitch, photoW, photoH, radius]);

  const gesture = useMemo(() => {
    const pan = Gesture.Pan()
      .activeOffsetX([-10, 10])
      .failOffsetY([-10, 10])
      .onStart(() => {
        "worklet";
        cancelAnimation(x);
        x0.set(x.get());
      })
      .onUpdate((e) => {
        "worklet";
        // 1:1 under the finger; past either end it resists.
        x.set(band(x0.get() + e.translationX, -(n - 1) * pitch, 0, Math.max(1, photoW * 0.25)));
      })
      .onEnd((e) => {
        "worklet";
        const i = clampIndex(-x0.get() / pitch, n);
        settle(i + pickSlide(x.get() + i * pitch, e.velocityX, pitch, i > 0, i < n - 1), e.velocityX);
      });
    const tap = Gesture.Tap()
      .maxDuration(300)
      .onEnd((e, ok) => {
        "worklet";
        if (!ok) return;
        // A tap on the peeking photo brings it in; on the photo in view it opens.
        const hit = clampIndex(Math.floor((e.x - x.get()) / pitch), n);
        if (hit !== at.get()) settle(hit, 0);
        else scheduleOnRN(press, hit);
      });
    return Gesture.Race(pan, tap);
  }, [n, pitch, photoW, reduced]);

  const stripStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));
  const item = items[current];
  const a11y = adjustable({
    label: L.region,
    value: fill(L.position, { n: current + 1, total: n }) + (item?.alt ? `. ${item.alt}` : ""),
    step: (d) => settle(clampIndex(current + d, n), 0),
    activate: () => press(current),
  });

  return (
    <Animated.View ref={container} onLayout={onLayout} style={[styles.root, width ? { height: photoH } : { aspectRatio: aspect }, props.style]} {...a11y}>
      {width > 0 && n > 0 ? (
        <GestureDetector gesture={gesture}>
          <View style={StyleSheet.absoluteFill} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
            <Animated.View style={[StyleSheet.absoluteFill, stripStyle]}>
              {items.map((it, i) => (
                <Photo key={i} item={it} index={i} left={i * pitch} width={photoW} height={photoH} radius={radius} hidden={hidden} render={props.renderImage} />
              ))}
            </Animated.View>
          </View>
        </GestureDetector>
      ) : null}
    </Animated.View>
  );
}

function Photo(p: { item: Item; index: number; left: number; width: number; height: number; radius: number; hidden: SharedValue<number>; render?: RenderImage }) {
  const { hidden, index } = p;
  // Hidden in its spot while the lightbox shows it.
  const style = useAnimatedStyle(() => ({ opacity: hidden.get() === index ? 0 : 1 }));
  return (
    <Animated.View style={[styles.photo, { left: p.left, width: p.width, height: p.height, borderRadius: p.radius }, style]}>
      <ItemImage item={p.item} uri={slideSrc(p.item)} index={index} render={p.render} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { width: "100%", overflow: "hidden" },
  photo: { position: "absolute", top: 0, overflow: "hidden", backgroundColor: "rgba(127, 127, 127, 0.12)" },
});
