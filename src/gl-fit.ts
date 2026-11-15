// Photos too big for a WebGL texture. A camera original (3000 px and up) is more than phones, iPads and some
// Macs will take: the upload fails without throwing and the photo draws black. uploadPhoto draws anything bigger
// than the screen can show down to that size first, and reports false when the upload still errors, so the caller
// can fall back.

/** The largest side worth uploading: the screen's longest side at the device pixel ratio (capped at 2), never past
 *  the GPU's limit or 4096, and at least 1024. */
export function maxTextureSide(g: WebGLRenderingContext): number {
  const screenSide = Math.max(screen.width || 0, screen.height || 0, window.innerWidth, window.innerHeight) * Math.min(2, window.devicePixelRatio || 1);
  return Math.max(1024, Math.min(Number(g.getParameter(g.MAX_TEXTURE_SIZE)) || 4096, 4096, Math.ceil(screenSide)));
}

/** The image itself when it fits within max px on its longest side, else a copy drawn down to fit on a 2D canvas. */
export function fitImage(img: HTMLImageElement, max: number): HTMLImageElement | HTMLCanvasElement {
  const w = img.naturalWidth, h = img.naturalHeight, k = max / Math.max(w, h);
  if (!(k < 1)) return img;
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
  const x = c.getContext("2d");
  if (!x) return img;
  x.imageSmoothingQuality = "high";
  x.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

/** Upload img into the bound TEXTURE_2D, fitted to max. False when the browser refused it (a throw or a GL error). */
export function uploadPhoto(g: WebGLRenderingContext, img: HTMLImageElement, max: number): boolean {
  g.getError();
  try { g.texImage2D(g.TEXTURE_2D, 0, g.RGBA, g.RGBA, g.UNSIGNED_BYTE, fitImage(img, max)); } catch { return false; }
  return g.getError() === g.NO_ERROR;
}

/**
 * The preview a loading material draws on: the picture cropped to the frame's shape, drawn down to 32 px wide and
 * back up to 96 with a blur, so it never looks blocky (the material blurs it once more as it samples). Null when
 * the browser refuses (a 2D canvas is missing).
 */
export function previewCanvas(img: HTMLImageElement, aspect: number): HTMLCanvasElement | null {
  const w = img.naturalWidth, h = img.naturalHeight;
  if (!w || !h) return null;
  // Cover-crop the source to the frame's shape.
  const ia = w / h;
  const sw = ia > aspect ? h * aspect : w, sh = ia > aspect ? h : w / aspect;
  const small = document.createElement("canvas");
  small.width = 32; small.height = Math.max(1, Math.round(32 / aspect));
  const s = small.getContext("2d");
  const big = document.createElement("canvas");
  big.width = 96; big.height = Math.max(1, Math.round(96 / aspect));
  const b = big.getContext("2d");
  if (!s || !b) return null;
  s.drawImage(img, (w - sw) / 2, (h - sh) / 2, sw, sh, 0, 0, small.width, small.height);
  b.filter = "blur(4px)";
  b.imageSmoothingQuality = "high";
  // Drawn a little larger than the canvas, so the blur never pulls in a dark edge.
  b.drawImage(small, -8, -8, big.width + 16, big.height + 16);
  return big;
}
