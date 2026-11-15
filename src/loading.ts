// frankaa/loading: two more loading materials for the lightbox, kept out of its bundle. Importing this file
// registers them, so loading: "frost" and loading: "liquid" work; or pass the objects themselves:
//   import "frankaa/loading";                  unfurl(items, { loading: "frost" })
//   import { liquid } from "frankaa/loading";  unfurl(items, { loading: liquid })
// They follow the loading shader contract in loading-shaders.ts (and use its shared noise and blur helpers).
import { HEAD, registerLoading } from "./loading-shaders";
import type { LoadingShader } from "./loading-math";

// Etched glass over the preview, and a slow band of light refracting through it.
export const frost: LoadingShader = { fragment: HEAD + `
void main() {
  vec2 uv = vUv;
  float t = uTime;
  vec2 g = vec2(fbm(uv * 38.0 + 3.0), fbm(uv * 38.0 + 9.0)) - 0.5;
  float bandPos = fract((uv.x + uv.y * 0.55) * 0.62 - t * 0.16);
  float band = smoothstep(0.16, 0.0, abs(bandPos - 0.5));
  vec2 bend = g * (0.028 + band * 0.05);
  vec3 base = uHasPreview > 0.5 ? blurPrev(uv + bend, 0.006) : neutral(uv + bend);
  float etch = fbm(uv * 90.0) - 0.5;
  vec3 col = base * (0.8 + etch * 0.18) + band * vec3(0.3, 0.31, 0.33) + grain() * 0.05;
  col += smoothstep(0.02, 0.0, abs(bandPos - 0.5)) * 0.12;
  gl_FragColor = vec4(dim(col), 1.0);
}` };

// The preview flowing under a slow liquid surface: a domain-warped flow, with highlights from its slope.
export const liquid: LoadingShader = { fragment: HEAD + `
void main() {
  vec2 uv = vUv;
  float t = uTime;
  vec2 q = vec2(fbm(uv * 3.0 + t * 0.08), fbm(uv * 3.0 + vec2(5.2, 1.3) - t * 0.07));
  vec2 r = vec2(fbm(uv * 3.0 + 4.0 * q + vec2(1.7, 9.2) + t * 0.05), fbm(uv * 3.0 + 4.0 * q + vec2(8.3, 2.8)));
  vec2 w = (r - 0.5) * 0.16;
  vec3 base = uHasPreview > 0.5 ? blurPrev(uv + w, 0.004) : neutral(uv + w * 2.0);
  float e = 0.01;
  float f0 = fbm(uv * 3.0 + 4.0 * q);
  vec2 grad = vec2(fbm(uv * 3.0 + 4.0 * q + vec2(e, 0.0)) - f0, fbm(uv * 3.0 + 4.0 * q + vec2(0.0, e)) - f0) / e;
  vec3 nrm = normalize(vec3(-grad * 0.22, 1.0));
  float spec = pow(max(0.0, dot(reflect(-normalize(vec3(0.35, 0.55, 1.0)), nrm), vec3(0.0, 0.0, 1.0))), 60.0);
  float rim = pow(1.0 - nrm.z, 2.0) * 0.9;
  vec3 col = base * (0.85 + rim * 0.2) + spec * 0.75 + rim * 0.12;
  gl_FragColor = vec4(dim(col), 1.0);
}` };

registerLoading("frost", frost);
registerLoading("liquid", liquid);

export { registerLoading };
export type { LoadingShader };
