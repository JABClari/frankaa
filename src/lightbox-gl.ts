// The WebGL renderer, on one full-screen canvas:
// - at rest, while springing and while swiping, each photo is drawn straight from its texture into a rounded box
//   (one cheap pass); a sideways swipe draws the neighbours beside it, like a strip of photos;
// - only while an effect runs (a key or button move) does the effect shader draw the two photos into an offscreen
//   texture first, which is then drawn into the box.
// Photos are decoded off the main thread (img.decode()) before they are uploaded, and only the current photo and
// its neighbours are uploaded, one at a time when the browser is idle. Raw WebGL1, no package.
import { containBox, neighbours, radiusAt, stepBox, stripStep, draggedBox, STRIP_GAP, SPRING_CLOSE, SPRING_OPEN, type Box, type R4, type Stage, type StageCtx } from "./lightbox-math";
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

// Draws a texture into a rounded box: a photo cover-fitted (asp), or the effect's offscreen result (part).
const BOX_FRAG = `precision mediump float;
varying vec2 uv;
uniform sampler2D img;
uniform vec2 asp;
uniform vec2 part;
uniform vec2 size;
uniform vec4 radius;
uniform float alpha;
void main() {
  vec2 c = uv * size - size * 0.5;
  float r = c.x < 0.0 ? (c.y < 0.0 ? radius.x : radius.w) : (c.y < 0.0 ? radius.y : radius.z);
  vec2 q = abs(c) - (size * 0.5 - r);
  float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
  float edge = clamp(0.5 - d, 0.0, 1.0);
  if (edge <= 0.0) discard;
  gl_FragColor = vec4(texture2D(img, ((uv - 0.5) / asp + 0.5) * part).rgb, 1.0) * edge * alpha;
}`;

const FADE_MS = 160;
const PLAIN_MS = 260;

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

type Built = { stage: Stage; error?: undefined } | { stage?: undefined; error: { reason: "webgl" | "shader"; message: string } };

/** A WebGL stage on this canvas, or the reason there cannot be one (no WebGL, or the shader did not compile). */
/** A photo to draw: its address, and optionally srcset and sizes so the browser picks the right file. */
export type GlSource = { src: string; srcset?: string; sizes?: string };

