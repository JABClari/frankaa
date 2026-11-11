// The WebGL renderer, in two passes on one full-screen canvas:
// 1. the effect (a fragment shader, built-in or yours) draws the two photos into an offscreen texture the size of
//    the photo's box;
// 2. that texture is drawn where the spring says, clipped to a rounded box, with a fade when asked.
// Raw WebGL1, no package.
import { containBox, draggedBox, radiusAt, stepBox, SPRING_CLOSE, SPRING_OPEN, type Box, type Stage, type StageCtx } from "./lightbox-math";
import { PRELUDE, easingFn, uniformKind, type Effect } from "./effects";

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

const BOX_FRAG = `precision mediump float;
varying vec2 uv;
uniform sampler2D img;
uniform vec2 part;
uniform vec2 size;
uniform float radius;
uniform float alpha;
void main() {
  vec2 q = abs(uv * size - size * 0.5) - (size * 0.5 - radius);
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - radius;
  float edge = clamp(0.5 - d, 0.0, 1.0);
  if (edge <= 0.0) discard;
  gl_FragColor = vec4(texture2D(img, uv * part).rgb, 1.0) * edge * alpha;
}`;

const FADE_MS = 160;

/** True when this browser can draw the lightbox with WebGL. */
export function supported(): boolean {
  if (typeof document === "undefined") return false;
  try { return !!document.createElement("canvas").getContext("webgl"); } catch { return false; }
}

type Built = { stage: Stage; error?: undefined } | { stage?: undefined; error: { reason: "webgl" | "shader"; message: string } };

