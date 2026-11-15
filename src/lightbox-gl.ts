// The WebGL renderer, on one full-screen canvas:
// - at rest, while springing and while swiping, each photo is drawn straight from its texture into a rounded box
//   (one cheap pass); a sideways swipe draws the neighbours beside it, like a strip of photos;
// - only while an effect runs (a key or button move, or a swipe, where the finger drives the effect's progress)
//   does the effect shader draw the two photos into an offscreen texture first, which is then drawn into the box.
//   A swipe falls back to the strip past the first or last photo, for videos, and with swipe: "strip".
// - a move never waits for the next photo: when it is not on the GPU yet, the box takes its shape at once and shows
//   the loading material (loading-shaders.ts) over a blurred preview, drawn offscreen at a capped size; the photo
//   then dissolves in through noise, in place. Only the latest move ever changes the picture.
// Photos are decoded off the main thread (img.decode()) before they are uploaded, and only the current photo and
// its neighbours are uploaded, the neighbours when the browser is idle (at once after a jump). Raw WebGL1, no package.
import { containBox, neighbours, radiusAt, stepBox, stripStep, draggedBox, STRIP_GAP, SPRING_CLOSE, SPRING_OPEN, type Box, type LoadStatus, type R4, type Stage, type StageCtx, type StageSource } from "./lightbox-math";
import { PRELUDE, easingFn, uniformKind, type Effect, type UniformValue } from "./effects";
import { maxTextureSide, previewCanvas, uploadPhoto } from "./gl-fit";
import { LOAD_GRACE_MS, frameAspect, latest, noiseBytes, revealProgress, type LoadingShader } from "./loading-math";
import { isCrossOrigin } from "./shared";

const EFFECT_VERT = `attribute vec2 p;
varying vec2 vUv;
void main() { vUv = p; gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }`;