export function createGlStage(canvas: HTMLCanvasElement, sources: GlSource[], effect: Effect, ctx: StageCtx): Built {
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
  let fx: WebGLProgram, bx: WebGLProgram;
  try { bx = program(BOX_VERT, BOX_FRAG); } catch (e) { return { error: { reason: "webgl", message: String((e as Error).message) } }; }
  try { fx = program(EFFECT_VERT, PRELUDE + "\n#line 1\n" + effect.fragment); } catch (e) { g.deleteProgram(bx); return { error: { reason: "shader", message: String((e as Error).message).replace(/\0/g, "").trim() } }; }

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
  const names = ["uFrom", "uTo", "uProgress", "uResolution", "uFromSize", "uToSize", "uTime", "uDirection"];
  const F: Record<string, WebGLUniformLocation | null> = {};
  for (const n of [...names, ...Object.keys(effect.uniforms ?? {})]) F[n] = g.getUniformLocation(fx, n);
  const B = { box: g.getUniformLocation(bx, "box"), view: g.getUniformLocation(bx, "view"), img: g.getUniformLocation(bx, "img"), asp: g.getUniformLocation(bx, "asp"), part: g.getUniformLocation(bx, "part"), size: g.getUniformLocation(bx, "size"), radius: g.getUniformLocation(bx, "radius"), alpha: g.getUniformLocation(bx, "alpha") };

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
  // taints the canvas), and the lightbox then switches to the CSS renderer and reports it. Each is decoded off the
  // main thread before the upload, so the upload does not stall a frame with a JPEG decode.
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
        const upload = () => {
          if (dead) { resolve(false); return; }
          const t = texture();
          g.pixelStorei(g.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          try { g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, img); } catch { g.deleteTexture(t); resolve(false); return; }
          tex[i] = t; dims[i] = [img.naturalWidth, Math.max(1, img.naturalHeight)];
          resolve(true);
        };
        img.onerror = () => resolve(false);
        if (sources[i].srcset) { img.sizes = sources[i].sizes || "100vw"; img.srcset = sources[i].srcset!; }
        img.src = srcs[i];
        (typeof img.decode === "function" ? img.decode() : new Promise((r, j) => { img.onload = r; img.onerror = j; })).then(upload, () => resolve(false));
      });
      loads.set(i, p);
    }
    return p;
  };
  // The neighbours of the current photo, uploaded one at a time when the browser is idle.
  const prefetch = (i: number) => {
    const { prev, next } = neighbours(i, srcs.length, ctx.loop);
    for (const j of [next, prev]) if (j !== null && !loads.has(j)) idle(() => { if (!dead) void ready(j); });
  };

  // The offscreen target for effects, the size of the canvas; each frame uses the box-sized corner of it.
  const target = texture();
  const fbo = g.createFramebuffer();
  let vw = 1, vh = 1, dpr = 1, W = 1, H = 1;
  const resizeCanvas = () => {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    vw = canvas.clientWidth || window.innerWidth; vh = canvas.clientHeight || window.innerHeight;
    W = canvas.width = Math.round(vw * dpr); H = canvas.height = Math.round(vh * dpr);
    g.bindTexture(g.TEXTURE_2D, target);
    g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, W, H, 0, g.RGBA, g.UNSIGNED_BYTE, null);
    g.bindFramebuffer(g.FRAMEBUFFER, fbo);
    g.framebufferTexture2D(g.FRAMEBUFFER, g.COLOR_ATTACHMENT0, g.TEXTURE_2D, target, 0);
    g.bindFramebuffer(g.FRAMEBUFFER, null);
  };
  resizeCanvas();

  // Layout is read once per resize, never during an animation frame.
  let area = ctx.area();
  const aspect = (i: number) => (dims[i] ? dims[i]![0] / dims[i]![1] : 1.5);
  const fitFor = (i: number): Box => containBox(aspect(i), area);
  const pitch = () => area.w + STRIP_GAP;
  const ease = easingFn(effect.easing);
  const t0 = performance.now();

  const st = { box: { x: 0, y: 0, w: 1, h: 1 } as Box, vel: [0, 0, 0, 0], target: { x: 0, y: 0, w: 1, h: 1 } as Box, a: 0, b: 0, mix: 0, dir: 1, swapAt: 0, plain: false, alpha: 1, fadeAt: 0, fadeOut: false, closing: false };
  const strip = { x: 0, v: 0, held: false };
  let raf = 0, last = 0, dead = false, held = false;
  let waiters: (() => void)[] = [];
  const swapMs = ctx.still ? FADE_MS : ctx.duration;

  const coverAsp = (i: number, b: Box): [number, number] => {
    const ia = aspect(i), ba = b.w / Math.max(1, b.h);
    return ia > ba ? [ia / ba, 1] : [1, ba / ia];
  };
  const drawBox = (t: WebGLTexture, b: Box, asp: [number, number], part: [number, number], radius: R4, alpha: number) => {
    bind(bx);
    g.activeTexture(g.TEXTURE0); g.bindTexture(g.TEXTURE_2D, t);
    g.uniform1i(B.img, 0);
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

  const draw = () => {
    g.bindFramebuffer(g.FRAMEBUFFER, null);
    g.viewport(0, 0, W, H);
    g.clearColor(0, 0, 0, 0); g.clear(g.COLOR_BUFFER_BIT);
    g.enable(g.BLEND); g.blendFunc(g.ONE, g.ONE_MINUS_SRC_ALPHA);
    const radius = radiusAt(st.closing, st.box, st.target, ctx.rSpot(st.b), ctx.rOpen);
    // The neighbours, while the strip is off centre.
    if (strip.held || Math.abs(strip.x) > 0.5) {
      const { prev, next } = neighbours(st.b, srcs.length, ctx.loop);
      for (const [j, k] of [[prev, -1], [next, 1]] as const) {
        const t = j === null ? null : tex[j];
        if (j === null || !t) continue;
        const b = shift(fitFor(j), k * pitch() + strip.x);
        if (b.x > vw || b.x + b.w < 0) continue;
        drawBox(t, b, coverAsp(j, b), [1, 1], ctx.rOpen, st.alpha);
      }
    }
    const a = tex[st.a] ?? tex[st.b], b = tex[st.b] ?? tex[st.a];
    if (!a || !b) return;
    const box = shift(st.box, strip.x);
    if (!st.swapAt) { drawBox(b, box, coverAsp(st.b, box), [1, 1], radius, st.alpha); return; }
    // A plain crossfade (a video is involved): the old photo, then the new one over it, no effect pass.
    if (st.plain) {
      drawBox(a, box, coverAsp(st.a, box), [1, 1], radius, st.alpha);
      drawBox(b, box, coverAsp(st.b, box), [1, 1], radius, st.alpha * st.mix);
      return;
    }
    // An effect is running: draw it offscreen, then into the box.
    const bw = Math.max(1, Math.min(W, Math.round(box.w * dpr))), bh = Math.max(1, Math.min(H, Math.round(box.h * dpr)));
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
    g.bindFramebuffer(g.FRAMEBUFFER, null);
    g.viewport(0, 0, W, H);
    g.enable(g.BLEND);
    drawBox(target!, box, [1, 1], [bw / W, bh / H], radius, st.alpha);
  };

  // One rAF loop draws the spring, the strip, the effect and any fade. Waiters resolve when it comes to rest.
  const frame = () => {
    const now = performance.now();
    const dt = Math.min(1 / 15, Math.max(0, (now - (last || now - 1000 / 60)) / 1000));
    last = now;
    let moving = false;
    // While a finger holds the photo it stays where the finger put it; the spring takes over on release.
    if (held) moving = true;
    else if (ctx.still) st.box = { ...st.target };
    else moving = stepBox(st.box, st.vel, st.target, dt, st.closing ? SPRING_CLOSE : SPRING_OPEN);
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
        area = ctx.area();
        if (!(await ready(i)) || dead) return false;
        st.a = st.b = i;
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
        st.a = st.swapAt ? st.b : st.a; st.b = i; st.dir = dir; st.mix = 0; st.swapAt = performance.now(); st.plain = !!plain;
        const p = run();
        if (!(await ready(i)) || dead) return false;
        st.target = fitFor(i);
        await Promise.all([p, run()]);
        prefetch(i);
        return true;
      },
      async close(to) {
        held = false; strip.held = false;
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
      pan(x) {
        if (dead) return;
        strip.held = true; strip.x = x; strip.v = 0;
        if (!raf) raf = requestAnimationFrame(frame);
      },
      async settle(dir, vx) {
        strip.held = false;
        strip.v = vx;
        if (dir !== 0) {
          const { prev, next } = neighbours(st.b, srcs.length, ctx.loop);
          const j = dir > 0 ? next : prev;
          if (j !== null) {
            // The neighbour becomes current; the strip is re-based so nothing moves on screen.
            st.a = st.b = j; st.mix = 0; st.swapAt = 0;
            st.target = fitFor(j); st.box = { ...st.target }; st.vel = [0, 0, 0, 0];
            strip.x += dir * pitch();
            void ready(j);
          }
        }
        await run();
        if (dir !== 0) prefetch(st.b);
      },
      rect() { return dims[st.b] ? fitFor(st.b) : null; },
      current() { return dims[st.b] ? { ...st.box } : null; },
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
