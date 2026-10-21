import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, inject, input, viewChild } from '@angular/core';
import type { CropRect } from './crop-box';

export interface PreviewText {
  text: string;
  x: number;
  y: number;
  size: number;
  color: string;
  font: string;
  box: boolean;
  start?: number;
  end?: number;
}

export interface PreviewSettings {
  crop: CropRect | null;
  rotate: 0 | 90 | 180 | 270;
  flipH: boolean;
  /** Output width/height, or null to follow the (cropped, rotated) source. */
  aspect: number | null;
  fit: 'fill' | 'blur' | 'black';
  brightness: number;
  contrast: number;
  saturation: number;
  texts: PreviewText[];
  /** Optional per-frame horizontal crop centre (0-1) for subject tracking previews. */
  cropCenterAt?: ((t: number) => number) | null;
}

export const FONT_FAMILIES: Record<string, string> = {
  sans: '"DejaVu Sans", Verdana, sans-serif',
  serif: '"DejaVu Serif", Georgia, serif',
  mono: '"DejaVu Sans Mono", Menlo, monospace',
  arial: 'Arial, "Liberation Sans", Helvetica, sans-serif',
  times: '"Times New Roman", "Liberation Serif", Times, serif',
};

/**
 * Live preview of the final composition: draws the playing video through the same crop, rotation,
 * fit, colour and text steps the server applies with ffmpeg.
 */
@Component({
  selector: 'app-composition-preview',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="flex justify-center rounded-2xl bg-zinc-950 p-2">
      <canvas #canvas class="max-h-[50vh] max-w-full rounded-lg" [style.filter]="cssFilter()" [style.aspect-ratio]="ratioCss()"></canvas>
    </div>
  `,
})
export class CompositionPreview {
  readonly video = input<HTMLVideoElement | null>(null);
  readonly settings = input.required<PreviewSettings>();
  /** Time on the output timeline, for showing text overlays at the right moments. */
  readonly time = input(0);
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private frame = 0;

  // ffmpeg's eq brightness is additive (-0.5..0.5); CSS brightness is a multiplier. Close enough for a preview.
  protected readonly cssFilter = computed(() => {
    const s = this.settings();
    return `brightness(${1 + s.brightness}) contrast(${s.contrast}) saturate(${s.saturation})`;
  });
  protected readonly ratioCss = computed(() => String(this.outRatio()));
  private readonly outRatio = computed(() => {
    const s = this.settings();
    if (s.aspect) return s.aspect;
    const v = this.video();
    const vw = (v?.videoWidth || 16) * (s.crop?.w ?? 1);
    const vh = (v?.videoHeight || 9) * (s.crop?.h ?? 1);
    return s.rotate % 180 === 90 ? vh / vw : vw / vh;
  });

  constructor() {
    const loop = () => {
      this.draw();
      this.frame = requestAnimationFrame(loop);
    };
    this.frame = requestAnimationFrame(loop);
    inject(DestroyRef).onDestroy(() => cancelAnimationFrame(this.frame));
  }

  private draw(): void {
    const v = this.video();
    const canvas = this.canvas().nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx || !v || !v.videoWidth || document.hidden) return;
    const s = this.settings();
    const ratio = this.outRatio();
    const long = 640;
    const cw = Math.round(ratio >= 1 ? long : long * ratio);
    const ch = Math.round(ratio >= 1 ? long / ratio : long);
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }

    const crop = s.crop ?? { x: 0, y: 0, w: 1, h: 1 };
    let cx = crop.x;
    if (s.cropCenterAt && s.crop) cx = Math.min(1 - crop.w, Math.max(0, s.cropCenterAt(v.currentTime) - crop.w / 2));
    const sx = cx * v.videoWidth;
    const sy = crop.y * v.videoHeight;
    const sw = crop.w * v.videoWidth;
    const sh = crop.h * v.videoHeight;
    const turned = s.rotate % 180 === 90;
    const rw = turned ? sh : sw;
    const rh = turned ? sw : sh;

    const drawAt = (scale: number) => {
      ctx.save();
      ctx.translate(cw / 2, ch / 2);
      // ffmpeg flips after rotating, i.e. along the output's horizontal axis.
      if (s.flipH) ctx.scale(-1, 1);
      ctx.rotate((s.rotate * Math.PI) / 180);
      ctx.drawImage(v, sx, sy, sw, sh, (-sw * scale) / 2, (-sh * scale) / 2, sw * scale, sh * scale);
      ctx.restore();
    };
    const fill = Math.max(cw / rw, ch / rh);
    const contain = Math.min(cw / rw, ch / rh);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, cw, ch);
    if (s.fit === 'fill' || s.crop) {
      drawAt(fill);
    } else {
      if (s.fit === 'blur') {
        ctx.filter = 'blur(16px)';
        drawAt(fill * 1.05);
        ctx.filter = 'none';
      }
      drawAt(contain);
    }

    const t = this.time();
    for (const tx of s.texts) {
      if (!tx.text.trim()) continue;
      if ((tx.start !== undefined && t < tx.start) || (tx.end !== undefined && t > tx.end)) continue;
      const size = Math.round(ch * tx.size);
      ctx.font = `bold ${size}px ${FONT_FAMILIES[tx.font] ?? FONT_FAMILIES['sans']}`;
      ctx.textBaseline = 'top';
      const tw = ctx.measureText(tx.text).width;
      const x = (cw - tw) * tx.x;
      const y = (ch - size) * tx.y;
      if (tx.box) {
        const pad = size * 0.3;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(x - pad, y - pad, tw + pad * 2, size + pad * 2);
      }
      ctx.lineWidth = Math.max(1, size * 0.12);
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.strokeText(tx.text, x, y);
      ctx.fillStyle = tx.color;
      ctx.fillText(tx.text, x, y);
    }
  }
}
