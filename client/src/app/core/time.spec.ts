import { formatTime, parseTime } from './time';

describe('time', () => {
  it('formats and parses times', () => {
    expect(formatTime(83.44)).toBe('1:23.4');
    expect(formatTime(3725)).toBe('1:02:05.0');
    expect(parseTime('1:23.4')).toBeCloseTo(83.4);
    expect(parseTime('90')).toBe(90);
    expect(parseTime('1:02:05')).toBe(3725);
    expect(parseTime('abc')).toBeNull();
    expect(parseTime('1:-2')).toBeNull();
  });
});
