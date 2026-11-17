// frankaa/native/skia: the unfurl drawn by a shader on @shopify/react-native-skia (a RuntimeEffect), for apps that
// have Skia. Pass it as Unfurl's renderer; apps without Skia never import this file and get the plain views.
//   import { skiaUnfurl } from "frankaa/native/skia";
//   <Unfurl renderer={skiaUnfurl} ... />
// Every uniform is a derived value, so frames are drawn on the UI thread with no React render.
import { useEffect } from "react";
import { StyleSheet } from "react-native";
import { useDerivedValue } from "react-native-reanimated";
import { Canvas, ImageShader, Rect, Shader, Skia, useImage, type SkRuntimeEffect } from "@shopify/react-native-skia";
import { UNFURL_SKSL } from "./unfurl-sksl";
import type { UnfurlRendererProps } from "./Unfurl";

let effect: SkRuntimeEffect | null | undefined;
/** The compiled unfurl shader, or null when this Skia cannot compile it (the views then draw). */
export function unfurlEffect(): SkRuntimeEffect | null {
  if (effect === undefined) effect = Skia.RuntimeEffect.Make(UNFURL_SKSL);
  return effect;
}

export function SkiaUnfurl({ uri, box, radii, progress, active, ready, width, height }: UnfurlRendererProps) {
  const image = useImage(uri);
  const fx = unfurlEffect();
  const iw = image?.width() ?? 1;
  const ih = image?.height() ?? 1;
  useEffect(() => {
    ready.set(image && fx ? 1 : 0);
    return () => ready.set(0);
  }, [image, fx]);
  const uniforms = useDerivedValue(() => {
    const b = box.get(), r = radii.get();
    return { imageSize: [iw, ih], box: [b.x, b.y, b.w, b.h], radii: [r[0], r[1], r[2], r[3]], progress: progress.get(), alpha: active.get() };
  });
  if (!image || !fx) return null;
  return (
    <Canvas style={[StyleSheet.absoluteFill, { width, height }]}>
      <Rect x={0} y={0} width={width} height={height}>
        <Shader source={fx} uniforms={uniforms}>
          <ImageShader image={image} />
        </Shader>
      </Rect>
    </Canvas>
  );
}

/** Unfurl's renderer prop: the unfurl shader on Skia. */
export const skiaUnfurl = SkiaUnfurl;
export { UNFURL_SKSL };
