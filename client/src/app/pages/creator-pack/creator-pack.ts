import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { ApiService } from '../../core/api.service';
import { ConfigService } from '../../core/config.service';
import { JobTracker } from '../../core/job-tracker';
import type { MediaFile } from '../../core/models';
import { LANGUAGES } from '../../core/subtitles';
import { formatTime } from '../../core/time';
import { JobPanel } from '../../shared/job-panel';
import { MediaSource } from '../../shared/media-source';
import { RangePlayer } from '../../shared/range-player';
import { Spinner } from '../../shared/spinner';
import { ToolHeader, ui } from '../../shared/tool-page';

type Item =
  'original' | 'edited' | 'thumbnail' | 'audio' | 'subtitles' | 'transcript' | 'frames' | 'ai';

interface Suggestions {
  titles: string[];
  descriptions: string[];
  hashtags: string[];
  notes: string;
}

@Component({
  selector: 'app-creator-pack',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MediaSource, RangePlayer, JobPanel, Spinner, ToolHeader],
  template: `
    <section class="mx-auto max-w-6xl px-4 pt-8 sm:pt-12">
      <app-tool-header
        title="Creator Pack"
        subtitle="Everything you need to publish a video, in one ZIP: the video, a thumbnail, audio, subtitles, a transcript, frames and AI-drafted titles, descriptions and hashtags."
      />
      @if (!source()) {
        <div class="mx-auto mt-8 max-w-2xl">
          <app-media-source [(file)]="source" [fileId]="fileId()" />
        </div>
      } @else {
        @let s = source()!;
        <div class="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div class="min-w-0 space-y-4">
            <app-range-player [file]="s" [(time)]="time" [showRange]="false" />
            @if (want().has('thumbnail')) {
              <div class="flex flex-wrap items-center gap-2 text-sm">
                <button
                  type="button"
                  class="rounded-xl bg-zinc-900 px-4 py-2 font-semibold text-white dark:bg-white dark:text-zinc-900"
                  (click)="thumbAt.set(time())"
                >
                  Use {{ fmt(time()) }} as thumbnail
                </button>
                <span class="text-zinc-500 dark:text-zinc-400">{{
                  thumbAt() === null
                    ? 'Thumbnail: a third of the way in'
                    : 'Thumbnail at ' + fmt(thumbAt()!)
                }}</span>
              </div>
            }
            @if (want().has('edited')) {
              <div [class]="ui.card">
                <p class="text-sm font-medium">Edited version</p>
                <app-media-source [(file)]="edited" />
              </div>
            }
          </div>

          <div class="space-y-4">
            <div [class]="ui.card">
              <div class="flex items-center justify-between gap-2">
                <p class="truncate text-sm font-medium" [title]="s.name">{{ s.name }}</p>
                <button
                  type="button"
                  class="shrink-0 text-sm underline"
                  [disabled]="job.busy()"
                  (click)="source.set(null)"
                >
                  Change
                </button>
              </div>
              <fieldset>
                <legend [class]="ui.label">Include</legend>
                <ul class="space-y-1">
                  @for (it of items; track it.id) {
                    <li>
                      <label
                        class="flex items-start gap-3 rounded-xl p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                      >
                        <input
                          type="checkbox"
                          class="mt-1 accent-violet-600"
                          [checked]="want().has(it.id)"
                          (change)="toggle(it.id, $any($event.target).checked)"
                        />
                        <span class="text-sm">
                          <span class="block font-medium">{{ it.label }}</span>
                          <span class="block text-xs text-zinc-500 dark:text-zinc-400">{{
                            it.hint
                          }}</span>
                          @if (unavailable(it.id); as why) {
                            <span class="block text-xs text-amber-700 dark:text-amber-300">{{
                              why
                            }}</span>
                          }
                        </span>
                      </label>
                    </li>
                  }
                </ul>
              </fieldset>
              @if (want().has('frames')) {
                <label class="block">
                  <span [class]="ui.label">Frames</span>
                  <select
                    [class]="ui.select"
                    [value]="frameCount()"
                    (change)="frameCount.set(+$any($event.target).value)"
                  >
                    @for (n of [4, 6, 8, 12, 16, 24]; track n) {
                      <option [value]="n" [selected]="n === frameCount()">{{ n }} frames, evenly spaced</option>
                    }
                  </select>
                </label>
              }
              @if (needsSpeech() && config.transcription() !== false) {
                <label class="block">
                  <span [class]="ui.label">Spoken language</span>
                  <select
                    [class]="ui.select"
                    [value]="language()"
                    (change)="language.set($any($event.target).value)"
                  >
                    @for (l of languages; track l.code) {
                      <option [value]="l.code" [selected]="l.code === language()">{{ l.label }}</option>
                    }
                  </select>
                </label>
              }
              <button
                type="button"
                [class]="ui.primary"
                [disabled]="job.busy() || !canStart()"
                (click)="build()"
              >
                @if (job.busy()) {
                  <app-spinner />
                }
                Build Creator Pack
              </button>
              @if (want().has('edited') && !edited()) {
                <p class="text-xs text-amber-700 dark:text-amber-300">
                  Add the edited version, or untick it.
                </p>
              }
            </div>
          </div>
        </div>

        <div class="mx-auto mt-6 max-w-2xl space-y-4">
          <app-job-panel
            [tracker]="job"
            doneText="Your Creator Pack is ready."
            [showPreview]="false"
            (retry)="build()"
          />
          @if (suggestions(); as sg) {
            <div [class]="ui.card">
              <div>
                <p class="text-sm font-semibold">AI suggestions</p>
                <p class="text-xs text-zinc-500 dark:text-zinc-400">
                  Drafts by {{ aiSource() }}, based on this video's
                  {{ basedOnTranscript() ? 'transcript and frames' : 'frames only' }}. Check them
                  before you publish.
                </p>
              </div>
              <div>
                <p [class]="ui.label">Titles</p>
                <ul class="space-y-1">
                  @for (t of sg.titles; track $index) {
                    <li
                      class="flex items-center gap-2 rounded-xl bg-zinc-100 px-3 py-2 text-sm dark:bg-zinc-800"
                    >
                      <span class="flex-1">{{ t }}</span>
                      <button type="button" class="text-xs underline" (click)="copy(t)">
                        Copy
                      </button>
                    </li>
                  }
                </ul>
              </div>
              <div>
                <p [class]="ui.label">Descriptions</p>
                @for (d of sg.descriptions; track $index) {
                  <div class="mb-2 rounded-xl bg-zinc-100 px-3 py-2 text-sm dark:bg-zinc-800">
                    <p>{{ d }}</p>
                    <button type="button" class="mt-1 text-xs underline" (click)="copy(d)">
                      Copy
                    </button>
                  </div>
                }
              </div>
              <div>
                <p [class]="ui.label">Hashtags</p>
                <p class="text-sm text-violet-700 dark:text-violet-300">
                  {{ sg.hashtags.join(' ') }}
                </p>
                <button
                  type="button"
                  class="mt-1 text-xs underline"
                  (click)="copy(sg.hashtags.join(' '))"
                >
                  Copy all
                </button>
              </div>
              @if (sg.notes) {
                <p class="text-xs text-zinc-500 dark:text-zinc-400">{{ sg.notes }}</p>
              }
              @if (copied()) {
                <p class="text-xs text-emerald-600" role="status">Copied.</p>
              }
            </div>
          }
        </div>
      }
    </section>
  `,
})
export class CreatorPack {
  private readonly api = inject(ApiService);
  protected readonly config = inject(ConfigService);
  readonly fileId = input<string | undefined>();
  protected readonly ui = ui;
  protected readonly languages = LANGUAGES;
  protected readonly fmt = formatTime;
  protected readonly items: Array<{ id: Item; label: string; hint: string }> = [
    { id: 'original', label: 'Original video', hint: 'The file as you uploaded or downloaded it.' },
    {
      id: 'edited',
      label: 'Edited video',
      hint: 'An edited version, e.g. from the Video Editor or Video to Shorts.',
    },
    {
      id: 'thumbnail',
      label: 'Thumbnail',
      hint: 'A full-resolution JPG from the moment you pick.',
    },
    { id: 'audio', label: 'Audio', hint: 'The soundtrack as MP3.' },
    { id: 'subtitles', label: 'Subtitles', hint: 'SRT and VTT from speech recognition.' },
    { id: 'transcript', label: 'Transcript', hint: 'Plain text with timestamps.' },
    { id: 'frames', label: 'Frames', hint: 'Evenly spaced stills as JPG.' },
    {
      id: 'ai',
      label: 'AI titles, descriptions and hashtags',
      hint: "Drafts based only on the video's transcript and frames.",
    },
  ];
  protected readonly source = signal<MediaFile | null>(null);
  protected readonly edited = signal<MediaFile | null>(null);
  protected readonly time = signal(0);
  protected readonly thumbAt = signal<number | null>(null);
  protected readonly want = signal(
    new Set<Item>(['original', 'thumbnail', 'audio', 'subtitles', 'transcript', 'frames', 'ai']),
  );
  protected readonly frameCount = signal(8);
  protected readonly language = signal('auto');
  protected readonly copied = signal(false);
  protected readonly job = new JobTracker(this.api);

