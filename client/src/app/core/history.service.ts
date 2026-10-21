import { Injectable, computed, signal } from '@angular/core';
import type { HistoryEntry } from './models';

const KEY = 'snapgrab.history.v1';
const MAX = 30;

function load(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.slice(0, MAX) : [];
  } catch {
    return [];
  }
}

/** Recent downloads, kept only in this browser's localStorage. Nothing is sent to the server. */
@Injectable({ providedIn: 'root' })
export class HistoryService {
  private readonly _entries = signal<HistoryEntry[]>(load());
  readonly entries = this._entries.asReadonly();
  readonly count = computed(() => this._entries().length);

  add(entry: HistoryEntry): void {
    this.update([entry, ...this._entries().filter((e) => e.id !== entry.id)].slice(0, MAX));
  }

  remove(id: string): void {
    this.update(this._entries().filter((e) => e.id !== id));
  }

  clear(): void {
    this.update([]);
  }

  isExpired(e: HistoryEntry, now = Date.now()): boolean {
    return new Date(e.expiresAt).getTime() <= now;
  }

  private update(list: HistoryEntry[]): void {
    this._entries.set(list);
    try {
      localStorage.setItem(KEY, JSON.stringify(list));
    } catch {
      /* storage full or disabled: keep in memory only */
    }
  }
}
