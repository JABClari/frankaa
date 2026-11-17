// Unfurl for React Native: the lightbox. The photo lifts out of its spot (measured on the UI thread) and grows to
// fit the screen on the iOS sheet curve; it closes quicker, with a strong ease-out, back to the spot it came from,
// which may have moved meanwhile. Swipe sideways for the next photo (1:1, then a spring with the finger's speed);
// pull down to close (a flick is enough). A drumline under it is the filmstrip; actions go in slots.
// Drawn with transforms and opacity (FLIP: the photo is laid out at its open box and transformed to where it is),
// or by a renderer such as frankaa/native/skia's shader while it flies. Reduced motion is a crossfade.
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, type ComponentType, type ReactNode } from "react";
import { AccessibilityInfo, Image, Modal, Platform, Pressable, StatusBar, StyleSheet, Text, View, useWindowDimensions, type LayoutChangeEvent } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { cancelAnimation, useAnimatedStyle, useDerivedValue, useReducedMotion, useSharedValue, withSpring, withTiming, type SharedValue } from "react-native-reanimated";
import { scheduleOnRN, scheduleOnUI } from "react-native-worklets";
import { stripOptions, type DrumlinePreset } from "../drumline-math";
import { fullSrc, toItem, type Item, type Items } from "../items";
import { UNFURL_LABELS, type UnfurlLabels } from "../lightbox-labels";
import { containBox, draggedBox, flipFrame, lockAxis, mixBox, onScreen, pickSlide, pullFrame, radiusAt, stageBox, swipeIntent, toR4, STRIP_GAP, type Box, type R4, type Radius } from "../lightbox-math";
import { fill, resolveReduced, rubber } from "../shared";
import { clampIndex } from "../slider-math";
import { Drumline, type DrumlineProps } from "./Drumline";
import { ItemImage, type RenderImage } from "./image";
import { CLOSE_MS, EASE_OUT, EASE_SHEET, FADE_MS, OPEN_MS, SNAP, type HapticFn, type ReducedMotion } from "./motion";
import { measureOrigin, type OriginSource, type Origins } from "./origins";

/** What actions get: the lightbox's state and a few of its controls. */
export type UnfurlApi = { readonly index: number; readonly item: Item; close(): void; next(): void; prev(): void; show(i: number): void };
/** The ref: open it, and everything actions get. */
export type UnfurlHandle = UnfurlApi & { open(i?: number): void; readonly isOpen: boolean };

/**
 * A renderer draws the photo while it flies (opening and closing), over the plain views, from shared values only.
 * It sets ready to 1 once it can draw (its image is loaded) and back to 0 when it unmounts; until then the views
 * draw. It is mounted again (keyed) for each photo. See frankaa/native/skia.
 */
export type UnfurlRendererProps = {
  item: Item;
  uri: string;
  /** Where the photo is drawn now, in pt (window coordinates). */
  box: SharedValue<Box>;
  /** Its corner radii now: top left, top right, bottom right, bottom left. */
  radii: SharedValue<R4>;
  /** 0 at its spot, 1 open. */
  progress: SharedValue<number>;
  /** 1 while it should draw (flying between spot and open box), else 0 (the views draw then). */
  active: SharedValue<number>;
  ready: SharedValue<number>;
  width: number;
  height: number;
};
export type UnfurlRenderer = ComponentType<UnfurlRendererProps>;

type Slot = ReactNode | ((api: UnfurlApi) => ReactNode);
/** The filmstrip: true or "drumline" is the ruler preset, a name is that preset, an object is Drumline props. */
export type UnfurlStrip = boolean | "drumline" | DrumlinePreset | Omit<DrumlineProps, "items" | "index" | "onChange" | "film">;

