// The picture inside every part. A plain React Native Image by default; renderImage swaps in your own (expo-image,
// a cached image component...). It fills its box and is never animated itself: its parent is.
import type { ReactNode } from "react";
import { Image, StyleSheet, View } from "react-native";
import { isColor, type Item } from "../items";

/** Draws one picture filling its box (cover). uri is the file this part shows for the item. */
export type RenderImage = (p: { item: Item; uri: string; index: number }) => ReactNode;

export function ItemImage({ item, uri, index, render }: { item: Item; uri: string; index: number; render?: RenderImage }) {
  const bg = item.placeholder && isColor(item.placeholder) ? item.placeholder : undefined;
  return (
    <View style={[StyleSheet.absoluteFill, bg ? { backgroundColor: bg } : null]} pointerEvents="none">
      {render ? render({ item, uri, index }) : <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityIgnoresInvertColors />}
    </View>
  );
}
