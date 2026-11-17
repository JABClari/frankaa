// What every native part shares about the picture in focus: React's copy of it, reporting a change to the app once
// (with a selection haptic), following the app's index prop without echoing its own reports back, and the
// accessibility of a strip (an adjustable element: swipe up or down to move, double tap to open).
import { useEffect, useRef, useState } from "react";
import type { AccessibilityActionEvent, AccessibilityActionInfo, AccessibilityValue } from "react-native";
import { clampIndex } from "../slider-math";
import type { HapticFn } from "./motion";

type FocusProps = { index?: number; onChange?: (index: number) => void; haptics?: HapticFn };

/**
 * React's copy of the index (re-rendered once per picture, never per frame). changed(i) reports a move made here;
 * move(i) runs when the app changes the index prop to something this part did not report.
 */
export function useFocusIndex<P extends FocusProps>(props: P, n: number, first: number, move: (i: number) => void) {
  const [current, setCurrent] = useState(first);
  const reported = useRef(first);
  const latest = useRef(props);
  latest.current = props;
  const changed = (i: number) => {
    reported.current = i;
    setCurrent(i);
    latest.current.haptics?.("selection");
    latest.current.onChange?.(i);
  };
  useEffect(() => {
    if (props.index === undefined || props.index === reported.current) return;
    const i = clampIndex(props.index, n);
    reported.current = i;
    setCurrent(i);
    move(i);
  }, [props.index, n]);
  return { current, changed, latest };
}

const ACTIONS: AccessibilityActionInfo[] = [{ name: "increment" }, { name: "decrement" }, { name: "activate" }];

/** A strip as one adjustable element: its name, where it is, and the actions. */
export function adjustable(o: { label: string; value: string; step: (d: 1 | -1) => void; activate: () => void }): {
  accessible: true; accessibilityRole: "adjustable"; accessibilityLabel: string; accessibilityValue: AccessibilityValue;
  accessibilityActions: AccessibilityActionInfo[]; onAccessibilityAction: (e: AccessibilityActionEvent) => void;
} {
  return {
    accessible: true,
    accessibilityRole: "adjustable",
    accessibilityLabel: o.label,
    accessibilityValue: { text: o.value },
    accessibilityActions: ACTIONS,
    onAccessibilityAction: (e) => {
      const name = e.nativeEvent.actionName;
      if (name === "increment") o.step(1);
      else if (name === "decrement") o.step(-1);
      else if (name === "activate") o.activate();
    },
  };
}