  protected readonly needsSpeech = computed(() =>
    ['subtitles', 'transcript', 'ai'].some((k) => this.want().has(k as Item)),
  );
  protected readonly canStart = computed(
    () => this.want().size > 0 && (!this.want().has('edited') || !!this.edited()),
  );
  private readonly result = computed(() =>
    this.job.state() === 'done'
      ? (this.job.job()?.result as {
          suggestions?: Suggestions | null;
          aiSource?: string | null;
          cues?: unknown[] | null;
        } | null)
      : null,
  );
  protected readonly suggestions = computed(() => this.result()?.suggestions ?? null);
  protected readonly aiSource = computed(() => this.result()?.aiSource ?? 'AI');
  protected readonly basedOnTranscript = computed(() => !!this.result()?.cues?.length);

  constructor() {
    effect(() => {
      this.source();
      untracked(() => {
        this.thumbAt.set(null);
        this.edited.set(null);
        this.job.reset();
      });
    });
    inject(DestroyRef).onDestroy(() => this.job.cancel());
  }

  /** Why an item will be skipped on this server, so nobody is surprised by the README. */
  protected unavailable(id: Item): string | null {
    const s = this.source();
    if (
      (id === 'audio' || id === 'subtitles' || id === 'transcript') &&
      s?.info &&
      !s.info.hasAudio
    )
      return 'This video has no audio, so this will be skipped.';
    if ((id === 'subtitles' || id === 'transcript') && this.config.transcription() === false)
      return "Speech recognition isn't set up on this server, so this will be skipped.";
    if (id === 'ai' && this.config.llm() === false)
      return "AI writing isn't set up on this server, so this will be skipped.";
    if (id === 'ai' && this.config.transcription() === false)
      return 'Without speech recognition, suggestions are based on frames only.';
    return null;
  }

  protected toggle(id: Item, on: boolean): void {
    this.want.update((w) => {
      const next = new Set(w);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  protected build(): void {
    const s = this.source();
    if (!s || !this.canStart()) return;
    const items = this.items.map((i) => i.id).filter((id) => this.want().has(id));
    this.job.run(
      this.api.startTool('creator-pack', {
        fileId: s.id,
        editedFileId: this.want().has('edited') ? this.edited()?.id : undefined,
        items,
        thumbnailTime: this.thumbAt() ?? undefined,
        frameCount: this.frameCount(),
        language: this.language(),
      }),
    );
  }

  protected copy(text: string): void {
    void navigator.clipboard?.writeText(text).then(() => {
      this.copied.set(true);
      setTimeout(() => this.copied.set(false), 1500);
    });
  }
}
