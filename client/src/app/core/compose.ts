export type BgMode = 'transparent' | 'color' | 'blur' | 'image';

export interface BgOptions {
  mode: BgMode;
  color: string;
  /** 1-100 */
  blur: number;
  image: HTMLImageElement | null;
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Needed so canvas export works for images served by the API (which sends CORS headers).
    if (!src.startsWith('blob:') && !src.startsWith('data:')) img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image failed to load'));
    img.src = src;
  });
}

function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, w: number, h: number, bleed = 0): void {
  const scale = Math.max((w + bleed * 2) / img.naturalWidth, (h + bleed * 2) / img.naturalHeight);
  const dw = img.naturalWidth * scale;
  const dh = img.naturalHeight * scale;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

function supportsCanvasFilter(ctx: CanvasRenderingContext2D): boolean {
  if (!('filter' in ctx)) return false;
  ctx.filter = 'blur(1px)';
  const ok = ctx.filter === 'blur(1px)';
  ctx.filter = 'none';
  return ok;
}

function drawBlurred(ctx: CanvasRenderingContext2D, img: HTMLImageElement, w: number, h: number, strength: number): void {
  const radius = Math.max(1, (Math.max(w, h) / 1000) * strength * 0.4);
  if (supportsCanvasFilter(ctx)) {
    ctx.filter = `blur(${radius}px)`;
    // Bleed past the edges so the blur doesn't fade to transparent at the borders.
    drawCover(ctx, img, w, h, radius * 2);
    ctx.filter = 'none';
    return;
  }
  // Fallback for browsers without ctx.filter: downscale then upscale with smoothing.
  const factor = Math.max(2, Math.round(radius / 2));
  const small = document.createElement('canvas');
  small.width = Math.max(1, Math.round(w / factor));
  small.height = Math.max(1, Math.round(h / factor));
  const sctx = small.getContext('2d')!;
  sctx.imageSmoothingQuality = 'high';
  drawCover(sctx, img, small.width, small.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(small, 0, 0, w, h);
}

/**
 * Draws the cutout over the chosen background. `maxSide` renders a scaled-down copy
 * for fast live previews; omit it for the full-resolution export.
 */
export function composeToCanvas(
  cutout: HTMLImageElement,
  original: HTMLImageElement,
  bg: BgOptions,
  maxSide = Infinity,
  canvas = document.createElement('canvas'),
): HTMLCanvasElement {
  const scale = Math.min(1, maxSide / Math.max(cutout.naturalWidth, cutout.naturalHeight));
  const w = Math.round(cutout.naturalWidth * scale);
  const h = Math.round(cutout.naturalHeight * scale);
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, w, h);
  if (bg.mode === 'color') {
    ctx.fillStyle = bg.color;
    ctx.fillRect(0, 0, w, h);
  } else if (bg.mode === 'blur') {
    drawBlurred(ctx, original, w, h, bg.blur);
  } else if (bg.mode === 'image' && bg.image) {
    drawCover(ctx, bg.image, w, h);
  }
  ctx.drawImage(cutout, 0, 0, w, h);
  return canvas;
}

export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Export failed'))), 'image/png'));
}

export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