export type UnfurlProps = {
  /** The items (the shared format). The lightbox shows full (or src); the filmstrip thumb (or src). */
  items: Items;
  /** Spring from and back to the spots a Procession or Drumline registered here (see useOrigins). Without it,
   *  or when the spot is off screen, the photo fades in and out. */
  origins?: Origins;
  /** The photo shown. Pass it with onChange to keep a Procession or Drumline under it in step. */
  index?: number;
  /** The photo shown changed (a swipe, the filmstrip, an action, an accessibility action). */
  onChange?: (index: number) => void;
  /** It finished opening. */
  onOpen?: (index: number) => void;
  /** It finished closing (the photo is back in its spot). */
  onClose?: (index: number) => void;
  /** The filmstrip under the photo. Off by default; "ruler" matches the web. */
  strip?: UnfurlStrip;
  /** The bottom slot (for example Make cover and Delete), under the filmstrip. */
  actions?: Slot;
  /** The top right slot, beside the counter. */
  topActions?: Slot;
  /** Corner radius when open, in pt: one number or four. Default 12. */
  openRadius?: Radius;
  /** Corner radius in the spot when no origin says it. Default 16. */
  radius?: Radius;
  /** Draws the photo while it flies, for example skiaUnfurl from "frankaa/native/skia". Default: plain views. */
  renderer?: UnfurlRenderer;
  /** The backdrop colour. Default "#0e0e11". */
  backdrop?: string;
  /** Room for the status bar and the home indicator, in pt (pass useSafeAreaInsets() when you have it). */
  insets?: { top: number; bottom: number };
  /** Shorthand for labels.dialog. */
  label?: string;
  labels?: Partial<UnfurlLabels>;
  /** Plays a haptic: "selection" on each new photo, "light" when a close commits. */
  haptics?: HapticFn;
  reducedMotion?: ReducedMotion;
  renderImage?: RenderImage;
};

const BAR = 52;
const ZERO: Box = { x: 0, y: 0, w: 1, h: 1 };
const DEFAULT_INSETS = { top: Platform.OS === "ios" ? 54 : StatusBar.currentHeight ?? 24, bottom: Platform.OS === "ios" ? 34 : 16 };

