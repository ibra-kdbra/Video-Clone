/**
 * Storyboards: the WebVTT file that maps each stretch of a video to a thumbnail inside a sprite
 * sheet ("https://…/storyboard-0.jpg#xywh=160,0,160,90"), shown above the seek bar while scrubbing.
 */

/** "01:02:03.500" or "02:03.500" → seconds, or NaN. */
export function parseTimestamp(text) {
  const match = /^(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/.exec(text.trim());
  if (!match) return Number.NaN;
  const [, hours = '0', minutes, seconds, fraction = '0'] = match;
  return Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds) + Number(fraction.padEnd(3, '0')) / 1000;
}

/**
 * The cues of a storyboard, in time order: `{ start, end, url, x, y, width, height }`. Image
 * addresses are resolved against `base` (the VTT file's own address), and only http(s) images
 * are kept, so a malformed file can't point the page anywhere odd. Anything unreadable is skipped.
 */
export function parseStoryboard(vtt, base) {
  if (typeof vtt !== 'string' || !/^\uFEFF?WEBVTT/.test(vtt)) return [];
  const cues = [];
  const lines = vtt.replace(/\r\n?/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const timing = /^\s*(\S+)\s+-->\s+(\S+)/.exec(lines[i]);
    if (!timing) continue;
    const start = parseTimestamp(timing[1]);
    const end = parseTimestamp(timing[2]);
    const payload = (lines[i + 1] ?? '').trim();
    const sprite = /^(.+)#xywh=(\d+),(\d+),(\d+),(\d+)$/.exec(payload);
    if (!Number.isFinite(start) || !(end > start) || !sprite) continue;
    let url;
    try {
      url = new URL(sprite[1], base);
    } catch {
      continue;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
    const [x, y, width, height] = sprite.slice(2).map(Number);
    if (!(width > 0 && height > 0)) continue;
    cues.push({ start, end, url: url.href, x, y, width, height });
    i += 1;
  }
  return cues.sort((a, b) => a.start - b.start);
}

/** The cue showing at `time` (a binary search), or the nearest one before it; null when none. */
export function cueAt(cues, time) {
  if (!cues?.length || !Number.isFinite(time)) return null;
  let low = 0;
  let high = cues.length - 1;
  if (time < cues[0].start) return cues[0];
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (cues[middle].start <= time) low = middle;
    else high = middle - 1;
  }
  return cues[low];
}

/** The distinct sprite sheets, to preload before the first scrub. */
export const spriteSheets = (cues) => [...new Set(cues.map((cue) => cue.url))];
