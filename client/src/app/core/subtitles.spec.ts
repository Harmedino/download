import { cueAt, parseSubtitles, toSrt, toVtt } from './subtitles';

describe('subtitles', () => {
  const cues = [
    { start: 1.5, end: 3, text: 'Hello' },
    { start: 3.2, end: 3725.25, text: 'Two\nlines' },
  ];

  it('round-trips SRT and VTT', () => {
    expect(parseSubtitles(toSrt(cues))).toEqual(cues);
    expect(parseSubtitles(toVtt(cues))).toEqual(cues);
    expect(toSrt(cues).split('\n').slice(0, 3)).toEqual([
      '1',
      '00:00:01,500 --> 00:00:03,000',
      'Hello',
    ]);
  });

  it('reads short VTT timestamps, settings and tags', () => {
    const vtt =
      'WEBVTT\r\n\r\nNOTE a comment\r\n\r\nintro\r\n00:01.000 --> 00:02.500 align:start\r\n<v Sam>Hi <b>there</b>\r\n\r\nbad --> cue\r\nx\r\n';
    expect(parseSubtitles(vtt)).toEqual([{ start: 1, end: 2.5, text: 'Hi there' }]);
  });

  it('finds the cue at a time', () => {
    expect(cueAt(cues, 2)?.text).toBe('Hello');
    expect(cueAt(cues, 3.1)).toBeNull();
  });
});
