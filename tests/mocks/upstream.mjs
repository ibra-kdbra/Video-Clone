/**
 * A stand-in for the YouTube, Dailymotion and Twitch APIs, for local development without keys
 * (`npm run dev:mock`) and for tests. It answers the same endpoints with deterministic,
 * realistic-looking data. Images are small generated SVGs served by the dev server under /__mock/.
 * Channels and titles are made up.
 */

// Math.imul keeps the arithmetic in 32 bits; plain `*` would lose the low bits past 2^53.
const hash = (text) => [...String(text)].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);

function idFrom(seed, length, alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_') {
  let n = hash(seed);
  let id = '';
  for (let i = 0; i < length; i++) {
    n = (Math.imul(n, 1103515245) + 12345) >>> 0;
    id += alphabet[(n >>> 16) % alphabet.length];
  }
  return id;
}

const videoId = (seed) => idFrom(seed, 11);

/** Made-up YouTube channels, with well-formed (UC + 22 characters) ids. */
export const CHANNELS = [
  'Pixel Forge',
  'Code Atlas',
  'Northwind Labs',
  'Studio Lumen',
  'Field Notes',
  'Deep Signal',
  'Sonic Arcade',
  'Orbit Kitchen',
].map((title) => [`UC${idFrom(`channel-${title}`, 22)}`, title]);

const TEMPLATES = [
  (t) => `${t} explained in 12 minutes`,
  (t) => `I tried ${t.toLowerCase()} for 30 days. Here's what happened`,
  // Escaped, like the real YouTube API returns titles.
  (t) => `Nor&#39;easter &amp; ${t}: what you need to know`,
  (t) => `The complete ${t} guide for 2026`,
  (t) => `${t}: 7 mistakes everyone makes`,
  (t) => `Why ${t.toLowerCase()} is harder than it looks`,
  (t) => `Building a real project with ${t}`,
  (t) => `${t} tier list (honest ranking)`,
  (t) => `Live Q&amp;A: your ${t.toLowerCase()} questions answered`,
  (t) => `The history of ${t.toLowerCase()}, fast`,
  (t) => `Beginner to pro: ${t} crash course`,
  (t) => `${t} in 100 seconds`,
];

const label = (q) => String(q).replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 40);
const thumbUrl = (id, width, text) => `/__mock/thumb/${id}.svg?w=${width}&t=${encodeURIComponent(text)}`;
const avatarUrl = (id, text) => `/__mock/avatar/${id}.svg?t=${encodeURIComponent(text)}`;

const thumbs = (id, text) => ({
  default: { url: thumbUrl(id, 120, text), width: 120, height: 90 },
  medium: { url: thumbUrl(id, 320, text), width: 320, height: 180 },
  high: { url: thumbUrl(id, 480, text), width: 480, height: 360 },
  standard: { url: thumbUrl(id, 640, text), width: 640, height: 480 },
});

const daysAgo = (days) => new Date(Date.UTC(2026, 8, 28, 12) - days * 86_400_000).toISOString();

/** How each listed video was generated, so its detail page shows the same title and channel. */
const made = new Map();

function snippetFor(id, topic, i, channel = CHANNELS[hash(id) % CHANNELS.length]) {
  if (!made.has(id)) made.set(id, { topic, i, channel });
  const [channelId, channelTitle] = channel;
  const title = TEMPLATES[i % TEMPLATES.length](label(topic));
  return {
    publishedAt: daysAgo((i * 3 + (hash(id) % 3)) % 90),
    channelId,
    title,
    description: `A clear, practical look at ${label(topic)}. Chapters, links and sources are below.\n\nhttps://example.com/notes/${id}\n\nEpisode ${i + 1} of the series &quot;${label(topic)} explained&quot;.`,
    thumbnails: thumbs(id, label(topic)),
    channelTitle,
    liveBroadcastContent: 'none',
  };
}

