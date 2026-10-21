import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, signal } from '@angular/core';
import { ApiService } from '../../core/api.service';
import { formatBytes } from '../../core/format';
import { JobTracker } from '../../core/job-tracker';
import type { MediaFile } from '../../core/models';
import { JobPanel } from '../../shared/job-panel';
import { MediaSource } from '../../shared/media-source';
import { Spinner } from '../../shared/spinner';
import { ToolHeader, ui } from '../../shared/tool-page';

type Level = 'high' | 'balanced' | 'small';

@Component({
  selector: 'app-compress',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MediaSource, JobPanel, Spinner, ToolHeader],
  template: `
    <section class="mx-auto max-w-3xl px-4 pt-8 sm:pt-12">
      <app-tool-header title="Video compressor" subtitle="Make a video smaller for sharing or uploading. Pick a quality level, or a size to aim for." />
      <div class="mt-8 space-y-6">
        <app-media-source [(file)]="source" [fileId]="fileId()" [locked]="job.busy()" />
        @if (source(); as s) {
          <div [class]="ui.card">
            <div class="grid grid-cols-2 gap-1 rounded-xl bg-zinc-100 p-1 dark:bg-zinc-800" role="tablist">
              <button type="button" role="tab" [attr.aria-selected]="mode() === 'level'" (click)="mode.set('level')" class="rounded-lg px-3 py-1.5 text-sm font-medium" [class]="mode() === 'level' ? 'bg-white shadow dark:bg-zinc-950' : 'text-zinc-500'">Quality level</button>
              <button type="button" role="tab" [attr.aria-selected]="mode() === 'size'" (click)="mode.set('size')" class="rounded-lg px-3 py-1.5 text-sm font-medium" [class]="mode() === 'size' ? 'bg-white shadow dark:bg-zinc-950' : 'text-zinc-500'">Target size</button>
            </div>
            @if (mode() === 'level') {
              <div class="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Quality level">
                @for (l of levels; track l.id) {
                  <button type="button" role="radio" [attr.aria-checked]="level() === l.id" (click)="level.set(l.id)" class="rounded-2xl border p-3 text-left transition" [class]="level() === l.id ? ui.chipOn : ui.chipOff">
                    <span class="block text-sm font-semibold">{{ l.label }}</span>
                    <span class="block text-xs opacity-70">{{ l.hint }}</span>
                  </button>
                }
              </div>
            } @else {
              <label class="block">
                <span [class]="ui.label">Aim for (MB) · original is {{ formatBytes(s.size) }}</span>
                <input type="number" min="1" [max]="4000" step="1" [value]="targetMb()" (input)="targetMb.set(+$any($event.target).value)" [class]="ui.select" />
              </label>
              <p class="text-xs text-zinc-500 dark:text-zinc-400">We lower the bitrate (and the resolution, if needed) to land just under this size.</p>
            }
            <label class="block">
              <span [class]="ui.label">Maximum resolution</span>
              <select [class]="ui.select" [value]="resolution()" (change)="resolution.set(+$any($event.target).value)">
                <option value="0">{{ mode() === 'size' ? 'Automatic' : 'Keep original' }}</option>
                @for (r of [1080, 720, 480, 360]; track r) {
                  <option [value]="r">{{ r }}p</option>
                }
              </select>
            </label>
            <button type="button" [class]="ui.primary" [disabled]="job.busy() || (mode() === 'size' && !(targetMb() > 0))" (click)="start()">
              @if (job.busy()) {
                <app-spinner />
              }
              Compress video
            </button>
          </div>
          <app-job-panel [tracker]="job" [doneText]="doneText()" (retry)="start()" />
        }
      </div>
    </section>
  `,
})
export class Compress {
  private readonly api = inject(ApiService);
  readonly fileId = input<string | undefined>();
  protected readonly ui = ui;
  protected readonly formatBytes = formatBytes;
  protected readonly source = signal<MediaFile | null>(null);
  protected readonly mode = signal<'level' | 'size'>('level');
  protected readonly level = signal<Level>('balanced');
  protected readonly targetMb = signal(25);
  protected readonly resolution = signal(0);
  protected readonly job = new JobTracker(this.api);
  protected readonly levels: Array<{ id: Level; label: string; hint: string }> = [
    { id: 'high', label: 'High quality', hint: 'Light compression' },
    { id: 'balanced', label: 'Balanced', hint: 'Good for sharing' },
    { id: 'small', label: 'Smallest', hint: 'Visible quality loss' },
  ];
  protected readonly doneText = computed(() => {
    const r = this.job.job()?.result as { originalSize?: number; compressedSize?: number } | null;
    if (!r?.originalSize || !r.compressedSize) return 'Done! Your compressed video is ready.';
    const pct = Math.round((1 - r.compressedSize / r.originalSize) * 100);
    return `Done! ${formatBytes(r.originalSize)} → ${formatBytes(r.compressedSize)}${pct > 0 ? ` (${pct}% smaller)` : ''}.`;
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => this.job.cancel());
  }

  protected start(): void {
    const s = this.source();
    if (!s) return;
    this.job.run(
      this.api.startTool('compress', {
        fileId: s.id,
        level: this.level(),
        targetMb: this.mode() === 'size' ? this.targetMb() : undefined,
        resolution: this.resolution() || undefined,
      }),
    );
  }
}
