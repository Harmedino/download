import { TestBed } from '@angular/core/testing';
import { HistoryService } from './history.service';
import type { HistoryEntry } from './models';

const entry = (id: string, expiresAt = new Date(Date.now() + 60_000).toISOString()): HistoryEntry => ({
  id,
  sourceUrl: 'https://youtu.be/x',
  platform: 'youtube',
  title: 't',
  thumbnail: null,
  fileName: 'f.mp4',
  fileUrl: 'http://localhost/api/files/' + id,
  size: 1,
  createdAt: new Date().toISOString(),
  expiresAt,
});

describe('HistoryService', () => {
  beforeEach(() => localStorage.clear());

  it('adds newest first, dedupes, and persists to localStorage', () => {
    const s = TestBed.inject(HistoryService);
    s.add(entry('a'));
    s.add(entry('b'));
    s.add(entry('a'));
    expect(s.entries().map((e) => e.id)).toEqual(['a', 'b']);
    expect(JSON.parse(localStorage.getItem('snapgrab.history.v1')!).length).toBe(2);
  });

  it('caps the list at 30 and can clear', () => {
    const s = TestBed.inject(HistoryService);
    for (let i = 0; i < 35; i++) s.add(entry(String(i)));
    expect(s.count()).toBe(30);
    s.clear();
    expect(s.count()).toBe(0);
  });

  it('detects expired entries', () => {
    const s = TestBed.inject(HistoryService);
    expect(s.isExpired(entry('x', new Date(Date.now() - 1).toISOString()))).toBe(true);
    expect(s.isExpired(entry('y'))).toBe(false);
  });
});
