import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ConfigService } from '../../core/config.service';
import { TOOL_LINKS } from '../../core/tools';
import { ToolHeader } from '../../shared/tool-page';

@Component({
  selector: 'app-tools',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, ToolHeader],
  template: `
    <section class="mx-auto max-w-5xl px-4 pt-8 sm:pt-12">
      <app-tool-header title="All tools" subtitle="Paste a link or upload media, preview it, pick a tool, then download the result." />
      <ol class="mx-auto mt-6 flex max-w-3xl flex-wrap justify-center gap-2 text-xs text-zinc-500 dark:text-zinc-400" aria-label="How it works">
        @for (s of steps; track s; let i = $index) {
          <li class="rounded-full border border-zinc-200 px-3 py-1 dark:border-zinc-800">{{ i + 1 }}. {{ s }}</li>
        }
      </ol>
      <ul class="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        @for (t of tools(); track t.path) {
          <li>
            <a [routerLink]="t.path" class="flex h-full items-start gap-3 rounded-2xl border border-zinc-200 bg-white p-4 transition hover:border-violet-400 dark:border-zinc-800 dark:bg-zinc-900">
              <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white">
                <svg viewBox="0 0 24 24" class="h-5 w-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path [attr.d]="t.icon" /></svg>
              </span>
              <span>
                <span class="block font-semibold">{{ t.label }}</span>
                <span class="mt-0.5 block text-sm text-zinc-500 dark:text-zinc-400">{{ t.description }}</span>
              </span>
            </a>
          </li>
        }
      </ul>
    </section>
  `,
})
export class Tools {
  private readonly config = inject(ConfigService);
  protected readonly steps = ['Paste link or upload', 'Preview', 'Pick a tool', 'Edit', 'Export', 'Download'];
  protected readonly tools = computed(() => TOOL_LINKS.filter((t) => !t.tool || this.config.has(t.tool)));
}
