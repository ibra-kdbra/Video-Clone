import { VIDEO_CONTENT_TYPES } from '@grand/contracts';

/**
 * Uploads a lesson's video straight to the video store, in parts, through the signed addresses
 * the API hands out: the API never carries the bytes. Three parts travel at once, each retried a
 * few times with growing pauses; when the addresses have expired (the store answers 403), fresh
 * ones are fetched and the part goes again. XMLHttpRequest is used (not fetch) because it reports
 * upload progress. Cancelling, or giving up, also cancels the upload on the server, which frees
 * the storage it had reserved.
 */

const MAX_RESIGNS = 3;

const EXTENSIONS = { mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', qt: 'video/quicktime', webm: 'video/webm', mkv: 'video/x-matroska' };

/** The file's type as the API names it, from the browser's guess or else its extension; null when it isn't a video we take. */
export function videoContentType(file) {
  if (VIDEO_CONTENT_TYPES.includes(file?.type)) return file.type;
  const extension = /\.([a-z0-9]+)$/i.exec(file?.name ?? '')?.[1]?.toLowerCase();
  return EXTENSIONS[extension] ?? null;
}

/** Why this file can't be uploaded (wrong type, too big, not enough room left), or null when it can. */
export function checkVideoFile(file, { maxUploadBytes, freeBytes, format = (bytes) => `${bytes} bytes` } = {}) {
  if (!file) return 'Choose a video file.';
  if (!videoContentType(file)) return 'Upload an MP4, MOV, WebM or MKV video.';
  if (file.size <= 0) return 'This file is empty.';
  if (maxUploadBytes && file.size > maxUploadBytes) return `Videos can be up to ${format(maxUploadBytes)}; this one is ${format(file.size)}.`;
  if (Number.isFinite(freeBytes) && file.size > freeBytes)
    return `This school has ${format(Math.max(0, freeBytes))} of video storage left, and this file needs ${format(file.size)}.`;
  return null;
}

/** A file name the API accepts: no control characters or slashes, at most 200 characters. */
export const uploadName = (name) =>
  String(name ?? '')
    .replace(/[\p{Cc}\p{Cf}/\\]/gu, '_')
    .trim()
    .slice(0, 200) || 'video';

/** The byte ranges of each part: part N covers [start, end), the last one may be shorter. */
export function partsFor(size, partSize) {
  const count = Math.max(1, Math.ceil(size / partSize));
  return Array.from({ length: count }, (_, index) => ({ partNumber: index + 1, start: index * partSize, end: Math.min(size, (index + 1) * partSize) }));
}

const abortError = () => new DOMException('The upload was cancelled.', 'AbortError');

/** An error from the store for one part, with the HTTP status (0 when the request never got an answer). */
class PartError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'PartError';
    this.status = status;
  }
}

/**
 * Speed (bytes a second, smoothed) and time left, from the bytes sent so far. Samples closer than
 * half a second are folded into the next one, so a burst of progress events doesn't jump around.
 */
