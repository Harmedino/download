import { ChangeDetectionStrategy, Component, ElementRef, inject, input, model } from '@angular/core';

export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Largest centred rectangle with `ratio` (width/height in pixels) inside a `width` x `height` frame, as fractions. */
export function centeredCrop(ratio: number | null, width: number, height: number, cx = 0.5, cy = 0.5): CropRect {
  if (!ratio) return { x: 0, y: 0, w: 1, h: 1 };
  let w = 1;
  let h = (width / ratio / height) * w;
  if (h > 1) {
    h = 1;
    w = (height * ratio) / width;
  }
  return clampRect({ x: cx - w / 2, y: cy - h / 2, w, h });
}

export function clampRect(r: CropRect): CropRect {
  const w = Math.min(1, Math.max(0.05, r.w));
  const h = Math.min(1, Math.max(0.05, r.h));
  return { w, h, x: Math.min(1 - w, Math.max(0, r.x)), y: Math.min(1 - h, Math.max(0, r.y)) };
}

/**
 * A draggable crop rectangle laid over a video. Place it in a relatively positioned box that has the
 * video's exact aspect ratio. Drag inside to move, drag the corner to resize (keeping `ratio` if set).
 */
@Component({
  selector: 'app-crop-box',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'absolute inset-0 block overflow-hidden touch-none' },
  template: `
    @let r = rect();
    <div
      class="absolute cursor-move border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]"
      [style.left.%]="r.x * 100"
      [style.top.%]="r.y * 100"
      [style.width.%]="r.w * 100"
      [style.height.%]="r.h * 100"
      (pointerdown)="down($event, 'move')"
      role="group"
      aria-label="Crop area. Drag to move."
    >
      <div class="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
        @for (i of grid; track i) {
          <span class="border border-white/25"></span>
        }
      </div>
      <span
        class="absolute -right-2 -bottom-2 h-5 w-5 cursor-nwse-resize rounded-full border-2 border-white bg-violet-600"
        (pointerdown)="down($event, 'resize')"
        aria-hidden="true"
      ></span>
    </div>
  `,
})
export class CropBox {
  readonly rect = model<CropRect>({ x: 0, y: 0, w: 1, h: 1 });
  /** Width/height in pixels to keep, or null for a free crop. */
  readonly ratio = input<number | null>(null);
  /** Source frame size, needed to keep a pixel ratio in fractional coordinates. */
  readonly frameWidth = input(16);
  readonly frameHeight = input(9);
  private readonly host = inject(ElementRef<HTMLElement>);
  protected readonly grid = [0, 1, 2, 3, 4, 5, 6, 7, 8];

  protected down(ev: PointerEvent, mode: 'move' | 'resize'): void {
    ev.preventDefault();
    ev.stopPropagation();
    const el = ev.currentTarget as HTMLElement;
    el.setPointerCapture?.(ev.pointerId);
    const box = this.host.nativeElement.getBoundingClientRect();
    const start = { x: ev.clientX, y: ev.clientY, rect: this.rect() };
    const move = (e: PointerEvent) => {
      const dx = (e.clientX - start.x) / box.width;
      const dy = (e.clientY - start.y) / box.height;
      const s = start.rect;
      if (mode === 'move') return this.rect.set(clampRect({ ...s, x: s.x + dx, y: s.y + dy }));
      let w = Math.max(0.05, Math.min(1 - s.x, s.w + dx));
      let h = Math.max(0.05, Math.min(1 - s.y, s.h + dy));
      const ratio = this.ratio();
      if (ratio) {
        // Fractional height that keeps the pixel ratio for this width, shrinking both if it would overflow.
        const k = this.frameWidth() / this.frameHeight() / ratio;
        h = w * k;
        if (s.y + h > 1) {
          h = 1 - s.y;
          w = h / k;
        }
      }
      this.rect.set(clampRect({ x: s.x, y: s.y, w, h }));
    };
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }
}
