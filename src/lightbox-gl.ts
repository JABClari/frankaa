// The lightbox renderer: one rounded photo on a full-screen canvas, drawn where the lightbox says (its box in
// CSS pixels, its corner radius), with a displacement crossfade between two photos. Raw WebGL1, no package.
import type { Box } from "./lightbox-math";

const VERT = `
attribute vec2 p;
uniform vec4 box;
uniform vec2 view;
varying vec2 uv;
void main() {
  uv = p;
  vec2 px = box.xy + p * box.zw;
  vec2 clip = (px / view) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

const FRAG = `
precision mediump float;
varying vec2 uv;
uniform sampler2D ta;
uniform sampler2D tb;
uniform vec2 aspA;
uniform vec2 aspB;
uniform vec2 size;
uniform float radius;
uniform float mixv;
uniform float dir;
uniform float wobble;
uniform float alpha;
float hash(vec2 q) { return fract(sin(dot(q, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 q) {
  vec2 i = floor(q), f = fract(q);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
vec2 cover(vec2 t, vec2 asp) { return (t - 0.5) / asp + 0.5; }
void main() {
  vec2 q = abs(uv * size - size * 0.5) - (size * 0.5 - radius);
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
  float edge = clamp(0.5 - d, 0.0, 1.0);
  if (edge <= 0.0) discard;
  float n = noise(uv * 4.0 + dir * 1.7) - 0.5;
  float m = smoothstep(0.0, 1.0, mixv);
  vec2 shiftA = vec2(dir * m * 0.18 + n * m * wobble, n * m * wobble * 0.5);
  vec2 shiftB = vec2(-dir * (1.0 - m) * 0.18 + n * (1.0 - m) * wobble, n * (1.0 - m) * wobble * 0.5);
  vec4 a = texture2D(ta, cover(uv + shiftA, aspA));
  vec4 b = texture2D(tb, cover(uv + shiftB, aspB));
  gl_FragColor = vec4(mix(a, b, m).rgb, 1.0) * edge * alpha;
}`;

export type Frame = { box: Box; radius: number; a: number; b: number; mix: number; dir: number; wobble: number; alpha: number };
export type Renderer = {
  /** The photo's aspect (w / h) once loaded, else null. */
  aspect(i: number): number | null;
  /** Resolves true when photo i can be drawn, false when it cannot (failed or tainted). */
  ready(i: number): Promise<boolean>;
  draw(f: Frame): void;
  resize(): void;
  destroy(): void;
};

/** True when this browser can draw the lightbox with WebGL. */
export function supported(): boolean {
  if (typeof document === "undefined") return false;
  try { return !!document.createElement("canvas").getContext("webgl"); } catch { return false; }
}

/** A renderer on this canvas for these photos, or null when WebGL is not there. */
export function createRenderer(canvas: HTMLCanvasElement, srcs: string[]): Renderer | null {
  let gl: WebGLRenderingContext | null = null;
  try { gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: true }) as WebGLRenderingContext | null; } catch { gl = null; }
  if (!gl) return null;
  const g = gl;
  let prog: WebGLProgram;
  try {
    const sh = (type: number, src: string) => {
      const s = g.createShader(type)!;
      g.shaderSource(s, src); g.compileShader(s);
      if (!g.getShaderParameter(s, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(s) || "shader");
      return s;
    };
    prog = g.createProgram()!;
    g.attachShader(prog, sh(g.VERTEX_SHADER, VERT)); g.attachShader(prog, sh(g.FRAGMENT_SHADER, FRAG));
    g.linkProgram(prog);
    if (!g.getProgramParameter(prog, g.LINK_STATUS)) return null;
  } catch { return null; }
  g.useProgram(prog);
  const buf = g.createBuffer();
  g.bindBuffer(g.ARRAY_BUFFER, buf);
  g.bufferData(g.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), g.STATIC_DRAW);
  const loc = g.getAttribLocation(prog, "p");
  g.enableVertexAttribArray(loc);
  g.vertexAttribPointer(loc, 2, g.FLOAT, false, 0, 0);
  const u = (n: string) => g.getUniformLocation(prog, n);
  const U = { box: u("box"), size: u("size"), view: u("view"), ta: u("ta"), tb: u("tb"), aspA: u("aspA"), aspB: u("aspB"), radius: u("radius"), mixv: u("mixv"), dir: u("dir"), wobble: u("wobble"), alpha: u("alpha") };
  g.uniform1i(U.ta, 0); g.uniform1i(U.tb, 1);
  g.enable(g.BLEND); g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA);

  const tex: (WebGLTexture | null)[] = srcs.map(() => null);
  const asp: (number | null)[] = srcs.map(() => null);
  const loads = new Map<number, Promise<boolean>>();
  const ready = (i: number): Promise<boolean> => {
    if (i < 0 || i >= srcs.length) return Promise.resolve(false);
    let p = loads.get(i);
    if (!p) {
      p = new Promise<boolean>((resolve) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.decoding = "async";
        img.onload = () => {
          const t = g.createTexture();
          g.bindTexture(g.TEXTURE_2D, t);
          g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
          g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
          g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
          g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
          try { g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, img); } catch { resolve(false); return; }
          tex[i] = t; asp[i] = img.naturalWidth / Math.max(1, img.naturalHeight);
          resolve(true);
        };
        img.onerror = () => resolve(false);
        img.src = srcs[i];
      });
      loads.set(i, p);
    }
    return p;
  };

  let vw = 1, vh = 1;
  const resize = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    vw = canvas.clientWidth || window.innerWidth; vh = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.round(vw * dpr); canvas.height = Math.round(vh * dpr);
    g.viewport(0, 0, canvas.width, canvas.height);
  };
  resize();

  // Cover-fit scale for photo i in box b.
  const fit = (i: number, b: Box): [number, number] => {
    const ia = asp[i] ?? b.w / b.h, ba = b.w / Math.max(1, b.h);
    return ia > ba ? [ia / ba, 1] : [1, ba / ia];
  };
  const draw = (f: Frame) => {
    g.clearColor(0, 0, 0, 0); g.clear(g.COLOR_BUFFER_BIT);
    const a = tex[f.a] ?? tex[f.b], b = tex[f.b] ?? tex[f.a];
    if (!a || !b) return;
    g.activeTexture(g.TEXTURE0); g.bindTexture(g.TEXTURE_2D, a);
    g.activeTexture(g.TEXTURE1); g.bindTexture(g.TEXTURE_2D, b);
    g.uniform4f(U.box, f.box.x, f.box.y, f.box.w, f.box.h);
    g.uniform2f(U.size, f.box.w, f.box.h);
    g.uniform2f(U.view, vw, vh);
    g.uniform2f(U.aspA, ...fit(f.a, f.box)); g.uniform2f(U.aspB, ...fit(f.b, f.box));
    g.uniform1f(U.radius, Math.min(f.radius, f.box.w / 2, f.box.h / 2));
    g.uniform1f(U.mixv, f.mix); g.uniform1f(U.dir, f.dir); g.uniform1f(U.wobble, f.wobble); g.uniform1f(U.alpha, f.alpha);
    g.drawArrays(g.TRIANGLES, 0, 6);
  };
  return {
    aspect: (i) => asp[i] ?? null, ready, draw, resize,
    destroy: () => { tex.forEach((t) => t && g.deleteTexture(t)); g.deleteBuffer(buf); g.deleteProgram(prog); },
  };
}
