import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Title block shared by the tool pages, matching the Remove BG page. */
@Component({
  selector: 'app-tool-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="text-center">
      <h1 class="text-3xl font-extrabold tracking-tight sm:text-4xl">{{ title() }}</h1>
      <p class="mx-auto mt-2 max-w-xl text-zinc-600 dark:text-zinc-400">{{ subtitle() }}</p>
    </div>
  `,
})
export class ToolHeader {
  readonly title = input.required<string>();
  readonly subtitle = input('');
}

/** Shared class strings so every tool's controls look the same. */
export const ui = {
  card: 'space-y-5 rounded-3xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-900',
  label: 'mb-2 block text-sm font-medium',
  select: 'h-11 w-full rounded-xl border border-zinc-200 bg-transparent px-3 text-sm dark:border-zinc-700 dark:bg-zinc-900',
  primary:
    'inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-violet-600 to-fuchsia-600 font-semibold text-white shadow-lg transition hover:brightness-110 disabled:opacity-50',
  chip: 'rounded-xl border px-3 py-2 text-sm font-medium transition',
  chipOn: 'border-violet-500 bg-violet-500/10 text-violet-700 dark:text-violet-200',
  chipOff: 'border-zinc-200 hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600',
};
