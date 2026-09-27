/**
 * A stand-in for the YouTube and Twitch APIs, for local development without keys (MOCK_API=1)
 * and for tests. Answers the same endpoints with deterministic, realistic-looking data; images
 * are small generated SVGs served by the dev server under /__mock/.
 */

const TOPICS = ['Coding', 'ReactJS', 'NextJS', 'Music', 'Education', 'Podcast', 'Gaming', 'Science'];
const CHANNELS = [
  ['UCsBjURrPoezykLs9EqgamOA', 'Fireship'],
  ['UC8butISFwT-Wl7EV0hUK0BQ', 'freeCodeCamp.org'],
  ['UCW5YeuERMmlnqo4oq8vwUpg', 'The Net Ninja'],
  ['UC29ju8bIPH5as8OGnQzwJyA', 'Traversy Media'],
];

const hash = (text) => [...text].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
const videoId = (seed) => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let n = hash(seed);
  let id = '';
  for (let i = 0; i < 11; i++) {
    id += alphabet[n % 64];
    n = (n * 1103515245 + 12345) >>> 0;
  }
  return id;
};
const thumbs = (id) => ({
  default: { url: `/__mock/thumb/${id}.svg?w=120`, width: 120, height: 90 },
  medium: { url: `/__mock/thumb/${id}.svg?w=320`, width: 320, height: 180 },
  high: { url: `/__mock/thumb/${id}.svg?w=480`, width: 480, height: 360 },
  standard: { url: `/__mock/thumb/${id}.svg?w=640`, width: 640, height: 480 },
});

function snippetFor(id, q, i) {
  const [channelId, channelTitle] = CHANNELS[hash(id) % CHANNELS.length];
  return {
    publishedAt: new Date(Date.UTC(2026, 8, 25 - (i % 20), 12)).toISOString(),
    channelId,
    // Escaped, like the real API returns it.
    title: i === 2 ? `Nor&#39;easter &amp; ${q}: what you need to know` : `${q} in ${100 - i} seconds — part ${i + 1}`,
    description: `A look at ${q}. Episode ${i + 1} of the series &quot;${q} explained&quot;.`,
    thumbnails: thumbs(id),
    channelTitle,
  };
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export function mockFetch(input) {
  const url = new URL(typeof input === 'string' ? input : input.url ?? String(input));
  const p = url.searchParams;
  const path = url.pathname.replace(/^\/youtube\/v3/, '');

  if (url.hostname === 'id.twitch.tv') return Promise.resolve(json({ access_token: 'mock-token', expires_in: 3600 }));
  if (url.hostname === 'api.twitch.tv') {
    if (path.endsWith('/search/categories')) return Promise.resolve(json({ data: [{ id: '509670', name: 'Science & Technology' }] }));
    if (path.endsWith('/games/top')) return Promise.resolve(json({ data: [{ id: '509670' }] }));
    if (path.endsWith('/clips'))
      return Promise.resolve(
        json({
          data: Array.from({ length: 6 }, (_, i) => ({
            id: `MockClip${i}`,
            url: `https://clips.twitch.tv/MockClip${i}`,
            title: `Live coding highlight #${i + 1}`,
            broadcaster_id: '1234',
            broadcaster_name: 'mockstreamer',
            thumbnail_url: `/__mock/thumb/clip${i}.svg?w=480`,
            created_at: new Date(Date.UTC(2026, 8, 20 + (i % 5))).toISOString(),
            view_count: 1000 * (i + 1),
            duration: 28.5 + i,
          })),
        }),
      );
    return Promise.resolve(json({ data: [] }));
  }

  if (path === '/search') {
    const q = p.get('q') ?? TOPICS[0];
    const items = Array.from({ length: 24 }, (_, i) => {
      const id = videoId(`${q}-${i}`);
      return { kind: 'youtube#searchResult', id: { kind: 'youtube#video', videoId: id }, snippet: snippetFor(id, q, i) };
    });
    return Promise.resolve(json({ items, nextPageToken: 'CBgQAA' }));
  }
  if (path === '/videos') {
    const items = (p.get('id') ?? '').split(',').filter(Boolean).map((id, i) => ({
      kind: 'youtube#video',
      id,
      snippet: snippetFor(id, 'Coding', i),
      contentDetails: { duration: i % 7 === 3 ? 'PT1H2M5S' : `PT${3 + (hash(id) % 20)}M${hash(id) % 60}S` },
      statistics: { viewCount: String(10_000 + (hash(id) % 900_000)), likeCount: String(500 + (hash(id) % 9000)), commentCount: '42' },
    }));
    return Promise.resolve(json({ items }));
  }
  if (path === '/channels') {
    const id = p.get('id');
    const found = CHANNELS.find(([cid]) => cid === id);
    if (!found) return Promise.resolve(json({ items: [] }));
    return Promise.resolve(
      json({
        items: [
          {
            id,
            snippet: { title: found[1], description: `Videos about code from ${found[1]}.`, thumbnails: { default: { url: `/__mock/thumb/${id}.svg?w=88` }, medium: { url: `/__mock/thumb/${id}.svg?w=240` }, high: { url: `/__mock/thumb/${id}.svg?w=800` } } },
            statistics: { subscriberCount: '3400000', videoCount: '812', viewCount: '512000000', hiddenSubscriberCount: false },
          },
        ],
      }),
    );
  }
  if (path === '/playlistItems') {
    const channelId = `UC${(p.get('playlistId') ?? '').slice(2)}`;
    const title = CHANNELS.find(([cid]) => cid === channelId)?.[1] ?? 'Channel';
    const items = Array.from({ length: 12 }, (_, i) => {
      const id = videoId(`${channelId}-${i}`);
      return {
        snippet: { ...snippetFor(id, title, i), channelId, channelTitle: title, videoOwnerChannelId: channelId, videoOwnerChannelTitle: title },
        contentDetails: { videoId: id, videoPublishedAt: new Date(Date.UTC(2026, 8, 24 - i)).toISOString() },
      };
    });
    return Promise.resolve(json({ items }));
  }
  if (path === '/commentThreads')
    return Promise.resolve(
      json({
        items: Array.from({ length: 5 }, (_, i) => ({
          id: `c${i}`,
          snippet: {
            topLevelComment: {
              snippet: {
                authorDisplayName: `@viewer${i + 1}`,
                authorProfileImageUrl: '',
                textDisplay: i === 0 ? 'This finally made it click — thank you!' : `Great explanation, part ${i + 1} please.`,
                likeCount: 120 - i * 20,
                publishedAt: new Date(Date.UTC(2026, 8, 20 - i)).toISOString(),
              },
            },
          },
        })),
      }),
    );
  return Promise.resolve(json({ error: { errors: [{ reason: 'notFound' }] } }, 404));
}

/** A thumbnail stand-in: a gradient card with the video id. */
export function mockThumbnail(id, width = 480) {
  const h = hash(id);
  const a = `hsl(${h % 360} 55% 38%)`;
  const b = `hsl(${(h >> 8) % 360} 60% 22%)`;
  const height = Math.round((width * 9) / 16);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 320 180"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="320" height="180" fill="url(#g)"/><text x="16" y="164" font-family="sans-serif" font-size="14" fill="rgba(255,255,255,.7)">${id}</text></svg>`;
}