const details = (id, i) => ({
  contentDetails: { duration: i % 7 === 3 ? 'PT1H2M5S' : `PT${3 + (hash(id) % 20)}M${hash(id) % 60}S` },
  statistics: { viewCount: String(10_000 + (hash(id) % 2_900_000)), likeCount: String(500 + (hash(id) % 90_000)), commentCount: '42' },
});

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function youtube(path, p) {
  if (path === '/search') {
    const q = p.get('q') ?? 'Coding';
    const items = Array.from({ length: 24 }, (_, i) => {
      const id = videoId(`${q}-${i}`);
      return { kind: 'youtube#searchResult', id: { kind: 'youtube#video', videoId: id }, snippet: snippetFor(id, q, i) };
    });
    return json({ items, nextPageToken: 'CBgQAA' });
  }
  if (path === '/videos' && p.get('chart') === 'mostPopular') {
    const topics = ['Space', 'Design', 'Music', 'Coding', 'Cooking', 'Science', 'Gaming', 'Travel'];
    const items = Array.from({ length: 24 }, (_, i) => {
      const id = videoId(`trending-${i}`);
      return { kind: 'youtube#video', id, snippet: snippetFor(id, topics[i % topics.length], i), ...details(id, i) };
    });
    return json({ items });
  }
  if (path === '/videos') {
    const items = (p.get('id') ?? '')
      .split(',')
      .filter(Boolean)
      .map((id, i) => {
        const known = made.get(id) ?? { topic: 'Coding', i: hash(id) % TEMPLATES.length };
        return { kind: 'youtube#video', id, snippet: snippetFor(id, known.topic, known.i, known.channel), ...details(id, i) };
      });
    return json({ items });
  }
  if (path === '/channels') {
    const id = p.get('id');
    const found = CHANNELS.find(([cid]) => cid === id);
    if (!found) return json({ items: [] });
    return json({
      items: [
        {
          id,
          snippet: {
            title: found[1],
            customUrl: `@${found[1].toLowerCase().replace(/\s+/g, '')}`,
            description: `${found[1]} makes calm, well-researched videos every week.`,
            thumbnails: { default: { url: avatarUrl(id, found[1]) }, medium: { url: avatarUrl(id, found[1]) }, high: { url: avatarUrl(id, found[1]) } },
          },
          statistics: { subscriberCount: '3400000', videoCount: '812', viewCount: '512000000', hiddenSubscriberCount: false },
          brandingSettings: { image: { bannerExternalUrl: thumbUrl(`banner-${id}`, 1600, found[1]) } },
        },
      ],
    });
  }
  if (path === '/playlistItems') {
    const channelId = `UC${(p.get('playlistId') ?? '').slice(2)}`;
    const channel = CHANNELS.find(([cid]) => cid === channelId) ?? [channelId, 'Channel'];
    const page = p.get('pageToken') ? 1 : 0;
    const items = Array.from({ length: 12 }, (_, i) => {
      const n = page * 12 + i;
      const id = videoId(`${channelId}-${n}`);
      return {
        snippet: { ...snippetFor(id, ['Coding', 'Design', 'Science'][n % 3], n, channel), videoOwnerChannelId: channelId, videoOwnerChannelTitle: channel[1] },
        contentDetails: { videoId: id, videoPublishedAt: daysAgo(n * 2 + 1) },
      };
    });
    return json({ items, nextPageToken: page ? undefined : 'CAwQAA' });
  }
  if (path === '/commentThreads')
    return json({
      items: Array.from({ length: 5 }, (_, i) => ({
        id: `c${i}`,
        snippet: {
          topLevelComment: {
            snippet: {
              authorDisplayName: `@viewer${i + 1}`,
              authorProfileImageUrl: '',
              textDisplay: i === 0 ? 'This finally made it click. Thank you!' : `Great explanation, part ${i + 2} please.`,
              likeCount: 120 - i * 20,
              publishedAt: daysAgo(i * 4 + 1),
            },
          },
        },
      })),
    });
  return json({ error: { errors: [{ reason: 'notFound' }] } }, 404);
}

const DM_OWNERS = ['Atelier Nova', 'Le Petit Studio', 'Horizon Films', 'Mappemonde'].map((name) => [`x${idFrom(`owner-${name}`, 6, 'abcdefghijklmnopqrstuvwxyz0123456789')}`, name]);

const madeDm = new Map();