const BOX_VERT = `attribute vec2 p;
uniform vec4 box;
uniform vec2 view;
varying vec2 uv;
void main() {
  uv = p;
  vec2 px = box.xy + p * box.zw;
  vec2 clip = (px / view) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

// Draws a texture into a rounded box: a photo cover-fitted (asp), or an offscreen result (part). reveal below 1
// lets the photo through only where noise has opened up: the dissolve over a loading material.
const BOX_FRAG = `precision mediump float;
varying vec2 uv;
uniform sampler2D img;
uniform sampler2D noise;
uniform vec2 asp;
uniform vec2 part;
uniform vec2 size;
uniform vec4 radius;
uniform float alpha;
uniform float reveal;
float n(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  return texture2D(noise, (i + f * f * (3.0 - 2.0 * f) + 0.5) / 64.0).r;
}
void main() {
  vec2 c = uv * size - size * 0.5;
  float r = c.x < 0.0 ? (c.y < 0.0 ? radius.x : radius.w) : (c.y < 0.0 ? radius.y : radius.z);
  vec2 q = abs(c) - (size * 0.5 - r);
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  float edge = clamp(0.5 - d, 0.0, 1.0);
  if (edge <= 0.0) discard;
  float a = edge * alpha;
  if (reveal < 1.0) {
    float m = (n(uv * 7.0 + 2.0) * 0.5 + n(uv * 14.0 + 5.0) * 0.25 + n(uv * 28.0 + 9.0) * 0.125) * 0.8 + uv.x * 0.15 + 0.05;
    a *= smoothstep(m - 0.08, m + 0.08, reveal * 1.05);
  }
  gl_FragColor = vec4(texture2D(img, ((uv - 0.5) / asp + 0.5) * part).rgb, 1.0) * a;
}`;

const FADE_MS = 160;
const PLAIN_MS = 260;
const NOISE = 64;
/** The loading material is drawn at most this many texels a side (it is soft by nature), then scaled into the box. */
const MAT_MAX = 1024;

/** True when this browser can draw the lightbox with WebGL. */
export function supported(): boolean {
  if (typeof document === "undefined") return false;
  try { return !!document.createElement("canvas").getContext("webgl"); } catch { return false; }
}

/** Run when the browser is idle (or soon, where it has no idle callback). */
const idle = (f: () => void) => {
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(f, { timeout: 300 }); else setTimeout(f, 50);
};
const sleep = (ms: number) => new Promise<"wait">((r) => setTimeout(() => r("wait"), ms));

type GlError = { reason: "webgl" | "shader"; message: string };
/** A WebGL stage on this canvas, or the reason there cannot be one (no WebGL, or the effect did not compile).
 *  warning: your loading shader did not compile, so the built-in one is used. */
type Built = { stage: Stage; error?: undefined; warning?: GlError } | { stage?: undefined; error: GlError };

/** A photo to draw: its address, srcset and sizes so the browser picks the right file, and its preview. */
export type GlSource = StageSource;
/** The loading material: a fragment shader (built-in or yours), your uniforms, and the built-in to use if yours
 *  does not compile. */
export type GlLoading = { fragment: string; uniforms?: Record<string, number | number[]>; fallback?: string };

/** What a load came to: on the GPU, failed, or a photo WebGL cannot use (no CORS headers, a refused upload). */
type Loaded = "ok" | "failed" | "fallback";
/** A texture standing for a photo this frame: its size (for coverUv) and its cover fit in the box. */
type Face = { t: WebGLTexture; size: [number, number]; asp: [number, number] };

const clean = (e: unknown) => String((e as Error).message).replace(/\0/g, "").trim();

export function createGlStage(canvas: HTMLCanvasElement, sources: GlSource[], effect: Effect, ctx: StageCtx, loading: GlLoading): Built {
  const srcs = sources.map((x) => x.src);
  let gl: WebGLRenderingContext | null = null;
  try { gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: true }) as WebGLRenderingContext | null; } catch { gl = null; }
  if (!gl) return { error: { reason: "webgl", message: "WebGL is not available" } };
  const g = gl;

  const shaders: WebGLShader[] = [];
  const program = (vs: string, fs: string): WebGLProgram => {
    const sh = (type: number, src: string) => {
      const s = g.createShader(type);
      if (!s) throw new Error("could not create a shader");
      shaders.push(s);
      g.shaderSource(s, src); g.compileShader(s);
      if (!g.getShaderParameter(s, g.COMPILE_STATUS)) throw new Error(g.getShaderInfoLog(s) || "the shader did not compile");
      return s;
    };
    const p = g.createProgram();
    if (!p) throw new Error("could not create a program");
    g.attachShader(p, sh(g.VERTEX_SHADER, vs)); g.attachShader(p, sh(g.FRAGMENT_SHADER, fs));
    g.linkProgram(p);
    if (!g.getProgramParameter(p, g.LINK_STATUS)) throw new Error(g.getProgramInfoLog(p) || "the shader did not link");
    return p;
  };
  const fragOf = (f: string) => PRELUDE + "\n#line 1\n" + f;
  let fx: WebGLProgram, bx: WebGLProgram, lm: WebGLProgram;
  try { bx = program(BOX_VERT, BOX_FRAG); } catch (e) { return { error: { reason: "webgl", message: clean(e) } }; }
  try { fx = program(EFFECT_VERT, fragOf(effect.fragment)); } catch (e) { g.deleteProgram(bx); return { error: { reason: "shader", message: clean(e) } }; }
  // The loading material: yours, or the built-in when yours does not compile (reported as a warning).
  let warning: GlError | undefined;
  let matUniforms = loading.uniforms ?? {};
  try { lm = program(EFFECT_VERT, fragOf(loading.fragment)); } catch (e) {
    if (!loading.fallback) { g.deleteProgram(bx); g.deleteProgram(fx); return { error: { reason: "webgl", message: clean(e) } }; }
    warning = { reason: "shader", message: clean(e) };
    matUniforms = {};
    try { lm = program(EFFECT_VERT, fragOf(loading.fallback)); } catch (e2) { g.deleteProgram(bx); g.deleteProgram(fx); return { error: { reason: "webgl", message: clean(e2) } }; }
  }

  const buf = g.createBuffer();
  g.bindBuffer(g.ARRAY_BUFFER, buf);
  g.bufferData(g.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), g.STATIC_DRAW);
  let bound: WebGLProgram | null = null;
  const bind = (p: WebGLProgram) => {
    if (bound === p) return;
    bound = p;
    g.useProgram(p);
    const loc = g.getAttribLocation(p, "p");
    g.enableVertexAttribArray(loc);
    g.vertexAttribPointer(loc, 2, g.FLOAT, false, 0, 0);
  };
  const locs = (p: WebGLProgram, names: string[]) => {
    const out: Record<string, WebGLUniformLocation | null> = {};
    for (const n of names) out[n] = g.getUniformLocation(p, n);
    return out;
  };
  const F = locs(fx, ["uFrom", "uTo", "uProgress", "uResolution", "uFromSize", "uToSize", "uTime", "uDirection", ...Object.keys(effect.uniforms ?? {})]);
  const M = locs(lm, ["uPreview", "uNoise", "uHasPreview", "uTime", "uResolution", "uFailed", ...Object.keys(matUniforms)]);
  const B = locs(bx, ["box", "view", "img", "noise", "asp", "part", "size", "radius", "alpha", "reveal"]);
  // Your uniforms, set by kind: a number is a float, 2 to 4 numbers a vec2 to vec4; anything else is skipped.
  const setUniforms = (L: Record<string, WebGLUniformLocation | null>, u: Record<string, UniformValue | number[]>) => {
    for (const [k, v] of Object.entries(u)) {
      const kind = uniformKind(v as UniformValue), loc = L[k];
      if (!kind || !loc) continue;
      if (kind === "1f") g.uniform1f(loc, v as number);
      else if (kind === "2fv") g.uniform2fv(loc, v as number[]);
      else if (kind === "3fv") g.uniform3fv(loc, v as number[]);
      else g.uniform4fv(loc, v as number[]);
    }
  };

  const texture = (wrap: number = g.CLAMP_TO_EDGE) => {
    const t = g.createTexture();
    g.bindTexture(g.TEXTURE_2D, t);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, wrap);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, wrap);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
    return t;
  };
  // The noise tile the materials and the dissolve sample (it repeats, so it is a power of two).
  const noiseTex = texture(g.REPEAT)!;
  g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, NOISE, NOISE, 0, g.RGBA, g.UNSIGNED_BYTE, noiseBytes(NOISE));

  const maxSide = maxTextureSide(g);
  const live = (i: number) => sources[i]?.live !== false;

  // Photos load with crossOrigin="anonymous": a cross-origin photo without CORS headers fails to load (it never
  // taints the canvas). Asked again without it, one that then loads was a CORS problem ("fallback": the lightbox
  // switches to CSS and reports it); one that still fails did not load at all ("failed": the frame says so). Each
  // is decoded off the main thread before the upload, so the upload does not stall a frame with a JPEG decode.
  const tex: (WebGLTexture | null)[] = srcs.map(() => null);
  const dims: ([number, number] | null)[] = srcs.map(() => null);
  const loads = new Map<number, Promise<Loaded>>();
  const ready = (i: number): Promise<Loaded> => {
    if (i < 0 || i >= srcs.length) return Promise.resolve("failed");
    let p = loads.get(i);
    if (!p) {
      p = new Promise<Loaded>((resolve) => {
        const s = sources[i];
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.decoding = "async";
        const upload = () => {
          if (dead) { resolve("failed"); return; }
          if (tex[i]) { resolve("ok"); return; }
          const t = texture();
          g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          // Big originals are drawn down to the screen's size first (gl-fit.ts); a refused upload falls back to CSS.
          if (!uploadPhoto(g, img, maxSide)) { g.deleteTexture(t); resolve("fallback"); return; }
          tex[i] = t; dims[i] = [img.naturalWidth, Math.max(1, img.naturalHeight)];
          resolve("ok");
        };
        const fail = () => {
          if (!isCrossOrigin(s.src, location.href)) { resolve("failed"); return; }
          const probe = new Image();
          probe.onload = () => resolve("fallback");
          probe.onerror = () => resolve("failed");
          if (s.srcset) { probe.sizes = s.sizes || "100vw"; probe.srcset = s.srcset; }
          probe.src = s.src;
        };
        img.onerror = fail;
        if (s.srcset) { img.sizes = s.sizes || "100vw"; img.srcset = s.srcset; }
        img.src = srcs[i];
        (typeof img.decode === "function" ? img.decode() : new Promise((r, j) => { img.onload = r; img.onerror = j; })).then(upload, () => { img.onerror = null; fail(); });
      });
      loads.set(i, p);
    }
    return p;
  };

  // Previews: the placeholder or thumbnail, blurred small (gl-fit.ts) and cropped to the frame's shape. They give
  // the frame its shape before the photo arrives, and the material something to draw on.
  const pvTex: (WebGLTexture | null)[] = srcs.map(() => null);
  const pvAsp: (number | null)[] = srcs.map(() => null);
  const prevAsp: (number | null)[] = srcs.map(() => null);
  const previews = new Map<number, Promise<void>>();
  const preview = (i: number): Promise<void> => {
    const url = sources[i]?.preview;
    if (!url || !live(i)) return Promise.resolve();
    let p = previews.get(i);
    if (p) return p;
    let done!: () => void;
    p = new Promise<void>((r) => { done = r; });
    previews.set(i, p);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onerror = () => done();
    img.onload = () => {
      if (dead || !img.naturalWidth) { done(); return; }
      pvAsp[i] = img.naturalWidth / Math.max(1, img.naturalHeight);
      const c = previewCanvas(img, frameAspect({ given: sources[i].aspect, preview: pvAsp[i] }));
      if (c) {
        const t = texture();
        g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
        // A cross-origin preview without CORS headers taints the canvas and throws: then there is no preview.
        try { g.texImage2D(g.TEXTURE_2D, 0, g.RGB, g.RGB, g.UNSIGNED_BYTE, c); pvTex[i] = t; } catch { g.deleteTexture(t); }
      }
      // The frame takes the preview's shape (unless the photo's own size is known already).
      if (i === st.b && need[i]) { st.target = fitFor(i); poke(); }
      done();
    };
    img.src = url;
    return p;
  };

  // The neighbours of the current photo, uploaded one at a time when the browser is idle, or at once after a jump.
  const prefetch = (i: number, now = false) => {
    const { prev, next } = neighbours(i, srcs.length, ctx.loop);
    for (const j of [next, prev]) {
      if (j === null) continue;
      preview(j);
      if (loads.has(j)) continue;
      if (now) void ready(j); else idle(() => { if (!dead) void ready(j); });
    }
  };

  // The offscreen target for effects, the size of the canvas; each frame uses the box-sized corner of it. And two
  // targets for the loading material (one is drawn each frame; the other keeps the last frame of the photo moved
  // away from, so an effect can start from it).
  const target = texture();
  const fbo = g.createFramebuffer();
  const mats = [0, 1].map(() => ({ t: texture()!, f: g.createFramebuffer() }));
  let vw = 1, vh = 1, dpr = 1, W = 1, H = 1, MW = 1, MH = 1;
  const attach = (t: WebGLTexture, f: WebGLFramebuffer | null, w: number, h: number) => {
    g.bindTexture(g.TEXTURE_2D, t);
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, w, h, 0, g.RGBA, g.UNSIGNED_BYTE, null);
    g.bindFramebuffer(g.FRAMEBUFFER, f);
    g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, t, 0);
  };
  const resizeCanvas = () => {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    vw = canvas.clientWidth || window.innerWidth; vh = canvas.clientHeight || window.innerHeight;
    W = canvas.width = Math.round(vw * dpr); H = canvas.height = Math.round(vh * dpr);
    // The material at one texel per CSS pixel at most: it is soft by nature, and this keeps it cheap on phones.
    MW = Math.max(1, Math.min(MAT_MAX, Math.round(vw))); MH = Math.max(1, Math.min(MAT_MAX, Math.round(vh)));
    attach(target!, fbo, W, H);
    for (const m of mats) attach(m.t, m.f, MW, MH);
    g.bindFramebuffer(g.FRAMEBUFFER, null);
  };
  resizeCanvas();

  // Layout is read once per resize, never during an animation frame.
  let area = ctx.area();
  const aspect = (i: number) => frameAspect({ natural: dims[i] ? dims[i]![0] / dims[i]![1] : null, given: sources[i]?.aspect, preview: pvAsp[i], previous: prevAsp[i] });
  const fitFor = (i: number): Box => containBox(aspect(i), area);
  const pitch = () => area.w + STRIP_GAP;
  const ease = easingFn(effect.easing);
  const t0 = performance.now();

  const st = { box: { x: 0, y: 0, w: 1, h: 1 } as Box, vel: [0, 0, 0, 0], target: { x: 0, y: 0, w: 1, h: 1 } as Box, a: 0, b: 0, mix: 0, dir: 1, swapAt: 0, plain: false, alpha: 1, fadeAt: 0, fadeOut: false, closing: false };
  // The loading look: need[i] while photo i is drawn with its material (until its reveal ends); failed[i] once its
  // load failed; revealAt when the current photo started dissolving in; loadAt when its loading began (the
  // material's clock); cm the material target drawn this frame, and frozen the photo whose last material frame the
  // other one keeps.
  const need: boolean[] = srcs.map(() => false);
  const failed: boolean[] = srcs.map(() => false);
  let revealAt = 0, loadAt = 0, cm = 0, frozen = -1;
  const turn = latest();
  const strip = { x: 0, v: 0, held: false };
  // A swipe that drives the effect: p runs 0 to pitch() px as the finger moves toward photo j (dir 1 next, -1
  // previous); on release it springs to goal (pitch: j becomes current, 0: back) with the finger's velocity.
  const scrub = { on: false, held: false, j: 0, dir: 1 as 1 | -1, p: 0, v: 0, goal: 0 };
  const lerpBox = (a: Box, b: Box, t: number): Box => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, w: a.w + (b.w - a.w) * t, h: a.h + (b.h - a.h) * t });
  // Finish a swipe at once (a button move, a close or a new drag arrived mid-spring).
  const endScrub = () => {
    if (!scrub.on) return;
    if (!scrub.held && scrub.goal > 0) { st.a = st.b = scrub.j; st.target = fitFor(scrub.j); st.box = { ...st.target }; st.vel = [0, 0, 0, 0]; }
    scrub.on = false; scrub.held = false; scrub.p = 0; scrub.v = 0;
  };
  let raf = 0, last = 0, dead = false, held = false;
  let waiters: (() => void)[] = [];
  const swapMs = ctx.still ? FADE_MS : ctx.duration;

  // Tell the lightbox how the photo on screen is doing (never for one moved away from).
  const tell = (i: number, s: LoadStatus) => { if (!dead && i === st.b) ctx.status?.(i, s); };
  // Photo i's load settled while it shows its loading look.
  const landed = (i: number, r: Loaded) => {
    if (dead || i !== st.b || !need[i]) return;
    if (r === "ok") { st.target = fitFor(i); tell(i, "ready"); }
    else if (r === "failed") { failed[i] = true; tell(i, "failed"); }
    else tell(i, "fallback");
    poke();
  };
  // Photo i becomes the one on screen while it is still loading.
  const beginLoading = (i: number) => {
    need[i] = true; revealAt = 0; loadAt = performance.now();
    preview(i);
    tell(i, "loading");
    void ready(i).then((r) => landed(i, r));
  };

  const coverAsp = (i: number, b: Box): [number, number] => {
    const ia = aspect(i), ba = b.w / Math.max(1, b.h);
    return ia > ba ? [ia / ba, 1] : [1, ba / ia];
  };
  const drawBox = (t: WebGLTexture, b: Box, asp: [number, number], part: [number, number], radius: R4, alpha: number, reveal = 1) => {
    bind(bx);
    g.activeTexture(g.TEXTURE0); g.bindTexture(g.TEXTURE_2D, t);
    g.uniform1i(B.img, 0);
    if (reveal < 1) { g.activeTexture(g.TEXTURE1); g.bindTexture(g.TEXTURE_2D, noiseTex); g.uniform1i(B.noise, 1); }
    g.uniform1f(B.reveal, reveal);
    g.uniform2f(B.asp, asp[0], asp[1]);
    g.uniform2f(B.part, part[0], part[1]);
    g.uniform4f(B.box, b.x, b.y, b.w, b.h);
    g.uniform2f(B.size, b.w, b.h);
    g.uniform2f(B.view, vw, vh);
    const m = Math.min(b.w / 2, b.h / 2);
    g.uniform4f(B.radius, Math.min(radius[0], m), Math.min(radius[1], m), Math.min(radius[2], m), Math.min(radius[3], m));
    g.uniform1f(B.alpha, alpha);
    g.drawArrays(g.TRIANGLES, 0, 6);
  };
  const shift = (b: Box, dx: number): Box => ({ x: b.x + dx, y: b.y, w: b.w, h: b.h });

  // The material for photo i into this frame's material target, stretched over the box (vUv spans the box).
  const material = (i: number, box: Box, now: number): Face => {
    const m = mats[cm];
    bind(lm);
    g.bindFramebuffer(g.FRAMEBUFFER, m.f);
    g.viewport(0, 0, MW, MH);
    g.disable(g.BLEND);
    g.activeTexture(g.TEXTURE0); g.bindTexture(g.TEXTURE_2D, pvTex[i] ?? noiseTex);
    g.activeTexture(g.TEXTURE1); g.bindTexture(g.TEXTURE_2D, noiseTex);
    g.uniform1i(M.uPreview, 0); g.uniform1i(M.uNoise, 1);
    g.uniform1f(M.uHasPreview, pvTex[i] ? 1 : 0);
    // Still with reduced motion; otherwise seconds since loading began, kept small for mediump.
    g.uniform1f(M.uTime, ctx.still ? 0 : ((now - loadAt) / 1000) % 300);
    g.uniform2f(M.uResolution, Math.max(1, box.w * dpr), Math.max(1, box.h * dpr));
    g.uniform1f(M.uFailed, failed[i] ? 1 : 0);
    setUniforms(M, matUniforms);
    g.drawArrays(g.TRIANGLES, 0, 6);
    g.bindFramebuffer(g.FRAMEBUFFER, null);
    g.viewport(0, 0, W, H);
    g.enable(g.BLEND);
    return { t: m.t, size: [box.w, box.h], asp: [1, 1] };
  };
  const photo = (i: number, box: Box): Face | null => (tex[i] ? { t: tex[i]!, size: dims[i]!, asp: coverAsp(i, box) } : null);
  // A loading photo in its box: the material, and the photo dissolving in over it once it is there.
  const drawLoading = (i: number, box: Box, radius: R4, now: number) => {
    const m = material(i, box, now);
    drawBox(m.t, box, m.asp, [1, 1], radius, st.alpha);
    if (!tex[i] || !revealAt) return;
    const k = revealProgress(now - revealAt, ctx.still);
    drawBox(tex[i]!, box, coverAsp(i, box), [1, 1], radius, st.alpha * (ctx.still ? k : 1), ctx.still ? 1 : k);
  };

  // The effect shader draws a then b at progress mix offscreen, and the result goes into the box.
  const effectPass = (a: Face, b: Face, mix: number, dir: number, box: Box, radius: R4) => {
    const bw = Math.max(1, Math.min(W, Math.round(box.w * dpr))), bh = Math.max(1, Math.min(H, Math.round(box.h * dpr)));
    bind(fx);
    g.bindFramebuffer(g.FRAMEBUFFER, fbo);
    g.viewport(0, 0, bw, bh);
    g.disable(g.BLEND);
    g.activeTexture(g.TEXTURE0); g.bindTexture(g.TEXTURE_2D, a.t);
    g.activeTexture(g.TEXTURE1); g.bindTexture(g.TEXTURE_2D, b.t);
    g.uniform1i(F.uFrom, 0); g.uniform1i(F.uTo, 1);
    g.uniform1f(F.uProgress, mix);
    g.uniform2f(F.uResolution, bw, bh);
    g.uniform2f(F.uFromSize, a.size[0], a.size[1]); g.uniform2f(F.uToSize, b.size[0], b.size[1]);
    g.uniform1f(F.uTime, (performance.now() - t0) / 1000);
    g.uniform1f(F.uDirection, dir);
    setUniforms(F, effect.uniforms ?? {});
    g.drawArrays(g.TRIANGLES, 0, 6);
    g.bindFramebuffer(g.FRAMEBUFFER, null);
    g.viewport(0, 0, W, H);
    g.enable(g.BLEND);
    drawBox(target!, box, [1, 1], [bw / W, bh / H], radius, st.alpha);
  };

  const draw = (now = performance.now()) => {
    g.bindFramebuffer(g.FRAMEBUFFER, null);
    g.viewport(0, 0, W, H);
    g.clearColor(0, 0, 0, 0); g.clear(g.COLOR_BUFFER_BIT);
    g.enable(g.BLEND); g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA);
    const radius = radiusAt(st.closing, st.box, st.target, ctx.rSpot(st.b), ctx.rOpen);
    // A swipe driving the effect: from the current photo toward j, the box easing between their shapes.
    if (scrub.on && tex[st.b] && tex[scrub.j] && !need[st.b]) {
      const t = Math.min(1, Math.max(0, scrub.p / pitch()));
      const box = lerpBox(st.box, fitFor(scrub.j), t);
      effectPass(photo(st.b, box)!, photo(scrub.j, box)!, t, scrub.dir, box, ctx.rOpen);
      return;
    }
    // The neighbours, while the strip is off centre (their preview while they load).
    if (strip.held || Math.abs(strip.x) > 0.5) {
      const { prev, next } = neighbours(st.b, srcs.length, ctx.loop);
      for (const [j, k] of [[prev, -1], [next, 1]] as const) {
        if (j === null) continue;
        const t = tex[j] ?? pvTex[j];
        if (!t) continue;
        const b = shift(fitFor(j), k * pitch() + strip.x);
        if (b.x > vw || b.x + b.w < 0) continue;
        drawBox(t, b, tex[j] ? coverAsp(j, b) : [1, 1], [1, 1], ctx.rOpen, st.alpha);
      }
    }
    const box = shift(st.box, strip.x);
    // At rest: the photo, or its loading look. A video's poster still loading keeps the photo before it.
    if (!st.swapAt) {
      const k = need[st.b] || tex[st.b] ? st.b : st.a;
      if (need[k]) drawLoading(k, box, radius, now);
      else if (tex[k]) drawBox(tex[k]!, box, coverAsp(k, box), [1, 1], radius, st.alpha);
      return;
    }
    // A change: to the photo, or to its material; from the photo, or the last frame of the material it had.
    const to = need[st.b] ? material(st.b, box, now) : photo(st.b, box);
    if (!to) return;
    const from = photo(st.a, box) ?? (frozen === st.a ? { t: mats[cm ^ 1].t, size: [box.w, box.h] as [number, number], asp: [1, 1] as [number, number] } : to);
    // A plain crossfade (a video is involved): the old picture, then the new one over it, no effect pass.
    if (st.plain) {
      drawBox(from.t, box, from.asp, [1, 1], radius, st.alpha);
      drawBox(to.t, box, to.asp, [1, 1], radius, st.alpha * st.mix);
      return;
    }
    effectPass(from, to, st.mix, st.dir, box, radius);
  };
  const poke = () => { if (!dead && !raf) raf = requestAnimationFrame(frame); };

  // One rAF loop draws the spring, the strip, the effect, any fade and the loading look. Waiters resolve when the
  // motion comes to rest; a loading material keeps the loop drawing (alive) without holding them up.
  function frame() {
    const now = performance.now();
    const dt = Math.min(1 / 15, Math.max(0, (now - (last || now - 1000 / 60)) / 1000));
    last = now;
    let moving = false;
    // While a finger holds the photo it stays where the finger put it; the spring takes over on release.
    if (held) moving = true;
    else if (ctx.still) st.box = { ...st.target };
    else moving = stepBox(st.box, st.vel, st.target, dt, st.closing ? SPRING_CLOSE : SPRING_OPEN);
    if (scrub.on) {
      if (scrub.held) moving = true;
      else if (ctx.still) { scrub.p = scrub.goal; endScrub(); }
      else {
        let e: number;
        [e, scrub.v] = stripStep(scrub.p - scrub.goal, scrub.v, dt);
        scrub.p = Math.min(pitch(), Math.max(0, scrub.goal + e));
        if (scrub.p === 0 || scrub.p === pitch()) if (Math.sign(scrub.v) === Math.sign(scrub.p - pitch() / 2)) scrub.v = 0;
        if (Math.abs(scrub.p - scrub.goal) < 0.25 && Math.abs(scrub.v) < 2) endScrub(); else moving = true;
      }
    }
    if (strip.held) moving = true;
    else if (strip.x !== 0 || strip.v !== 0) {
      if (ctx.still) { strip.x = 0; strip.v = 0; }
      else {
        [strip.x, strip.v] = stripStep(strip.x, strip.v, dt);
        if (Math.abs(strip.x) < 0.25 && Math.abs(strip.v) < 2) { strip.x = 0; strip.v = 0; } else moving = true;
      }
    }
    if (st.swapAt) {
      const ms = st.plain ? Math.min(PLAIN_MS, swapMs || PLAIN_MS) : swapMs;
      const t = ms > 0 ? (now - st.swapAt) / ms : 1;
      st.mix = ease(Math.min(1, t));
      if (t >= 1) { st.a = st.b; st.mix = 0; st.swapAt = 0; frozen = -1; } else moving = true;
    }
    if (st.fadeAt) {
      const t = Math.min(1, (now - st.fadeAt) / FADE_MS);
      st.alpha = st.fadeOut ? 1 - t : t;
      if (t < 1) moving = true;
    }
    // The loading look: the photo dissolves in once it is there and the change has played; until then the
    // material drifts (still with reduced motion, and once failed).
    let alive = false;
    const b = st.b;
    if (need[b] && !st.swapAt) {
      if (tex[b] && !failed[b]) {
        if (!revealAt) revealAt = now;
        if (revealProgress(now - revealAt, ctx.still) >= 1) { need[b] = false; revealAt = 0; } else alive = true;
      } else if (!failed[b] && !ctx.still) alive = true;
    } else if (need[b] && !failed[b] && !ctx.still) alive = true;
    draw(now);
    if (!moving) { const w = waiters; waiters = []; w.forEach((f) => f()); }
    if (moving || alive) raf = requestAnimationFrame(frame);
    else { raf = 0; last = 0; }
  }
  const run = () => new Promise<void>((resolve) => {
    if (dead) { resolve(); return; }
    waiters.push(resolve);
    if (!raf) raf = requestAnimationFrame(frame);
  });

  return {
    warning,
    stage: {
      kind: "webgl",
      async open(i, from, started) {
        area = ctx.area();
        const t = turn.take();
        const r = ready(i), pv = preview(i);
        // A photo in the cache opens straight away; any other springs open at once on its preview (given a frame
        // or two for the preview, usually the tile's own picture, to give the frame its shape) with the loading
        // look. Only one WebGL cannot use (CORS, a refused upload) goes to CSS.
        let got = live(i) ? await Promise.race([r, sleep(LOAD_GRACE_MS)]) : await r;
        if (got === "wait") { await Promise.race([pv, sleep(LOAD_GRACE_MS)]); got = await Promise.race([r, Promise.resolve("wait" as const)]); }
        if (dead || !turn.is(t)) return !dead;
        if (got === "fallback" || (got === "failed" && !live(i))) return false;
        st.a = st.b = i; need[i] = false;
        if (got !== "ok") beginLoading(i);
        st.target = fitFor(i);
        if (ctx.still || !from) { st.box = { ...st.target }; st.alpha = 0; st.fadeAt = performance.now(); }
        else st.box = { ...from };
        const p = run();
        started?.();
        await p;
        prefetch(i);
        return true;
      },
      async show(i, dir, plain) {
        endScrub();
        const t = turn.take();
        // A photo that failed before is asked for again.
        if (failed[i]) { failed[i] = false; loads.delete(i); }
        const r = ready(i);
        preview(i);
        prefetch(i, true);
        if (!live(i)) {
          // A video's poster: the effect's clock starts once it is on the GPU (until then the picture stays).
          st.a = st.swapAt ? st.b : st.a; st.b = i; st.dir = dir; st.mix = 0; st.swapAt = 0; st.plain = !!plain; need[i] = false;
          const p = run();
          if ((await r) !== "ok" || dead) return false;
          if (st.b !== i || !turn.is(t)) return true;
          st.swapAt = performance.now();
          st.target = fitFor(i);
          await Promise.all([p, run()]);
          return true;
        }
        // A photo in the cache lands within a frame or two and changes straight to it; any other moves at once to
        // its preview with the loading look.
        await Promise.race([r, sleep(LOAD_GRACE_MS)]);
        if (dead || !turn.is(t)) return true;
        const onScreen = st.swapAt ? st.b : st.a;
        // Keep the last material frame of a photo moved away from while loading, for the change to start from.
        if (need[onScreen] && !tex[onScreen]) { cm ^= 1; frozen = onScreen; } else frozen = -1;
        if (!dims[i] && !sources[i].aspect && !pvAsp[i]) prevAsp[i] = aspect(onScreen);
        st.a = onScreen; st.b = i; st.dir = dir; st.mix = 0; st.plain = !!plain;
        need[onScreen] = need[onScreen] && !tex[onScreen];
        need[i] = false;
        if (!tex[i]) beginLoading(i);
        st.target = fitFor(i);
        st.swapAt = performance.now();
        await run();
        return true;
      },
      retry(i) {
        if (dead || i !== st.b || !failed[i]) return;
        failed[i] = false;
        loads.delete(i);
        beginLoading(i);
        poke();
      },
      async close(to) {
        held = false; strip.held = false;
        endScrub();
        st.closing = true;
        if (ctx.still || !to) {
          st.fadeAt = performance.now(); st.fadeOut = true;
          if (!to) st.target = { x: st.box.x + st.box.w * 0.05, y: st.box.y + st.box.h * 0.05, w: st.box.w * 0.9, h: st.box.h * 0.9 };
        } else {
          // Close from where the photo is on screen, strip offset included.
          st.box = shift(st.box, strip.x); strip.x = 0; strip.v = 0;
          st.target = { ...to };
        }
        await run();
      },
      track(o) {
        if (dead) return;
        held = true;
        st.box = draggedBox(st.target, o);
        st.vel = [0, 0, 0, 0];
        if (!raf) draw();
      },
      release(v) {
        held = false;
        st.vel = [v.vx, v.vy, 0, 0];
        void run();
      },
      pan(x, plain) {
        if (dead) return;
        // The effect follows the finger when there is a photo that way, loaded, and no video; else the strip.
        if (scrub.on && !scrub.held) endScrub();
        const nb = neighbours(st.b, srcs.length, ctx.loop);
        const j = x < 0 ? nb.next : x > 0 ? nb.prev : null;
        if (ctx.swipeFx && !ctx.still && !plain && j !== null && tex[j] && tex[st.b] && !need[st.b] && strip.x === 0 && !strip.held) {
          st.a = st.b; st.swapAt = 0; st.mix = 0;
          scrub.on = true; scrub.held = true; scrub.j = j; scrub.dir = x < 0 ? 1 : -1; scrub.p = Math.min(pitch(), Math.abs(x)); scrub.v = 0;
          if (!raf) raf = requestAnimationFrame(frame);
          return;
        }
        if (scrub.on && x === 0) { scrub.p = 0; if (!raf) raf = requestAnimationFrame(frame); return; }
        if (scrub.on) { scrub.on = false; scrub.held = false; scrub.p = 0; }
        strip.held = true; strip.x = x; strip.v = 0;
        if (!raf) raf = requestAnimationFrame(frame);
      },
      async settle(dir, vx) {
        if (scrub.on) {
          scrub.held = false;
          // A fling against the drag picks the photo on the other side: the effect starts toward it from 0.
          if (dir !== 0 && dir !== scrub.dir) {
            const nb = neighbours(st.b, srcs.length, ctx.loop);
            const j = dir > 0 ? nb.next : nb.prev;
            if (j !== null && tex[j]) { scrub.j = j; scrub.dir = dir; scrub.p = 0; } else dir = 0;
          }
          scrub.goal = dir !== 0 ? pitch() : 0;
          scrub.v = -vx * scrub.dir;
          if (dir !== 0) turn.take();
          await run();
          if (dir !== 0) prefetch(st.b);
          return;
        }
        strip.held = false;
        strip.v = vx;
        if (dir !== 0) {
          const { prev, next } = neighbours(st.b, srcs.length, ctx.loop);
          const j = dir > 0 ? next : prev;
          if (j !== null) {
            // The neighbour becomes current; the strip is re-based so nothing moves on screen.
            turn.take();
            if (!dims[j] && !sources[j].aspect && !pvAsp[j]) prevAsp[j] = aspect(st.b);
            st.a = st.b = j; st.mix = 0; st.swapAt = 0; frozen = -1; need[j] = false;
            if (failed[j]) { failed[j] = false; loads.delete(j); }
            if (!tex[j] && live(j)) beginLoading(j); else void ready(j);
            st.target = fitFor(j); st.box = { ...st.target }; st.vel = [0, 0, 0, 0];
            strip.x += dir * pitch();
          }
        }
        await run();
        if (dir !== 0) prefetch(st.b);
      },
      rect() { return dims[st.b] || need[st.b] ? fitFor(st.b) : null; },
      current() { return dims[st.b] && !need[st.b] ? { ...st.box } : null; },
      place(box) {
        if (dead) return;
        held = true;
        st.box = { ...box }; st.vel = [0, 0, 0, 0];
        if (!raf) draw();
      },
      async glide(box, v) {
        held = false;
        st.target = { ...box }; st.vel = [v.vx, v.vy, 0, 0];
        await run();
      },
      resize() { resizeCanvas(); area = ctx.area(); st.target = fitFor(st.b); void run(); },
      destroy() {
        dead = true;
        cancelAnimationFrame(raf); raf = 0;
        const w = waiters; waiters = []; w.forEach((f) => f());
        tex.forEach((t) => t && g.deleteTexture(t));
        pvTex.forEach((t) => t && g.deleteTexture(t));
        for (const m of mats) { g.deleteTexture(m.t); g.deleteFramebuffer(m.f); }
        g.deleteTexture(noiseTex);
        g.deleteTexture(target); g.deleteFramebuffer(fbo); g.deleteBuffer(buf);
        shaders.forEach((s) => g.deleteShader(s));
        g.deleteProgram(fx); g.deleteProgram(bx); g.deleteProgram(lm);
      },
    },
  };
}

let probe: WebGLRenderingContext | null | undefined;
/** Compile a fragment shader (with the effect macros) against the shared vertex shader: null, or the message. */
function checkFragment(fragment: string): string | null {
  if (probe === undefined) {
    try { probe = document.createElement("canvas").getContext("webgl") as WebGLRenderingContext | null; } catch { probe = null; }
  }
  const g = probe;
  if (!g) return null;
  const sh = (type: number, src: string) => {
    const s = g.createShader(type)!;
    g.shaderSource(s, src); g.compileShader(s);
    const ok = g.getShaderParameter(s, g.COMPILE_STATUS);
    const log = ok ? null : (g.getShaderInfoLog(s) || "the shader did not compile").replace(/\0/g, "").trim();
    return { s, log };
  };
  const v = sh(g.VERTEX_SHADER, EFFECT_VERT), f = sh(g.FRAGMENT_SHADER, PRELUDE + "\n#line 1\n" + fragment);
  let log = f.log;
  if (!log) {
    const p = g.createProgram()!;
    g.attachShader(p, v.s); g.attachShader(p, f.s); g.linkProgram(p);
    if (!g.getProgramParameter(p, g.LINK_STATUS)) log = (g.getProgramInfoLog(p) || "the shader did not link").trim();
    g.deleteProgram(p);
  }
  g.deleteShader(v.s); g.deleteShader(f.s);
  return log;
}

/**
 * Compile an effect's fragment shader without opening anything. Returns null when it compiles, else the
 * compiler's message (line numbers count from the first line of your shader). Null too when there is no WebGL
 * to check with.
 */
export function checkEffect(effect: Effect | string): string | null {
  return checkFragment(typeof effect === "string" ? effect : effect.fragment);
}

/** The same for a loading shader: null when it compiles, else the compiler's message. */
export function checkLoading(shader: LoadingShader | string): string | null {
  return checkFragment(typeof shader === "string" ? shader : shader.fragment);
}
