// drumline's WebGL renderer for fluid: "bend". Each card is a strip of quads (a mesh with columns) drawn on one
// canvas; the vertex shader bulges the row around its middle in proportion to the strip's speed, so the tops and
// bottoms of the cards trace one smooth curve (a sheet bending toward you), and flattens as the strip slows. The
// fragment shader draws rounded corners, cover-fits the picture, and fades colour and light away from the focus.
// Raw WebGL1, no package. The caller falls back to the DOM bend when this returns null or reports it is slow.

import { uploadPhoto } from "./gl-fit";

const COLS = 16;
// Cards are small: a picture is uploaded at 1024 px on its longest side at most (gl-fit.ts).
const maxSide = 1024;

const VERT = `attribute vec2 p;
uniform vec4 box;     // x, y, w, h in CSS px (already scaled for focus)
uniform vec2 view;    // canvas size in CSS px
uniform float amt;    // bulge: 0 flat, about 0.2 at a fast fling
uniform float cx;     // the bulge's centre (px)
uniform float reach;  // how far it spreads (px)
uniform float mid;    // the row's middle (px)
varying vec2 uv;
void main() {
  uv = p;
  vec2 px = box.xy + p * box.zw;
  float t = clamp(1.0 - abs(px.x - cx) / reach, 0.0, 1.0);
  float m = 1.0 + amt * t * t * (3.0 - 2.0 * t);
  px.y = mid + (px.y - mid) * m;
  vec2 clip = (px / view) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

const FRAG = `precision mediump float;
varying vec2 uv;
uniform sampler2D img;
uniform vec2 asp;      // cover fit
uniform vec2 size;     // card size in px (before the bulge)
uniform float radius;
uniform float alpha;
uniform float sat;     // 1 full colour, lower is greyer
uniform float light;   // 1 full light, lower is dimmer
uniform vec3 fill;     // placeholder colour until the picture arrives
uniform float ready;
void main() {
  vec2 q = abs(uv * size - size * 0.5) - (size * 0.5 - radius);
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
  float edge = clamp(0.5 - d, 0.0, 1.0);
  if (edge <= 0.0) discard;
  vec3 c = ready > 0.5 ? texture2D(img, (uv - 0.5) / asp + 0.5).rgb : fill;
  float g = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(g), c, sat) * light;
  gl_FragColor = vec4(c, 1.0) * edge * alpha;
}`;

export type BendCard = { i: number; x: number; y: number; w: number; h: number; radius: number; alpha: number; sat: number; light: number };
export type BendRenderer = {
  draw(cards: BendCard[], amt: number, cx: number, reach: number, mid: number): void;
  resize(w: number, h: number): void;
  /** True once picture i is uploaded. */
  has(i: number): boolean;
  destroy(): void;
};

/** A bend renderer on this canvas for these picture addresses, or null without WebGL. onFail(i) reports a picture
 *  that could not be drawn (failed, or cross-origin without CORS headers). */
export function createBend(canvas: HTMLCanvasElement, srcs: string[], onFail: (i: number) => void, onReady: (i: number) => void = () => {}): BendRenderer | null {
  let gl: WebGLRenderingContext | null = null;
  try { gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: true }) as WebGLRenderingContext | null; } catch { gl = null; }
  if (!gl) return null;
  const g = gl;
  const sh = (type: number, src: string) => {
    const s = g.createShader(type)!;
    g.shaderSource(s, src); g.compileShader(s);
    if (!g.getShaderParameter(s, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(s) || "shader");
    return s;
  };
  let prog: WebGLProgram;
  try {
    prog = g.createProgram()!;
    g.attachShader(prog, sh(g.VERTEX_SHADER, VERT)); g.attachShader(prog, sh(g.FRAGMENT_SHADER, FRAG));
    g.linkProgram(prog);
    if (!g.getProgramParameter(prog, g.LINK_STATUS)) return null;
  } catch { return null; }
  g.useProgram(prog);
  // One mesh for every card: COLS columns, two rows of vertices, as a triangle strip.
  const v: number[] = [];
  for (let c = 0; c <= COLS; c++) { const x = c / COLS; v.push(x, 0, x, 1); }
  const buf = g.createBuffer();
  g.bindBuffer(g.ARRAY_BUFFER, buf);
  g.bufferData(g.ARRAY_BUFFER, new Float32Array(v), g.STATIC_DRAW);
  const loc = g.getAttribLocation(prog, "p");
  g.enableVertexAttribArray(loc);
  g.vertexAttribPointer(loc, 2, g.FLOAT, false, 0, 0);
  const U: Record<string, WebGLUniformLocation | null> = {};
  for (const n of ["box", "view", "amt", "cx", "reach", "mid", "img", "asp", "size", "radius", "alpha", "sat", "light", "fill", "ready"]) U[n] = g.getUniformLocation(prog, n);
  g.uniform1i(U.img, 0);
  g.uniform3f(U.fill, 0.17, 0.16, 0.15);
  g.enable(g.BLEND); g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA);

  let dead = false;
  const tex: (WebGLTexture | null)[] = srcs.map(() => null);
  const dims: ([number, number] | null)[] = srcs.map(() => null);
  srcs.forEach((src, i) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.src = src;
    (typeof img.decode === "function" ? img.decode() : new Promise((r, j) => { img.onload = r; img.onerror = j; })).then(() => {
      if (dead) return;
      const t = g.createTexture();
      g.bindTexture(g.TEXTURE_2D, t);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
      g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
      g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      if (!uploadPhoto(g, img, maxSide)) { g.deleteTexture(t); onFail(i); return; }
      tex[i] = t; dims[i] = [img.naturalWidth, Math.max(1, img.naturalHeight)];
      onReady(i);
    }, () => { if (!dead) onFail(i); });
  });

  let vw = 1, vh = 1;
  const resize = (w: number, h: number) => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    vw = Math.max(1, w); vh = Math.max(1, h);
    canvas.width = Math.round(vw * dpr); canvas.height = Math.round(vh * dpr);
    canvas.style.width = `${vw}px`; canvas.style.height = `${vh}px`;
    g.viewport(0, 0, canvas.width, canvas.height);
  };

  return {
    draw(cards, amt, cx, reach, mid) {
      g.clearColor(0, 0, 0, 0); g.clear(g.COLOR_BUFFER_BIT);
      g.uniform2f(U.view, vw, vh);
      g.uniform1f(U.amt, amt); g.uniform1f(U.cx, cx); g.uniform1f(U.reach, reach); g.uniform1f(U.mid, mid);
      for (const c of cards) {
        const t = tex[c.i], d = dims[c.i];
        g.uniform4f(U.box, c.x, c.y, c.w, c.h);
        g.uniform2f(U.size, c.w, c.h);
        g.uniform1f(U.radius, Math.min(c.radius, c.w / 2, c.h / 2));
        g.uniform1f(U.alpha, c.alpha); g.uniform1f(U.sat, c.sat); g.uniform1f(U.light, c.light);
        if (t && d) {
          const ia = d[0] / d[1], ba = c.w / Math.max(1, c.h);
          g.uniform2f(U.asp, ia > ba ? ia / ba : 1, ia > ba ? 1 : ba / ia);
          g.activeTexture(g.TEXTURE0); g.bindTexture(g.TEXTURE_2D, t);
          g.uniform1f(U.ready, 1);
        } else g.uniform1f(U.ready, 0);
        g.drawArrays(g.TRIANGLE_STRIP, 0, (COLS + 1) * 2);
      }
    },
    resize,
    has: (i) => !!tex[i],
    destroy() {
      dead = true;
      tex.forEach((t) => t && g.deleteTexture(t));
      g.deleteBuffer(buf); g.deleteProgram(prog);
    },
  };
}
