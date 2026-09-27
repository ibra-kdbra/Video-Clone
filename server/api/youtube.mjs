import { ApiError, PATTERNS, decodeEntities, maybe, need, query } from './http.mjs';

const GOOGLE = 'https://www.googleapis.com/youtube/v3';
const RAPID = 'https://youtube-v31.p.rapidapi.com';

/**
 * The official YouTube Data API when YOUTUBE_API_KEY is set; otherwise the RapidAPI mirror of it
 * (same endpoints and response shapes) when RAPIDAPI_KEY is set. The key only ever lives here.
 */
function upstream(env) {
  if (env.YOUTUBE_API_KEY) return { base: GOOGLE, key: { key: env.YOUTUBE_API_KEY }, headers: {} };
  if (env.RAPIDAPI_KEY)
    return {
      base: RAPID,
      key: {},
      headers: { 'X-RapidAPI-Key': env.RAPIDAPI_KEY, 'X-RapidAPI-Host': 'youtube-v31.p.rapidapi.com' },
    };
  throw new ApiError(503, 'not_configured', 'Video search is not set up yet (missing API key on the server).');
}

async function call(ctx, path, params) {
  const { base, key, headers } = upstream(ctx.env);
  const url = new URL(base + path);
  for (const [name, value] of Object.entries({ ...params, ...key }))
    if (value !== undefined && value !== '') url.searchParams.set(name, String(value));

  const response = await ctx.fetch(url, { headers });
  if (response.ok) return response.json();

  // Never echo the URL: it carries the key.
  let reason = '';
  try {
    const body = await response.json();
    reason = body?.error?.errors?.[0]?.reason ?? body?.error?.status ?? body?.message ?? '';
  } catch {
    // Not JSON; the status is enough.
  }
  if (response.status === 429 || /quota|dailyLimit|rateLimit/i.test(reason))
    throw new ApiError(429, 'quota', "Today's video quota has run out. Please try again later.");
  if (reason === 'commentsDisabled') throw new ApiError(403, 'comments_disabled', 'Comments are turned off for this video.');
  if (response.status === 404 || /notFound/i.test(reason)) throw new ApiError(404, 'not_found', 'That video or channel was not found.');
  console.error(`[api] YouTube ${path} failed: ${response.status} ${reason}`);
  throw new ApiError(502, 'upstream_error', 'The video service did not respond as expected.');
}

const cleanSnippet = (snippet = {}) => ({
  ...snippet,
  title: decodeEntities(snippet.title),
  description: decodeEntities(snippet.description),
  channelTitle: decodeEntities(snippet.channelTitle),
});

/**
 * Adds each video's duration and statistics (one videos.list call for up to 50 ids, 1 quota
 * unit), and decodes the text. Items keep the search-result shape the app already renders.
 */
async function enrich(ctx, items) {
  const ids = [...new Set(items.map((item) => item.id?.videoId).filter(Boolean))];
  const details = new Map();
  if (ids.length) {
    const data = await call(ctx, '/videos', { part: 'contentDetails,statistics', id: ids.join(','), maxResults: 50 });
    for (const video of data.items ?? []) details.set(video.id, video);
  }
  return items.map((item) => {
    const extra = details.get(item.id?.videoId);
    return {
      ...item,
      snippet: cleanSnippet(item.snippet),
      ...(extra && { contentDetails: extra.contentDetails, statistics: extra.statistics }),
    };
  });
}

/** A channel's uploads playlist (UC… → UU…): listing it costs 1 unit, a search costs 100. */
const uploadsOf = (channelId) => `UU${channelId.slice(2)}`;

async function uploads(ctx, channelId, { pageToken, exclude, max = 24 } = {}) {
  let data;
  try {
    data = await call(ctx, '/playlistItems', {
      part: 'snippet,contentDetails',
      playlistId: uploadsOf(channelId),
      maxResults: max,
      pageToken,
    });
  } catch (error) {
    if (error instanceof ApiError && error.code === 'not_found') return { items: [], nextPageToken: null };
    throw error;
  }
  const items = (data.items ?? [])
    .filter((item) => item.contentDetails?.videoId && item.contentDetails.videoId !== exclude)
    .filter((item) => item.snippet?.title !== 'Private video' && item.snippet?.title !== 'Deleted video')
    .map((item) => ({
      kind: 'youtube#searchResult',
      id: { kind: 'youtube#video', videoId: item.contentDetails.videoId },
      snippet: {
        ...item.snippet,
        publishedAt: item.contentDetails.videoPublishedAt ?? item.snippet.publishedAt,
        channelId: item.snippet.videoOwnerChannelId ?? item.snippet.channelId,
        channelTitle: item.snippet.videoOwnerChannelTitle ?? item.snippet.channelTitle,
      },
    }));
  return { items: await enrich(ctx, items), nextPageToken: data.nextPageToken ?? null };
}