function dailymotionItem(id, topic, i) {
  if (madeDm.has(id)) ({ topic, i } = madeDm.get(id));
  else madeDm.set(id, { topic, i });
  const [ownerId, owner] = DM_OWNERS[hash(id) % DM_OWNERS.length];
  return {
    id,
    title: TEMPLATES[(i + 5) % TEMPLATES.length](label(topic)).replace(/&#39;/g, "'").replace(/&amp;/g, '&'),
    description: `<p>${label(topic)} on Dailymotion.</p>`,
    thumbnail_360_url: thumbUrl(id, 640, label(topic)),
    thumbnail_480_url: thumbUrl(id, 853, label(topic)),
    thumbnail_720_url: thumbUrl(id, 1280, label(topic)),
    'owner.id': ownerId,
    'owner.screenname': owner,
    'owner.avatar_80_url': avatarUrl(ownerId, owner),
    created_time: Math.floor(Date.parse(daysAgo(i * 2 + 1)) / 1000),
    views_total: 2_000 + (hash(id) % 400_000),
    duration: 120 + (hash(id) % 1500),
    onair: false,
  };
}

function dailymotion(path, p) {
  const dmId = (seed) => `x${idFrom(seed, 6, 'abcdefghijklmnopqrstuvwxyz0123456789')}`;
  if (path === '/videos') {
    const topic = p.get('search') ?? (p.get('owners') ? 'Studio' : 'Trending');
    return json({ list: Array.from({ length: 12 }, (_, i) => dailymotionItem(dmId(`${topic}-${p.get('owners') ?? ''}-${i}`), topic, i)), has_more: false });
  }
  const match = path.match(/^\/video\/(x[A-Za-z0-9]+)$/);
  if (match) return json(dailymotionItem(match[1], 'Travel', 0));
  return json({ error: { code: 404, message: 'Not found' } }, 404);
}

function twitch(path) {
  if (path.endsWith('/search/categories')) return json({ data: [{ id: '509670', name: 'Science & Technology' }] });
  if (path.endsWith('/games/top')) return json({ data: [{ id: '509670' }] });
  if (path.endsWith('/clips'))
    return json({
      data: Array.from({ length: 6 }, (_, i) => ({
        id: `MockClip${i}`,
        url: `https://clips.twitch.tv/MockClip${i}`,
        title: `Live coding highlight #${i + 1}`,
        broadcaster_id: '1234',
        broadcaster_name: 'mockstreamer',
        thumbnail_url: thumbUrl(`clip${i}`, 480, 'Live'),
        created_at: daysAgo(i + 1),
        view_count: 1000 * (i + 1),
        duration: 28.5 + i,
      })),
    });
  return json({ data: [] });
}

export function mockFetch(input) {
  const url = new URL(typeof input === 'string' ? input : (input.url ?? String(input)));
  if (url.hostname === 'id.twitch.tv') return Promise.resolve(json({ access_token: 'mock-token', expires_in: 3600 }));
  if (url.hostname === 'api.twitch.tv') return Promise.resolve(twitch(url.pathname));
  if (url.hostname === 'api.dailymotion.com') return Promise.resolve(dailymotion(url.pathname, url.searchParams));
  return Promise.resolve(youtube(url.pathname.replace(/^\/youtube\/v3/, ''), url.searchParams));
}

const escapeXml = (value) => String(value).replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** A thumbnail stand-in: a soft gradient with a few shapes and a label, like a designed cover. */
export function mockThumbnail(id, width = 480, text = '') {
  const h = hash(id);
  const hue = h % 360;
  const a = `hsl(${hue} 62% 46%)`;
  const b = `hsl(${(hue + 40 + ((h >> 8) % 80)) % 360} 58% 22%)`;
  const height = Math.round((width * 9) / 16);
  const cx = 180 + (h % 120);
  const cy = 30 + ((h >> 4) % 90);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient><radialGradient id="r" cx="0.8" cy="0.1" r="0.9"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs><rect width="320" height="180" fill="url(#g)"/><rect width="320" height="180" fill="url(#r)"/><circle cx="${cx}" cy="${cy}" r="${40 + (h % 40)}" fill="#fff" fill-opacity=".08"/><circle cx="${cx - 60}" cy="${cy + 70}" r="${18 + (h % 20)}" fill="#fff" fill-opacity=".1"/><text x="18" y="150" font-family="Inter, system-ui, sans-serif" font-weight="800" font-size="30" letter-spacing="-1" fill="#fff" fill-opacity=".92">${escapeXml(text.slice(0, 18))}</text></svg>`;
}

/** An avatar stand-in: initials on a colored circle. */
export function mockAvatar(id, text = '') {
  const hue = hash(id) % 360;
  const initials = text
    .split(/\s+/)
    .map((word) => word[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return `<svg xmlns="http://www.w3.org/2000/svg" width="88" height="88" viewBox="0 0 88 88"><rect width="88" height="88" rx="44" fill="hsl(${hue} 55% 42%)"/><text x="44" y="54" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-weight="700" font-size="30" fill="#fff">${escapeXml(initials)}</text></svg>`;
}
