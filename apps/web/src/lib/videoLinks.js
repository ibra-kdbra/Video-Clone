import { EMBED_REF_FORMAT } from '@grand/contracts';

import { SOURCE_LABELS } from './sources.js';

/**
 * Reads a pasted video address: which platform it's on, and the video's id there. The id is then
 * checked against the API's own formats (EMBED_REF_FORMAT), so whatever this accepts, the server
 * accepts too. Twitch works for clips only, since those are what its player embeds.
 */

const YOUTUBE_HOSTS = /^(?:www\.|m\.|music\.)?(?:youtube\.com|youtube-nocookie\.com)$/;
const DAILYMOTION_HOSTS = /^(?:www\.|geo\.)?dailymotion\.com$/;

function youtubeId(url) {
  const host = url.hostname.toLowerCase();
  if (host === 'youtu.be') return url.pathname.split('/')[1];
  if (!YOUTUBE_HOSTS.test(host)) return undefined;
  if (url.pathname === '/watch') return url.searchParams.get('v');
  const [, kind, id] = url.pathname.split('/');
  return ['embed', 'shorts', 'live', 'v', 'e'].includes(kind) ? id : null;
}

function dailymotionId(url) {
  const host = url.hostname.toLowerCase();
  if (host === 'dai.ly') return url.pathname.split('/')[1];
  if (!DAILYMOTION_HOSTS.test(host)) return undefined;
  // geo.dailymotion.com/player/xyz.html?video=x8abc and …/player.html?video=x8abc
  if (url.searchParams.has('video')) return url.searchParams.get('video');
  const parts = url.pathname.split('/').filter(Boolean);
  const at = parts.indexOf('video');
  // Older addresses add the title after an underscore: /video/x7tgad0_my-talk
  return at === -1 ? null : parts[at + 1]?.split('_')[0];
}

function twitchClip(url) {
  const host = url.hostname.toLowerCase();
  if (host === 'clips.twitch.tv') return url.pathname === '/embed' ? url.searchParams.get('clip') : url.pathname.split('/')[1];
  if (!/^(?:www\.|m\.)?twitch\.tv$/.test(host)) return undefined;
  const parts = url.pathname.split('/').filter(Boolean);
  // twitch.tv/{channel}/clip/{slug} and m.twitch.tv/clip/{slug}
  const at = parts.indexOf('clip');
  return at === -1 ? null : parts[at + 1];
}

const READERS = [
  ['youtube', youtubeId],
  ['dailymotion', dailymotionId],
  ['twitch', twitchClip],
];

/**
 * `{ provider, ref }` for a YouTube, Dailymotion or Twitch clip address (with or without
 * "https://"), or `{ error }` saying what's wrong with it, or null for an empty input.
 */
export function parseVideoLink(input) {
  const text = String(input ?? '').trim();
  if (!text) return null;
  let url;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return { error: "That doesn't look like a web address." };
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return { error: "That doesn't look like a web address." };

  for (const [provider, read] of READERS) {
    const id = read(url);
    if (id === undefined) continue;
    if (provider === 'twitch' && !id) return { error: 'Only Twitch clips can be linked. Open the clip and copy its address.' };
    if (id && EMBED_REF_FORMAT[provider].test(id)) return { provider, ref: id };
    return { error: `That ${SOURCE_LABELS[provider]} address doesn't point to a video.` };
  }
  return { error: 'Paste a link to a YouTube video, a Dailymotion video or a Twitch clip.' };
}