export function createMeter(total, now = () => Date.now()) {
  let lastTime = now();
  let lastLoaded = 0;
  let speed = 0;
  return (loaded) => {
    const time = now();
    const elapsed = (time - lastTime) / 1000;
    if (elapsed >= 0.5) {
      const instant = Math.max(0, loaded - lastLoaded) / elapsed;
      speed = speed ? speed * 0.7 + instant * 0.3 : instant;
      lastTime = time;
      lastLoaded = loaded;
    }
    const sent = Math.min(Math.max(loaded, 0), total);
    return { loaded: sent, total, speed, eta: speed > 0 ? (total - sent) / speed : null };
  };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Uploads `file` and returns what completing it returns (the lesson, now "processing").
 *
 * - `api`: `{ start(input), moreParts(assetId, partNumbers), complete(assetId, parts), cancel(assetId) }`
 *   (see uploadEndpoints in courses.js).
 * - `onProgress({ loaded, total, speed, eta })`, `onPhase('uploading' | 'finishing', ticket)`.
 * - `signal`: aborting it cancels the upload; the promise then rejects with an AbortError.
 * - `createRequest`, `wait`, `now` and `backoff` are there for tests.
 */
export async function uploadVideo(
  file,
  {
    api,
    contentType = videoContentType(file),
    concurrency = 3,
    retries = 3,
    onProgress,
    onPhase,
    signal,
    createRequest = () => new XMLHttpRequest(),
    wait = sleep,
    now = () => Date.now(),
    backoff = (attempt) => 600 * 2 ** attempt + Math.random() * 300,
  },
) {
  if (signal?.aborted) throw abortError();
  // Not cancellable mid-request: the server may have started the upload by the time an abort lands,
  // so a cancel during this call is handled once it has answered.
  const ticket = await api.start({ fileName: uploadName(file.name), size: file.size, contentType });
  try {
    if (signal?.aborted) throw abortError();
    onPhase?.('uploading', ticket);
    const parts = await sendParts(file, ticket, { api, concurrency, retries, onProgress, signal, createRequest, wait, now, backoff });
    if (signal?.aborted) throw abortError();
    onPhase?.('finishing', ticket);
    return await api.complete(ticket.assetId, parts);
  } catch (error) {
    // Best effort: the server also clears away uploads left unfinished for a day.
    await Promise.resolve()
      .then(() => api.cancel(ticket.assetId))
      .catch(() => {});
    throw error;
  }
}

async function sendParts(file, ticket, { api, concurrency, retries, onProgress, signal, createRequest, wait, now, backoff }) {
  const parts = partsFor(file.size, ticket.partSize);
  const urls = new Map(ticket.parts.map((part) => [part.partNumber, part.url]));
  const sent = new Map();
  const etags = new Map();
  const inFlight = new Set();
  const queue = [...parts];
  const meter = createMeter(file.size, now);
  let failure = null;
  let resigning = null;

  const report = () => onProgress?.(meter([...sent.values()].reduce((sum, bytes) => sum + bytes, 0)));
  const stopAll = () => inFlight.forEach((request) => request.abort());
  signal?.addEventListener('abort', stopAll);

  // Fresh addresses for every part not sent yet; parts that find theirs expired meanwhile share one request.
  const resign = () =>
    (resigning ??= api
      .moreParts(
        ticket.assetId,
        parts.filter((part) => !etags.has(part.partNumber)).map((part) => part.partNumber),
      )
      .then((fresh) => {
        for (const part of fresh.parts) urls.set(part.partNumber, part.url);
      })
      .finally(() => {
        resigning = null;
      }));

  const put = (part) =>
    new Promise((resolve, reject) => {
      const request = createRequest();
      inFlight.add(request);
      const settle = (fn, value) => {
        inFlight.delete(request);
        fn(value);
      };
      request.open('PUT', urls.get(part.partNumber));
      request.upload.onprogress = (event) => {
        sent.set(part.partNumber, Math.min(event.loaded, part.end - part.start));
        report();
      };
      request.onload = () => {
        if (request.status < 200 || request.status >= 300) return settle(reject, new PartError(request.status, `The video store answered ${request.status}.`));
        // The store returns each part's ETag (exposed through CORS); completing the upload lists them.
        const etag = request.getResponseHeader('ETag');
        if (!etag) return settle(reject, new PartError(request.status, "The video store didn't confirm a part."));
        settle(resolve, etag);
      };
      request.onerror = () => settle(reject, new PartError(0, "Couldn't reach the video store."));
      request.ontimeout = request.onerror;
      request.onabort = () => settle(reject, abortError());
      request.send(file.slice(part.start, part.end));
    });

  const send = async (part) => {
    let attempt = 0;
    let resigned = 0;
    for (;;) {
      if (signal?.aborted) throw abortError();
      if (failure) throw failure;
      const address = urls.get(part.partNumber);
      try {
        const etag = await put(part);
        etags.set(part.partNumber, etag);
        sent.set(part.partNumber, part.end - part.start);
        report();
        return;
      } catch (error) {
        sent.set(part.partNumber, 0);
        report();
        if (signal?.aborted || error.name === 'AbortError') throw failure ?? abortError();
        if (error.status === 403 && resigned < MAX_RESIGNS) {
          resigned += 1;
          // Another part may have fetched fresh addresses since this one left: then just use them.
          if (urls.get(part.partNumber) === address) await resign();
          continue;
        }
        if (attempt >= retries) throw new Error('The upload kept failing. Check your connection and try again.', { cause: error });
        await wait(backoff(attempt));
        attempt += 1;
      }
    }
  };

  const worker = async () => {
    while (queue.length && !failure) {
      const part = queue.shift();
      try {
        await send(part);
      } catch (error) {
        // One part has given up: stop the others too.
        failure ??= error;
        stopAll();
        throw failure;
      }
    }
  };

  try {
    await Promise.all(Array.from({ length: Math.min(concurrency, parts.length) }, worker));
  } finally {
    signal?.removeEventListener('abort', stopAll);
  }
  return parts.map((part) => ({ partNumber: part.partNumber, etag: etags.get(part.partNumber) }));
}
