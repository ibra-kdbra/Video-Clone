import { ApiError, PATTERNS, count, isoSeconds, maybe, need, query, safeUrl, text, upstream } from './http.mjs';
import { video } from './video.mjs';

const GOOGLE = 'https://www.googleapis.com/youtube/v3';

/**
 * The official YouTube Data API, free with a Google Cloud API key (no billing account). Its free
 * tier is 100 searches a day plus 10,000 units a day for everything else, so the endpoints below
 * avoid searching where they can and every response is cached (see json() in http.mjs).
 * The key only ever lives here.
 */
async function call(ctx, path, params) {
  const key = ctx.env.YOUTUBE_API_KEY;
  if (!key) throw new ApiError(503, 'not_configured', 'YouTube is not set up yet (missing API key on the server).');
  const url = new URL(GOOGLE + path);
  for (const [name, value] of Object.entries({ ...params, key }))
    if (value !== undefined && value !== '') url.searchParams.set(name, String(value));

  const response = await upstream(ctx, url, {}, `YouTube ${path}`);
  if (response.ok) return response.json();

  let reason = '';
  try {
    const body = await response.json();
    reason = body?.error?.errors?.[0]?.reason ?? body?.error?.status ?? body?.message ?? '';
  } catch {
    // Not JSON; the status is enough.
  }
  if (response.status === 429 || /quota|dailyLimit|rateLimit/i.test(reason))
    throw new ApiError(429, 'quota', "YouTube's free daily limit has been reached. It resets at midnight Pacific time.");
  if (reason === 'commentsDisabled') throw new ApiError(403, 'comments_disabled', 'Comments are turned off for this video.');
  if (response.status === 404 || /notFound/i.test(reason)) throw new ApiError(404, 'not_found', 'That video or channel was not found.');
  console.error(`[api] YouTube ${path} failed: ${response.status} ${reason}`);
  throw new ApiError(502, 'upstream_error', 'YouTube did not respond as expected.');
}

const SIZES = ['medium', 'high', 'standard', 'maxres'];

/** A Video from a YouTube snippet, plus its contentDetails and statistics when known. */
function toVideo(id, snippet = {}, extra = {}) {
  const thumbs = snippet.thumbnails ?? {};
  const duration = isoSeconds(extra.contentDetails?.duration);
  return video({
    provider: 'youtube',
    id,
    title: snippet.title,
    description: snippet.description,
    thumbnail: thumbs.high?.url ?? thumbs.medium?.url ?? thumbs.default?.url,
    thumbnails: SIZES.map((size) => thumbs[size]).filter(Boolean),
    channel: { id: snippet.channelId, title: snippet.channelTitle },
    publishedAt: snippet.publishedAt,
    views: count(extra.statistics?.viewCount),
    likes: count(extra.statistics?.likeCount),
    duration,
    live: snippet.liveBroadcastContent === 'live' || duration === 0,
  });
}

/**
 * Videos from search or playlist results, with each one's duration and view count added from
 * one videos.list call (1 unit for up to 50 ids).
 */
async function withDetails(ctx, entries) {
  const ids = [...new Set(entries.map((entry) => entry.id))];
  const details = new Map();
  if (ids.length) {
    const data = await call(ctx, '/videos', { part: 'contentDetails,statistics', id: ids.join(','), maxResults: 50 });
    for (const item of data.items ?? []) details.set(item.id, item);
  }
  return entries.map(({ id, snippet }) => toVideo(id, snippet, details.get(id)));
}

/** A channel's uploads playlist (UC… → UU…): listing it costs 1 unit, a search costs 100. */
const uploadsOf = (channelId) => `UU${channelId.slice(2)}`;

async function uploads(ctx, channelId, { pageToken, exclude, max = 24 } = {}) {
  let data;
  try {
    data = await call(ctx, '/playlistItems', { part: 'snippet,contentDetails', playlistId: uploadsOf(channelId), maxResults: max, pageToken });
  } catch (error) {
    if (error instanceof ApiError && error.code === 'not_found') return { items: [], nextPageToken: null };
    throw error;
  }
  const entries = (data.items ?? [])
    .filter((item) => item.contentDetails?.videoId && item.contentDetails.videoId !== exclude)
    .filter((item) => item.snippet?.title !== 'Private video' && item.snippet?.title !== 'Deleted video')
    .map((item) => ({
      id: item.contentDetails.videoId,
      snippet: {
        ...item.snippet,
        publishedAt: item.contentDetails.videoPublishedAt ?? item.snippet.publishedAt,
        channelId: item.snippet.videoOwnerChannelId ?? item.snippet.channelId,
        channelTitle: item.snippet.videoOwnerChannelTitle ?? item.snippet.channelTitle,
      },
    }));
  return { items: await withDetails(ctx, entries), nextPageToken: data.nextPageToken ?? null };
}

