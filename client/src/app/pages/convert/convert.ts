import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, input, signal } from '@angular/core';
import { ApiService } from '../../core/api.service';
import { JobTracker } from '../../core/job-tracker';
import type { MediaFile } from '../../core/models';
import { JobPanel } from '../../shared/job-panel';
import { MediaSource } from '../../shared/media-source';
import { Spinner } from '../../shared/spinner';
import { ToolHeader, ui } from '../../shared/tool-page';

type Format = 'mp4' | 'webm' | 'mov' | 'mkv' | 'mp3' | 'm4a' | 'wav';

@Component({
  selector: 'app-convert',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MediaSource, JobPanel, Spinner, ToolHeader],
  template: `
    <section class="mx-auto max-w-3xl px-4 pt-8 sm:pt-12">
      <app-tool-header title="Video converter" subtitle="Convert to MP4, WebM, MOV or MKV, change resolution and frame rate, or pull the audio out as MP3, M4A or WAV." />
      <div class="mt-8 space-y-6">
        <app-media-source [(file)]="source" [accept]="['video', 'audio']" [fileId]="fileId()" [locked]="job.busy()" />
        @if (source(); as s) {
          <div [class]="ui.card">
            <fieldset>
              <legend [class]="ui.label">Format</legend>
              <div class="flex flex-wrap gap-2" role="radiogroup">
                @for (f of formats(); track f.id) {
                  <button type="button" role="radio" [attr.aria-checked]="format() === f.id" (click)="format.set(f.id)" [class]="ui.chip + ' ' + (format() === f.id ? ui.chipOn : ui.chipOff)">
                    {{ f.label }}
                  </button>
                }
              </div>
            </fieldset>
            @if (isVideoFormat()) {
              <div class="grid gap-4 sm:grid-cols-2">
                <label class="block">
                  <span [class]="ui.label">Resolution</span>
                  <select [class]="ui.select" [value]="resolution()" (change)="resolution.set(+$any($event.target).value)">
                    <option value="0">Original{{ s.info?.height ? ' (' + s.info!.width + '×' + s.info!.height + ')' : '' }}</option>
                    @for (r of resolutions; track r) {
                      <option [value]="r">{{ r }}p</option>
                    }
                  </select>
                </label>
                <label class="block">
                  <span [class]="ui.label">Frame rate</span>
                  <select [class]="ui.select" [value]="fps()" (change)="fps.set(+$any($event.target).value)">
                    <option value="0">Original{{ s.info?.fps ? ' (' + s.info!.fps + ')' : '' }}</option>
                    @for (f of [24, 25, 30, 50, 60]; track f) {
                      <option [value]="f">{{ f }} fps</option>
                    }
                  </select>
                </label>
              </div>
              <p class="text-xs text-zinc-500 dark:text-zinc-400">Videos are never upscaled. When nothing but the container changes, the streams are copied without quality loss.</p>
            }
            <button type="button" [class]="ui.primary" [disabled]="job.busy()" (click)="start()">
              @if (job.busy()) {
                <app-spinner />
              }
              Convert to {{ format().toUpperCase() }}
            </button>
          </div>
          <app-job-panel [tracker]="job" (retry)="start()" />
        }
      </div>
    </section>
  `,
})
export class Convert {
  private readonly api = inject(ApiService);
  readonly fileId = input<string | undefined>();
  protected readonly ui = ui;
  protected readonly source = signal<MediaFile | null>(null);
  protected readonly format = signal<Format>('mp4');
  protected readonly resolution = signal(0);
  protected readonly fps = signal(0);
  protected readonly resolutions = [2160, 1440, 1080, 720, 480, 360];
  protected readonly job = new JobTracker(this.api);
  protected readonly isVideoFormat = computed(() => ['mp4', 'webm', 'mov', 'mkv'].includes(this.format()));
  protected readonly formats = computed(() => {
    const audio = [
      { id: 'mp3' as const, label: 'MP3' },
      { id: 'm4a' as const, label: 'M4A' },
      { id: 'wav' as const, label: 'WAV' },
    ];
    if (this.source()?.info?.kind === 'audio') return audio;
    return [{ id: 'mp4' as const, label: 'MP4' }, { id: 'webm' as const, label: 'WebM' }, { id: 'mov' as const, label: 'MOV' }, { id: 'mkv' as const, label: 'MKV' }, ...audio];
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => this.job.cancel());
  }

  protected start(): void {
    const s = this.source();
    if (!s) return;
    if (!this.formats().some((f) => f.id === this.format())) this.format.set(this.formats()[0]!.id);
    this.job.run(
      this.api.startTool('convert', {
        fileId: s.id,
        format: this.format(),
        resolution: this.isVideoFormat() && this.resolution() ? this.resolution() : undefined,
        fps: this.isVideoFormat() && this.fps() ? this.fps() : undefined,
      }),
    );
  }
}
