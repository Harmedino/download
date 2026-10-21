import { formatBytes, formatDuration } from './format';

describe('format helpers', () => {
  it('formats bytes', () => {
    expect(formatBytes(null)).toBe('');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(48_000_000)).toBe('46 MB');
  });

  it('formats durations', () => {
    expect(formatDuration(null)).toBe('');
    expect(formatDuration(5)).toBe('0:05');
    expect(formatDuration(754)).toBe('12:34');
    expect(formatDuration(3725)).toBe('1:02:05');
  });
});