export const youtube = {
  /** Search videos. 100 units upstream, so results stay cached for an hour. */
  async search(params, ctx) {
    const q = query(params);
    const pageToken = maybe(params, 'pageToken', PATTERNS.pageToken);
    const data = await call(ctx, '/search', { part: 'snippet', q, type: 'video', maxResults: 24, safeSearch: 'moderate', pageToken });
    const items = await enrich(ctx, (data.items ?? []).filter((item) => item.id?.videoId));
    return { body: { items, nextPageToken: data.nextPageToken ?? null }, ttl: 3600 };
  },

  /** One video with its channel's name, avatar and subscriber count (2 units). */
  async video(params, ctx) {
    const id = need(params, 'id', PATTERNS.videoId);
    const data = await call(ctx, '/videos', { part: 'snippet,statistics,contentDetails', id });
    const video = data.items?.[0];
    if (!video) throw new ApiError(404, 'not_found', 'That video was not found.');

    let channel = null;
    if (video.snippet?.channelId) {
      const channels = await call(ctx, '/channels', { part: 'snippet,statistics', id: video.snippet.channelId });
      const found = channels.items?.[0];
      if (found)
        channel = {
          id: found.id,
          title: decodeEntities(found.snippet?.title),
          thumbnail: found.snippet?.thumbnails?.default?.url ?? null,
          subscriberCount: found.statistics?.hiddenSubscriberCount ? null : (found.statistics?.subscriberCount ?? null),
        };
    }
    return { body: { item: { ...video, snippet: cleanSnippet(video.snippet), channel } }, ttl: 3600 };
  },

  /**
   * "Up next": more from the same channel. The YouTube API retired related-video search, and a
   * topical search would cost 100 units per watch page; the uploads playlist costs 3 in total.
   */
  async related(params, ctx) {
    const id = need(params, 'id', PATTERNS.videoId);
    const data = await call(ctx, '/videos', { part: 'snippet', id });
    const channelId = data.items?.[0]?.snippet?.channelId;
    if (!channelId || !PATTERNS.channelId.test(channelId)) return { body: { items: [] }, ttl: 3600 };
    const { items } = await uploads(ctx, channelId, { exclude: id, max: 16 });
    return { body: { items }, ttl: 3600 };
  },

  async channel(params, ctx) {
    const id = need(params, 'id', PATTERNS.channelId);
    const data = await call(ctx, '/channels', { part: 'snippet,statistics,brandingSettings', id });
    const channel = data.items?.[0];
    if (!channel) throw new ApiError(404, 'not_found', 'That channel was not found.');
    return { body: { item: { ...channel, snippet: cleanSnippet(channel.snippet) } }, ttl: 6 * 3600 };
  },

  async channelVideos(params, ctx) {
    const id = need(params, 'id', PATTERNS.channelId);
    const pageToken = maybe(params, 'pageToken', PATTERNS.pageToken);
    const body = await uploads(ctx, id, { pageToken });
    return { body, ttl: 3600 };
  },

  /** Top comments as plain text (no HTML to render). */
  async comments(params, ctx) {
    const id = need(params, 'id', PATTERNS.videoId);
    try {
      const data = await call(ctx, '/commentThreads', {
        part: 'snippet',
        videoId: id,
        maxResults: 20,
        order: 'relevance',
        textFormat: 'plainText',
      });
      const items = (data.items ?? []).map((thread) => {
        const top = thread.snippet?.topLevelComment;
        if (!top) return thread;
        return {
          ...thread,
          snippet: {
            ...thread.snippet,
            topLevelComment: {
              ...top,
              snippet: {
                ...top.snippet,
                authorDisplayName: decodeEntities(top.snippet?.authorDisplayName),
                textDisplay: decodeEntities(top.snippet?.textDisplay),
              },
            },
          },
        };
      });
      return { body: { items, disabled: false }, ttl: 1800 };
    } catch (error) {
      if (error instanceof ApiError && error.code === 'comments_disabled')
        return { body: { items: [], disabled: true }, ttl: 6 * 3600 };
      throw error;
    }
  },
};