export const Unfurl = forwardRef<UnfurlHandle, UnfurlProps>(function Unfurl(props, ref) {
  const items = useMemo(() => props.items.map(toItem), [props.items]);
  const n = items.length;
  const L: UnfurlLabels = { ...UNFURL_LABELS, ...(props.label ? { dialog: props.label } : {}), ...props.labels };
  const reduced = resolveReduced(props.reducedMotion, useReducedMotion());
  const { width: vw, height: vh } = useWindowDimensions();
  const insets = props.insets ?? DEFAULT_INSETS;
  const strip = stripOptions(props.strip);
  const pitch = vw + STRIP_GAP;

  const [visible, setVisible] = useState(false);
  const [cur, setCur] = useState(clampIndex(props.index ?? 0, n));
  const [aspects, setAspects] = useState<Record<number, number>>({});
  // The bottom bar's height, measured (a first guess until then).
  const [bottomH, setBottomH] = useState((strip ? 150 : 0) + (props.actions ? 52 : 0));

  // Where each photo rests when open: fitted inside the room the bars leave.
  const side = stageBox(vw, vh).x;
  const top = insets.top + BAR;
  const area: Box = { x: side, y: top, w: Math.max(1, vw - side * 2), h: Math.max(1, vh - top - insets.bottom - bottomH - 12) };
  const aspectOf = (i: number) => {
    const it = items[i] as { width?: number; height?: number } | undefined;
    return aspects[i] ?? (it?.width && it?.height ? it.width / it.height : 1.5);
  };
  const rests = useMemo(() => items.map((_, i) => containBox(aspectOf(i), area)), [items, aspects, vw, vh, bottomH, insets.top, insets.bottom]);

  // The motion, all on the UI thread.
  const p = useSharedValue(0);            // 0 at the spot, 1 open
  const closing = useSharedValue(0);
  const hasFrom = useSharedValue(0);       // 1 when it springs from a spot, 0 when it fades
  const from = useSharedValue<Box>(ZERO);  // the spot
  const endBox = useSharedValue<Box>(ZERO); // where a close starts
  const pos = useSharedValue(cur);         // the strip of photos, as a fractional index
  const pos0 = useSharedValue(cur);
  const focus = useSharedValue(cur);       // the photo that opens, closes and is pulled
  const axis = useSharedValue(0);          // 0 not locked, 1 sideways, 2 up or down
  const pullX = useSharedValue(0);
  const pullY = useSharedValue(0);
  const ready = useSharedValue(0);
  const restsSV = useSharedValue<Box[]>(rests);
  const ownHidden = useSharedValue(-1);
  const hidden = props.origins?.hidden ?? ownHidden;
  useEffect(() => { restsSV.set(rests); }, [rests]);

  // Where the focus photo is drawn now.
  const focusBox = useDerivedValue<Box>(() => {
    const r = restsSV.get()[focus.get()] ?? ZERO;
    if (closing.get()) return hasFrom.get() ? mixBox(from.get(), endBox.get(), p.get()) : endBox.get();
    if (p.get() < 1) return hasFrom.get() ? mixBox(from.get(), r, p.get()) : r;
    const shifted = { ...r, x: r.x + (focus.get() - pos.get()) * pitch };
    return draggedBox(shifted, pullFrame(pullX.get(), pullY.get(), vh));
  });
  // A renderer draws while the photo flies between its spot and its open box (not while it fades).
  const drawing = useDerivedValue<number>(() => (hasFrom.get() && (closing.get() || p.get() < 1) ? 1 : 0));

  // Reporting to the app.
  const latest = useRef(props);
  latest.current = props;
  const reported = useRef(cur);
  const report = (i: number) => {
    reported.current = i;
    setCur(i);
    latest.current.haptics?.("selection");
    latest.current.onChange?.(i);
    AccessibilityInfo.announceForAccessibility(fill(L.position, { n: i + 1, total: n }) + (items[i]?.alt ? `. ${items[i].alt}` : ""));
  };
  const opened = (i: number) => latest.current.onOpen?.(i);
  const closed = (i: number) => { setVisible(false); latest.current.onClose?.(i); };

  // The spot photo i would spring from or back to, measured now; null to fade.
  const spot = (src: OriginSource | null, i: number, still: boolean): Box | null => {
    "worklet";
    if (!src || still) return null;
    const m = measureOrigin(src.ref, src.rect, i);
    return m && onScreen({ left: m.x, top: m.y, width: m.w, height: m.h }, vw, vh) ? m : null;
  };
  const startOpen = (src: OriginSource | null, i: number, still: boolean) => {
    "worklet";
    const m = spot(src, i, still);
    if (m) from.set(m);
    hasFrom.set(m ? 1 : 0);
    hidden.set(i);
    p.set(0);
    p.set(withTiming(1, { duration: m ? OPEN_MS : FADE_MS, easing: m ? EASE_SHEET : EASE_OUT }, (done) => { if (done) scheduleOnRN(opened, i); }));
  };
  const startClose = (src: OriginSource | null, still: boolean) => {
    "worklet";
    if (closing.get()) return;
    const i = focus.get();
    cancelAnimation(pos);
    endBox.set(focusBox.get());
    pullX.set(0);
    pullY.set(0);
    closing.set(1);
    const m = spot(src, i, still);
    if (m) from.set(m);
    hasFrom.set(m ? 1 : 0);
    p.set(withTiming(0, { duration: m ? CLOSE_MS : FADE_MS, easing: EASE_OUT }, (done) => {
      if (!done) return;
      hidden.set(-1);
      scheduleOnRN(closed, i);
    }));
  };

  const pending = useRef(-1);
  const open = (i = cur) => {
    if (visible || !n) return;
    const k = clampIndex(i, n);
    reported.current = k;
    setCur(k);
    focus.set(k);
    pos.set(k);
    pullX.set(0);
    pullY.set(0);
    closing.set(0);
    // Nothing shows until the spot is measured (the modal's first frames).
    hasFrom.set(0);
    ready.set(0);
    p.set(0);
    pending.current = k;
    setVisible(true);
  };
  // The modal is on screen: measure the spot and unfurl.
  const onShow = () => {
    if (pending.current < 0) return;
    const k = pending.current;
    pending.current = -1;
    scheduleOnUI(startOpen, latest.current.origins?.current ?? null, k, reduced);
  };
  const close = () => {
    if (!visible) return;
    latest.current.haptics?.("light");
    scheduleOnUI(startClose, latest.current.origins?.current ?? null, reduced);
  };
  // A cut waits for the photo's view to mount (the next commit), so nothing blank shows.
  const jump = useRef(-1);
  useEffect(() => { if (jump.current === cur) { pos.set(cur); jump.current = -1; } }, [cur]);
  // Move to photo i: one step slides (with a spring), a jump cuts (the filmstrip runs through many).
  const show = (i: number, how: "slide" | "cut" = "cut") => {
    const k = clampIndex(i, n);
    if (k === cur) return;
    focus.set(k);
    hidden.set(visible ? k : -1);
    if (how === "slide" && !reduced) pos.set(withSpring(k, SNAP));
    else jump.current = k;
    report(k);
  };
  const step = (d: 1 | -1) => show(cur + d, "slide");

  // The app moved the photo (a Procession under it, or code).
  useEffect(() => {
    if (props.index === undefined || props.index === reported.current) return;
    const k = clampIndex(props.index, n);
    reported.current = k;
    if (visible) { focus.set(k); hidden.set(k); jump.current = k; }
    setCur(k);
  }, [props.index, n]);

  // Photo sizes we were not given: asked for around the photo shown.
  useEffect(() => {
    if (!visible) return;
    for (const i of [cur, cur + 1, cur - 1]) {
      const it = items[i] as { width?: number; height?: number } | undefined;
      if (!it || aspects[i] || (it.width && it.height)) continue;
      Image.getSize(fullSrc(items[i]), (w, h) => { if (w > 0 && h > 0) setAspects((a) => ({ ...a, [i]: w / h })); }, () => {});
    }
  }, [visible, cur, items]);

  const api: UnfurlApi = { index: cur, item: items[cur], close, next: () => step(1), prev: () => step(-1), show: (i) => show(i, Math.abs(i - cur) === 1 ? "slide" : "cut") };
  const apiRef = useRef(api);
  apiRef.current = api;
  useImperativeHandle(ref, () => ({
    open: (i?: number) => openRef.current(i),
    get isOpen() { return visibleRef.current; },
    get index() { return apiRef.current.index; },
    get item() { return apiRef.current.item; },
    close: () => apiRef.current.close(),
    next: () => apiRef.current.next(),
    prev: () => apiRef.current.prev(),
    show: (i: number) => apiRef.current.show(i),
  }), []);
  const openRef = useRef(open);
  openRef.current = open;
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  const gesture = useMemo(() => {
    const pan = Gesture.Pan()
      .onStart(() => {
        "worklet";
        axis.set(0);
      })
      .onUpdate((e) => {
        "worklet";
        if (closing.get() || p.get() < 1) return;
        if (!axis.get()) {
          const a = lockAxis(e.translationX, e.translationY);
          if (!a) return;
          axis.set(a === "x" ? 1 : 2);
          // A sideways drag catches the strip where it is, even mid-spring; a pull leaves it to land.
          if (a === "x") { cancelAnimation(pos); pos0.set(pos.get() + e.translationX / pitch); }
        }
        if (axis.get() === 1) {
          // The strip follows the finger 1:1; past the first or last photo it resists.
          const i = clampIndex(pos0.get(), n), dx = e.translationX;
          const more = dx < 0 ? i < n - 1 : i > 0;
          pos.set(pos0.get() - (more ? dx : Math.sign(dx) * rubber(Math.abs(dx), vw * 0.25)) / pitch);
        } else {
          pullX.set(e.translationX);
          pullY.set(e.translationY);
        }
      })
      .onEnd((e) => {
        "worklet";
        const a = axis.get();
        axis.set(0);
        if (a === 1) {
          // Project where the fling would stop, take the nearest photo, spring there with the finger's speed.
          const i = clampIndex(pos0.get(), n);
          const t = i + pickSlide((i - pos.get()) * pitch, e.velocityX, pitch, i > 0, i < n - 1);
          pos.set(reduced ? t : withSpring(t, { ...SNAP, velocity: -e.velocityX / pitch }));
          if (t !== focus.get()) { focus.set(t); hidden.set(t); scheduleOnRN(report, t); }
        } else if (a === 2) {
          if (swipeIntent(0, e.translationY, 0, e.velocityY) === "close") scheduleOnRN(close);
          else {
            pullX.set(withSpring(0, { ...SNAP, velocity: e.velocityX }));
            pullY.set(withSpring(0, { ...SNAP, velocity: e.velocityY }));
          }
        }
      });
    const tap = Gesture.Tap().maxDuration(300).onEnd((_e, ok) => { "worklet"; if (ok && p.get() >= 1 && !closing.get()) scheduleOnRN(close); });
    return Gesture.Race(pan, tap);
  }, [n, vw, vh, pitch, reduced, visible, cur]);

  const bgStyle = useAnimatedStyle(() => ({ opacity: p.get() * pullFrame(pullX.get(), pullY.get(), vh).bg }));
  // The bars come in over the last part of the opening and step aside while a pull goes on.
  const chromeStyle = useAnimatedStyle(() => {
    const bg = pullFrame(pullX.get(), pullY.get(), vh).bg;
    const k = Math.min(1, Math.max(0, (p.get() - 0.6) / 0.4)) * Math.min(1, Math.max(0, (bg - 0.85) / 0.15));
    return { opacity: closing.get() ? 0 : k };
  });

  const rSpot = toR4(props.radius ?? props.origins?.current?.radius, 16);
  const rOpen = toR4(props.openRadius, 12);
  const radii = useDerivedValue<R4>(() => {
    const r = restsSV.get()[focus.get()] ?? ZERO;
    return hasFrom.get() ? radiusAt(!!closing.get(), focusBox.get(), closing.get() ? from.get() : r, rSpot, rOpen) : rOpen;
  });

  const Renderer = reduced ? undefined : props.renderer;
  const slot = (s: Slot) => (typeof s === "function" ? s(api) : s);
  const item = items[cur];
  const windowed = [cur - 1, cur, cur + 1].filter((i) => i >= 0 && i < n);

  return (
    <Modal visible={visible} transparent animationType="none" statusBarTranslucent navigationBarTranslucent onShow={onShow} onRequestClose={close} supportedOrientations={["portrait", "landscape"]}>
      <GestureHandlerRootView style={styles.fill}>
        <View style={styles.fill} accessibilityViewIsModal accessibilityLabel={L.dialog} onAccessibilityEscape={close}>
          <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: props.backdrop ?? "#0e0e11" }, bgStyle]} />
          <GestureDetector gesture={gesture}>
            <View
              style={styles.fill}
              accessible
              accessibilityRole="adjustable"
              accessibilityLabel={fill(L.position, { n: cur + 1, total: n }) + (item?.alt ? `. ${item.alt}` : "")}
              accessibilityActions={[{ name: "increment", label: L.next }, { name: "decrement", label: L.previous }, { name: "escape", label: L.close }]}
              onAccessibilityAction={(e) => {
                const a = e.nativeEvent.actionName;
                if (a === "increment") step(1);
                else if (a === "decrement") step(-1);
                else if (a === "escape") close();
              }}
            >
              {windowed.map((i) => (
                <StagePhoto key={i} index={i} item={items[i]} rest={rests[i]} rests={restsSV} focus={focus} focusBox={focusBox} pos={pos} pitch={pitch}
                  p={p} hasFrom={hasFrom} ready={ready} drawing={drawing} drawn={!!Renderer} radii={rOpen} render={props.renderImage} />
              ))}
            </View>
          </GestureDetector>
          {Renderer && item ? (
            <View style={StyleSheet.absoluteFill} pointerEvents="none">
              <Renderer key={cur} item={item} uri={fullSrc(item)} box={focusBox} radii={radii} progress={p} active={drawing} ready={ready} width={vw} height={vh} />
            </View>
          ) : null}
          <Animated.View style={[styles.top, { top: insets.top }, chromeStyle]} pointerEvents="box-none">
            <Pressable onPress={close} accessibilityRole="button" accessibilityLabel={L.close} hitSlop={8} style={styles.round}>
              <View style={[styles.cross, { transform: [{ rotate: "45deg" }] }]} />
              <View style={[styles.cross, { transform: [{ rotate: "-45deg" }] }]} />
            </Pressable>
            <Text style={styles.counter} accessibilityElementsHidden importantForAccessibility="no">{fill(L.counter, { n: cur + 1, total: n })}</Text>
            <View style={styles.slotTop}>{props.topActions ? slot(props.topActions) : null}</View>
          </Animated.View>
          <Animated.View style={[styles.bottom, { paddingBottom: insets.bottom }, chromeStyle]} pointerEvents="box-none" onLayout={(e: LayoutChangeEvent) => setBottomH(Math.round(e.nativeEvent.layout.height) - insets.bottom)}>
            {strip ? (
              <Drumline {...(strip as Omit<DrumlineProps, "items">)} film tone="dark" items={props.items} index={cur} onChange={(i) => show(i)}
                reducedMotion={props.reducedMotion} renderImage={props.renderImage} />
            ) : null}
            {props.actions ? <View style={styles.actions}>{slot(props.actions)}</View> : null}
          </Animated.View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
});