async function search(ctx, q) {
  const data = await call(ctx, '/search', { part: 'snippet', q, type: 'video', maxResults: 24, safeSearch: 'moderate' });
  const entries = (data.items ?? []).filter((item) => item.id?.videoId).map((item) => ({ id: item.id.videoId, snippet: item.snippet }));
  return withDetails(ctx, entries);
}

export const youtube = {
  /**
   * Search videos. The free tier allows 100 searches a day, so each result is cached for a day in
   * Netlify's shared cache: a category or query costs at most one search a day, however many
   * people open it. (The client lower-cases queries so "React" and "react" share one entry.)
   */
  async search(params, ctx) {
    return { body: { items: await search(ctx, query(params)) }, ttl: 24 * 3600 };
  },

  /**
   * What's popular right now: YouTube's "most popular" chart costs 1 unit from the large budget,
   * not one of the 100 daily searches. If the chart isn't available, a search stands in.
   */
  async trending(_params, ctx) {
    let items = [];
    try {
      const data = await call(ctx, '/videos', { part: 'snippet,contentDetails,statistics', chart: 'mostPopular', regionCode: 'US', maxResults: 24 });
      items = (data.items ?? []).map((item) => toVideo(item.id, item.snippet, item));
    } catch (error) {
      if (!(error instanceof ApiError) || error.code === 'not_configured' || error.code === 'quota') throw error;
    }
    if (!items.length) items = await search(ctx, 'trending');
    return { body: { items }, ttl: 6 * 3600 };
  },

  /** One video with its channel's avatar and subscriber count (2 units). */
  async video(params, ctx) {
    const id = need(params, 'id', PATTERNS.videoId);
    const data = await call(ctx, '/videos', { part: 'snippet,statistics,contentDetails', id });
    const found = data.items?.[0];
    if (!found) throw new ApiError(404, 'not_found', 'That video was not found.');
    const item = toVideo(found.id, found.snippet, found);

    if (item.channel.id) {
      const channels = await call(ctx, '/channels', { part: 'snippet,statistics', id: item.channel.id });
      const channel = channels.items?.[0];
      if (channel) {
        item.channel.avatar = safeUrl(channel.snippet?.thumbnails?.default?.url);
        item.channel.subscribers = channel.statistics?.hiddenSubscriberCount ? null : count(channel.statistics?.subscriberCount);
      }
    }
    return { body: { item }, ttl: 3600 };
  },

  /**
   * "Up next": more from the same channel. The YouTube API retired related-video search, and a
   * topical search would spend one of the 100 daily searches; the uploads playlist costs 3 units.
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
    const thumbs = channel.snippet?.thumbnails ?? {};
    const banner = safeUrl(channel.brandingSettings?.image?.bannerExternalUrl);
    return {
      body: {
        item: {
          id: channel.id,
          title: text(channel.snippet?.title, 200),
          handle: text(channel.snippet?.customUrl, 100) || null,
          description: text(channel.snippet?.description),
          avatar: safeUrl(thumbs.high?.url ?? thumbs.medium?.url ?? thumbs.default?.url),
          // YouTube serves banner images at a requested width through this suffix.
          banner: banner && banner.startsWith('https:') ? `${banner}=w1600` : banner,
          subscribers: channel.statistics?.hiddenSubscriberCount ? null : count(channel.statistics?.subscriberCount),
          videos: count(channel.statistics?.videoCount),
          views: count(channel.statistics?.viewCount),
        },
      },
      ttl: 6 * 3600,
    };
  },

  async channelVideos(params, ctx) {
    const id = need(params, 'id', PATTERNS.channelId);
    const pageToken = maybe(params, 'pageToken', PATTERNS.pageToken);
    return { body: await uploads(ctx, id, { pageToken }), ttl: 3600 };
  },

  /** Top comments as plain text (no HTML to render). */
  async comments(params, ctx) {
    const id = need(params, 'id', PATTERNS.videoId);
    try {
      const data = await call(ctx, '/commentThreads', { part: 'snippet', videoId: id, maxResults: 20, order: 'relevance', textFormat: 'plainText' });
      const items = (data.items ?? [])
        .map((thread) => ({ id: thread.id, c: thread.snippet?.topLevelComment?.snippet }))
        .filter(({ c }) => c)
        .map(({ id: commentId, c }) => ({
          id: String(commentId),
          author: text(c.authorDisplayName, 100),
          avatar: safeUrl(c.authorProfileImageUrl),
          text: text(c.textDisplay ?? c.textOriginal, 3000),
          likes: count(c.likeCount),
          publishedAt: c.publishedAt ?? null,
        }));
      return { body: { items, disabled: false }, ttl: 3600 };
    } catch (error) {
      if (error instanceof ApiError && error.code === 'comments_disabled') return { body: { items: [], disabled: true }, ttl: 6 * 3600 };
      throw error;
    }
  },
};
