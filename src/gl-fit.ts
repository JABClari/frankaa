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
