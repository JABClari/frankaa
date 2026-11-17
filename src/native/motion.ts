// Motion shared by the React Native parts: the curves, the springs and the "lerp" animation. Everything here runs
// on the UI thread (Reanimated worklets); nothing animates but transform and opacity.
import { Easing, defineAnimation, type AnimationObject } from "react-native-reanimated";
import { lerpStep } from "../drumline-math";
import type { ReducedMotion } from "../shared";

/** Snap back or on after a drag: carries the finger's velocity, a touch of bounce only when it was flung. */
export const SNAP = { duration: 400, dampingRatio: 0.8 } as const;
/** The lightbox: opens on the iOS sheet curve, closes quicker with a strong ease-out, or crossfades. */
export const OPEN_MS = 360;
export const CLOSE_MS = 220;
export const FADE_MS = 200;
export const EASE_SHEET = Easing.bezier(0.32, 0.72, 0, 1);
export const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1);

/** A haptic moment: "selection" when the photo in focus changes, "light" when a close commits. */
export type Haptic = "selection" | "light";
/** Plays a haptic, for example with expo-haptics:
 *  (k) => k === "light" ? Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light) : Haptics.selectionAsync() */
export type HapticFn = (kind: Haptic) => void;

export type { ReducedMotion };

type LerpAnimation = AnimationObject<number> & { last: number };

/**
 * frankaa's "lerp" fluid as a Reanimated animation: every frame the value eases toward target at rate k (see
 * LERP_RATE), frame-rate independent, with no overshoot. Assign it again with a new target as often as needed
 * (every drag update): it carries on from where the value is. Settles within eps.
 */
export function withLerp(target: number, k: number, eps = 0.002, callback?: (finished?: boolean) => void): number {
  "worklet";
  return defineAnimation<LerpAnimation>(target, () => {
    "worklet";
    const onFrame = (a: LerpAnimation, now: number): boolean => {
      const dt = Math.min(1 / 15, Math.max(0, (now - a.last) / 1000));
      a.last = now;
      const next = lerpStep(a.current ?? target, target, dt, k);
      if (Math.abs(target - next) < eps) { a.current = target; return true; }
      a.current = next;
      return false;
    };
    const onStart = (a: LerpAnimation, value: number, now: number): void => { a.current = value; a.last = now; };
    return { onFrame, onStart, current: target, toValue: target, last: 0, callback } as LerpAnimation;
  }) as unknown as number;
}
