import { Injectable, computed, inject, signal } from '@angular/core';
import { ApiService } from './api.service';
import type { ServerConfig, ToolType } from './models';

/** Server limits and feature flags, loaded once. Until it arrives, defaults match the server's. */
@Injectable({ providedIn: 'root' })
export class ConfigService {
  private readonly api = inject(ApiService);
  private readonly _config = signal<ServerConfig | null>(null);
  readonly config = this._config.asReadonly();
  readonly loaded = computed(() => this._config() !== null);
  readonly fileTtlMinutes = computed(() => this._config()?.fileTtlMinutes ?? 60);
  readonly maxMediaUploadMb = computed(() => this._config()?.maxMediaUploadMb ?? 500);
  readonly maxMediaMinutes = computed(() => this._config()?.maxMediaMinutes ?? 60);
  private requested = false;

  constructor() {
    this.load();
  }

  load(): void {
    if (this.requested) return;
    this.requested = true;
    this.api.config().subscribe({
      next: (c) => this._config.set(c),
      // Try again on the next call (e.g. the server was waking up).
      error: () => (this.requested = false),
    });
  }

  /** True once the server confirms the tool; unknown (not yet loaded) counts as available so links don't flicker. */
  has(tool: ToolType): boolean {
    const c = this._config();
    return !c || c.tools.includes(tool);
  }

  /** "1 hour", "30 minutes" */
  retentionText(): string {
    const m = this.fileTtlMinutes();
    if (m % 60 === 0) return m === 60 ? '1 hour' : `${m / 60} hours`;
    return `${m} minutes`;
  }
}
