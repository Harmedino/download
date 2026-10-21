import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-terms',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink],
  template: `
    <article class="mx-auto max-w-2xl px-4 pt-10 leading-relaxed text-zinc-700 dark:text-zinc-300">
      <h1 class="text-3xl font-bold text-zinc-900 dark:text-white">Terms of Use</h1>
      <p class="mt-2 text-sm text-zinc-500">Please read these terms before using SnapGrab.</p>

      <h2 class="mt-8 text-lg font-semibold text-zinc-900 dark:text-white">1. Your content, your responsibility</h2>
      <p class="mt-2">
        You may only download, save or edit content that you own, or that you have clear permission from the rights holder to use.
        Downloading copyrighted material without permission may violate the law and the platform's terms of service. You are
        solely responsible for how you use any file you download or create with SnapGrab.
      </p>

      <h2 class="mt-6 text-lg font-semibold text-zinc-900 dark:text-white">2. Public posts only</h2>
      <p class="mt-2">
        SnapGrab only works with publicly available posts. We will never ask for, collect or store your social media usernames,
        passwords or cookies. Do not use SnapGrab to access private or restricted content.
      </p>

      <h2 class="mt-6 text-lg font-semibold text-zinc-900 dark:text-white">3. Temporary storage</h2>
      <p class="mt-2">
        Files you download or upload for background removal are stored on our server only temporarily and are automatically deleted
        after about 1 hour. Your recent-downloads list is kept only in your own browser (localStorage) and is never sent to us.
      </p>

      <h2 class="mt-6 text-lg font-semibold text-zinc-900 dark:text-white">4. Fair use of the service</h2>
      <p class="mt-2">
        Requests are rate-limited to keep the service available for everyone. Uploads are limited to 50 MB, and background
        removal works on images only. Automated scraping or abuse of the service is not allowed.
      </p>

      <h2 class="mt-6 text-lg font-semibold text-zinc-900 dark:text-white">5. No affiliation, no warranty</h2>
      <p class="mt-2">
        SnapGrab is not affiliated with any of the platforms it supports. The service is provided "as is",
        without warranties of any kind, and may stop working for a platform at any time.
      </p>

      <h2 class="mt-6 text-lg font-semibold text-zinc-900 dark:text-white">6. Takedown requests</h2>
      <p class="mt-2">
        If you believe SnapGrab is being used to infringe your rights, contact the site operator and we will respond promptly.
      </p>

      <a routerLink="/" class="mt-10 inline-block font-medium text-violet-600 hover:underline dark:text-violet-300">← Back to SnapGrab</a>
    </article>
  `,
})
export class Terms {}
