import { Injectable, signal } from '@angular/core';
import type { FetchResponse } from './models';

/** Holds the most recent fetch result so the result page can render without refetching. */
@Injectable({ providedIn: 'root' })
export class MediaStateService {
  readonly current = signal<FetchResponse | null>(null);
}