/** A WebGL stage on this canvas, or the reason there cannot be one (no WebGL, or the shader did not compile). */
export function createGlStage(canvas: HTMLCanvasElement, srcs: string[], effect: Effect, ctx: StageCtx): Built {
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
  let fx: WebGLProgram, bx: WebGLProgram;
  try { bx = program(BOX_VERT, BOX_FRAG); } catch (e) { return { error: { reason: "webgl", message: String((e as Error).message) } }; }
  try { fx = program(EFFECT_VERT, PRELUDE + "\n#line 1\n" + effect.fragment); } catch (e) { g.deleteProgram(bx); return { error: { reason: "shader", message: String((e as Error).message).replace(/\0/g, "").trim() } }; }

  const buf = g.createBuffer();
  g.bindBuffer(g.ARRAY_BUFFER, buf);
  g.bufferData(g.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]), g.STATIC_DRAW);
  const bind = (p: WebGLProgram) => {
    g.useProgram(p);
    const loc = g.getAttribLocation(p, "p");
    g.enableVertexAttribArray(loc);
    g.vertexAttribPointer(loc, 2, g.FLOAT, false, 0, 0);
  };
  const names = ["uFrom", "uTo", "uProgress", "uResolution", "uFromSize", "uToSize", "uTime", "uDirection"];
  const F: Record<string, WebGLUniformLocation | null> = {};
  for (const n of [...names, ...Object.keys(effect.uniforms ?? {})]) F[n] = g.getUniformLocation(fx, n);
  const B = { box: g.getUniformLocation(bx, "box"), view: g.getUniformLocation(bx, "view"), img: g.getUniformLocation(bx, "img"), part: g.getUniformLocation(bx, "part"), size: g.getUniformLocation(bx, "size"), radius: g.getUniformLocation(bx, "radius"), alpha: g.getUniformLocation(bx, "alpha") };

  const texture = () => {
    const t = g.createTexture();
    g.bindTexture(g.TEXTURE_2D, t);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_S, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_WRAP_T, g.CLAMP_TO_EDGE);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MIN_FILTER, g.LINEAR);
    g.texParameteri(g.TEXTURE_2D, g.TEXTURE_MAG_FILTER, g.LINEAR);
    return t;
  };

  // Photos load with crossOrigin="anonymous": a cross-origin photo without CORS headers fails to load (it never
  // taints the canvas), and the lightbox then switches to the CSS renderer and reports it.
  const tex: (WebGLTexture | null)[] = srcs.map(() => null);
  const dims: ([number, number] | null)[] = srcs.map(() => null);
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
          const t = texture();
          g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          try { g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, img); } catch { g.deleteTexture(t); resolve(false); return; }
          tex[i] = t; dims[i] = [img.naturalWidth, Math.max(1, img.naturalHeight)];
          resolve(true);
        };
        img.onerror = () => resolve(false);
        img.src = srcs[i];
      });
      loads.set(i, p);
    }
    return p;
  };

  // The offscreen target, the size of the canvas; each frame uses the box-sized corner of it.
  const target = texture();
  const fbo = g.createFramebuffer();
  let vw = 1, vh = 1, dpr = 1;
  const resizeCanvas = () => {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    vw = canvas.clientWidth || window.innerWidth; vh = canvas.clientHeight || window.innerHeight;
    canvas.width = Math.round(vw * dpr); canvas.height = Math.round(vh * dpr);
    g.bindTexture(g.TEXTURE_2D, target);
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, canvas.width, canvas.height, 0, g.RGBA, g.UNSIGNED_BYTE, null);
    g.bindFramebuffer(g.FRAMEBUFFER, fbo);
    g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, target, 0);
    g.bindFramebuffer(g.FRAMEBUFFER, null);
  };
  resizeCanvas();

  const aspect = (i: number) => (dims[i] ? dims[i]![0] / dims[i]![1] : 1.5);
  const fitFor = (i: number): Box => containBox(aspect(i), ctx.area());
  const ease = easingFn(effect.easing);
  const t0 = performance.now();

  const st = { box: { x: 0, y: 0, w: 1, h: 1 } as Box, vel: [0, 0, 0, 0], target: { x: 0, y: 0, w: 1, h: 1 } as Box, a: 0, b: 0, mix: 0, dir: 1, swapAt: 0, alpha: 1, fadeAt: 0, fadeOut: false, closing: false };
  let raf = 0, last = 0, dead = false, held = false;
  let waiters: (() => void)[] = [];
  const swapMs = ctx.still ? FADE_MS : ctx.duration;

  const draw = () => {
    const a = tex[st.a] ?? tex[st.b], b = tex[st.b] ?? tex[st.a];
    g.bindFramebuffer(g.FRAMEBUFFER, null);
    g.viewport(0, 0, canvas.width, canvas.height);
    g.clearColor(0, 0, 0, 0); g.clear(g.COLOR_BUFFER_BIT);
    if (!a || !b) return;
    const box = st.box;
    const bw = Math.max(1, Math.min(canvas.width, Math.round(box.w * dpr))), bh = Math.max(1, Math.min(canvas.height, Math.round(box.h * dpr)));
    // 1. The effect, into the box-sized corner of the offscreen texture.
    bind(fx);
    g.bindFramebuffer(g.FRAMEBUFFER, fbo);
    g.viewport(0, 0, bw, bh);
    g.disable(g.BLEND);
    g.activeTexture(g.TEXTURE0); g.bindTexture(g.TEXTURE_2D, a);
    g.activeTexture(g.TEXTURE1); g.bindTexture(g.TEXTURE_2D, b);
    g.uniform1i(F.uFrom, 0); g.uniform1i(F.uTo, 1);
    g.uniform1f(F.uProgress, st.mix);
    g.uniform2f(F.uResolution, bw, bh);
    const da = dims[st.a] ?? dims[st.b] ?? [1, 1], db = dims[st.b] ?? da;
    g.uniform2f(F.uFromSize, da[0], da[1]); g.uniform2f(F.uToSize, db[0], db[1]);
    g.uniform1f(F.uTime, (performance.now() - t0) / 1000);
    g.uniform1f(F.uDirection, st.dir);
    for (const [k, v] of Object.entries(effect.uniforms ?? {})) {
      const kind = uniformKind(v), loc = F[k];
      if (!kind || !loc) continue;
      if (kind === "1f") g.uniform1f(loc, v as number);
      else if (kind === "2fv") g.uniform2fv(loc, v as number[]);
      else if (kind === "3fv") g.uniform3fv(loc, v as number[]);
      else g.uniform4fv(loc, v as number[]);
    }
    g.drawArrays(g.TRIANGLES, 0, 6);
    // 2. The box on screen, rounded.
    bind(bx);
    g.bindFramebuffer(g.FRAMEBUFFER, null);
    g.viewport(0, 0, canvas.width, canvas.height);
    g.enable(g.BLEND); g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA);
    g.activeTexture(g.TEXTURE0); g.bindTexture(g.TEXTURE_2D, target);
    g.uniform1i(B.img, 0);
    g.uniform2f(B.part, bw / canvas.width, bh / canvas.height);
    g.uniform4f(B.box, box.x, box.y, box.w, box.h);
    g.uniform2f(B.size, box.w, box.h);
    g.uniform2f(B.view, vw, vh);
    const r = radiusAt(st.closing, box, st.target, ctx.rSpot, ctx.rOpen);
    g.uniform1f(B.radius, Math.min(r, box.w / 2, box.h / 2));
    g.uniform1f(B.alpha, st.alpha);
    g.drawArrays(g.TRIANGLES, 0, 6);
  };

  // One rAF loop draws the spring, the effect and any fade. Waiters resolve when it comes to rest.
  const frame = () => {
    const now = performance.now();
    const dt = Math.min(1 / 15, Math.max(0, (now - (last || now - 1000 / 60)) / 1000));
    last = now;
    let moving = false;
    // While a finger holds the photo it stays where the finger put it; the spring takes over on release.
    if (held) moving = true;
    else if (ctx.still) st.box = { ...st.target };
    else moving = stepBox(st.box, st.vel, st.target, dt, st.closing ? SPRING_CLOSE : SPRING_OPEN);
    if (st.swapAt) {
      const t = swapMs > 0 ? (now - st.swapAt) / swapMs : 1;
      st.mix = ease(Math.min(1, t));
      if (t >= 1) { st.a = st.b; st.mix = 0; st.swapAt = 0; } else moving = true;
    }
    if (st.fadeAt) {
      const t = Math.min(1, (now - st.fadeAt) / FADE_MS);
      st.alpha = st.fadeOut ? 1 - t : t;
      if (t < 1) moving = true;
    }
    draw();
    if (moving) raf = requestAnimationFrame(frame);
    else {
      raf = 0; last = 0;
      const w = waiters; waiters = [];
      w.forEach((f) => f());
    }
  };
  const run = () => new Promise<void>((resolve) => {
    if (dead) { resolve(); return; }
    waiters.push(resolve);
    if (!raf) raf = requestAnimationFrame(frame);
  });

  return {
    stage: {
      kind: "webgl",
      async open(i, from, started) {
        if (!(await ready(i)) || dead) return false;
        st.a = st.b = i;
        st.target = fitFor(i);
        if (ctx.still || !from) { st.box = { ...st.target }; st.alpha = 0; st.fadeAt = performance.now(); }
        else st.box = { ...from };
        srcs.forEach((_, k) => k !== i && void ready(k));
        const p = run();
        started?.();
        await p;
        return true;
      },
      async show(i, dir) {
        st.a = st.swapAt ? st.b : st.a; st.b = i; st.dir = dir; st.mix = 0; st.swapAt = performance.now();
        const p = run();
        if (!(await ready(i)) || dead) return false;
        st.target = fitFor(i);
        await Promise.all([p, run()]);
        return true;
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
      async close(to) {
        held = false;
        st.closing = true;
        if (ctx.still || !to) {
          st.fadeAt = performance.now(); st.fadeOut = true;
          if (!to) st.target = { x: st.box.x + st.box.w * 0.05, y: st.box.y + st.box.h * 0.05, w: st.box.w * 0.9, h: st.box.h * 0.9 };
        } else st.target = { ...to };
        await run();
      },
      resize() { resizeCanvas(); st.target = fitFor(st.b); void run(); },
      destroy() {
        dead = true;
        cancelAnimationFrame(raf); raf = 0;
        const w = waiters; waiters = []; w.forEach((f) => f());
        tex.forEach((t) => t && g.deleteTexture(t));
        g.deleteTexture(target); g.deleteFramebuffer(fbo); g.deleteBuffer(buf);
        shaders.forEach((s) => g.deleteShader(s));
        g.deleteProgram(fx); g.deleteProgram(bx);
      },
    },
  };
}

let probe: WebGLRenderingContext | null | undefined;
/**
 * Compile an effect's fragment shader without opening anything. Returns null when it compiles, else the
 * compiler's message (line numbers count from the first line of your shader). Null too when there is no WebGL
 * to check with.
 */
export function checkEffect(effect: Effect | string): string | null {
  const fragment = typeof effect === "string" ? effect : effect.fragment;
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