type StagePhotoProps = {
  index: number; item: Item; rest: Box; rests: SharedValue<Box[]>; focus: SharedValue<number>; focusBox: SharedValue<Box>;
  pos: SharedValue<number>; pitch: number; p: SharedValue<number>; hasFrom: SharedValue<number>; ready: SharedValue<number>;
  drawing: SharedValue<number>; drawn: boolean; radii: R4; render?: RenderImage;
};

// One photo of the stage, laid out at its open box and transformed to where it is drawn now (FLIP: the layer
// moves and scales from its top left, the picture inside scales back so it stays undistorted and covers it).
function StagePhoto(s: StagePhotoProps) {
  const { index: i, rests, focus, focusBox, pos, pitch, p, hasFrom, ready, drawing, drawn } = s;
  const outer = useAnimatedStyle(() => {
    const r = rests.get()[i] ?? ZERO;
    const isFocus = focus.get() === i;
    const box = isFocus ? focusBox.get() : { ...r, x: r.x + (i - pos.get()) * pitch };
    const f = flipFrame(box, r);
    // The focus photo fades when it has no spot, and hides while a renderer draws it.
    const opacity = !isFocus ? 1 : drawn && drawing.get() && ready.get() ? 0 : hasFrom.get() ? 1 : p.get();
    return { opacity, transform: [{ translateX: f.tx }, { translateY: f.ty }, { scaleX: f.sx }, { scaleY: f.sy }] };
  });
  const inner = useAnimatedStyle(() => {
    const r = rests.get()[i] ?? ZERO;
    const box = focus.get() === i ? focusBox.get() : r;
    const f = flipFrame(box, r);
    return { transform: [{ scaleX: f.ix }, { scaleY: f.iy }] };
  });
  const [tl, tr, br, bl] = s.radii;
  return (
    <Animated.View style={[styles.photo, { left: s.rest.x, top: s.rest.y, width: s.rest.w, height: s.rest.h, borderTopLeftRadius: tl, borderTopRightRadius: tr, borderBottomRightRadius: br, borderBottomLeftRadius: bl }, outer]}>
      <Animated.View style={[StyleSheet.absoluteFill, inner]}>
        <ItemImage item={s.item} uri={fullSrc(s.item)} index={i} render={s.render} />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  photo: { position: "absolute", overflow: "hidden", transformOrigin: "left top" },
  top: { position: "absolute", left: 0, right: 0, height: BAR, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 8 },
  // 44 pt targets.
  round: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  cross: { position: "absolute", width: 18, height: 1.75, borderRadius: 1, backgroundColor: "#fff" },
  counter: { color: "#fff", fontSize: 15, fontWeight: "600", fontVariant: ["tabular-nums"] },
  slotTop: { minWidth: 44, minHeight: 44, alignItems: "flex-end", justifyContent: "center" },
  bottom: { position: "absolute", left: 0, right: 0, bottom: 0 },
  actions: { flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 12, minHeight: 52, paddingHorizontal: 16 },
});
