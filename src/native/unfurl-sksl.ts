// The unfurl shader in SkSL (Skia's shading language), for frankaa/native/skia. It is the web lightbox's box shader
// (lightbox-gl.ts: the photo cover-fitted into a box with four rounded corners, antialiased on its edge) with the
// unfurl on top: while the photo flies between its spot and its open box it ripples softly, as if unrolling, and
// lies flat at both ends. Pure, so it can be compiled and checked anywhere Skia runs.
//
// Uniforms: box (x, y, w, h in pt), radii (top left, top right, bottom right, bottom left), progress (0 at the spot,
// 1 open), imageSize (the image's pixels), alpha. The child shader `image` samples the photo in image pixels.
export const UNFURL_SKSL: string = `
uniform shader image;
uniform float2 imageSize;
uniform float4 box;
uniform float4 radii;
uniform float progress;
uniform float alpha;

float2 coverUv(float2 uv, float2 ts, float2 rs) {
  float ra = rs.x / rs.y;
  float ta = ts.x / ts.y;
  return (uv - 0.5) * float2(min(1.0, ra / ta), min(1.0, ta / ra)) + 0.5;
}
float2 mirrorUv(float2 t) { return 1.0 - abs(1.0 - mod(abs(t), 2.0)); }
float hash(float2 q) { return fract(sin(dot(q, float2(127.1, 311.7))) * 43758.5453); }
float noise(float2 q) {
  float2 i = floor(q);
  float2 f = fract(q);
  float2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + float2(1.0, 0.0)), u.x), mix(hash(i + float2(0.0, 1.0)), hash(i + float2(1.0, 1.0)), u.x), u.y);
}

half4 main(float2 p) {
  if (alpha <= 0.0) { return half4(0.0); }
  float2 size = max(box.zw, float2(1.0));
  float2 c = p - box.xy - size * 0.5;
  float r = c.x < 0.0 ? (c.y < 0.0 ? radii.x : radii.w) : (c.y < 0.0 ? radii.y : radii.z);
  r = min(r, min(size.x, size.y) * 0.5);
  float2 q = abs(c) - (size * 0.5 - r);
  float d = length(max(q, float2(0.0))) + min(max(q.x, q.y), 0.0) - r;
  float edge = clamp(0.5 - d, 0.0, 1.0);
  if (edge <= 0.0) { return half4(0.0); }
  float2 uv = (p - box.xy) / size;
  // The unfurl: strongest half way, nothing at either end.
  float k = sin(clamp(progress, 0.0, 1.0) * 3.14159265);
  float n = (noise(uv * 4.0 + 1.7) - 0.5) * 0.06;
  float curl = sin(uv.x * 3.14159265) * (1.0 - uv.y) * 0.035;
  uv += float2(n, n * 0.5 + curl) * k;
  float2 t = mirrorUv(coverUv(uv, imageSize, size));
  return image.eval(t * imageSize) * half(edge * alpha);
}
`;
