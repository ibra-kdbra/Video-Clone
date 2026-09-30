/**
 * The app's client for its own video API function (netlify/functions/api.mjs). The video API keys
 * live on the server, so the browser only ever calls same-origin `/api/...` URLs. The Grand LMS API
 * (`/api/v1`) has its own client in session.js, which throws the same ApiError.
 */
export class ApiError extends Error {
  /**
   * `details` lists per-field messages from the Grand LMS API's validation (`{ path, message }`,
   * where path "" is the whole form); `retryAfter` is in seconds, when the server said.
   */
  constructor(status, code, message, { details = [], requestId = null, retryAfter = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
    this.retryAfter = retryAfter;
  }
}

const FALLBACK_MESSAGE = 'The video service is unavailable right now. Please try again in a moment.';

export async function apiGet(path, params = {}, { signal } = {}) {
  const url = new URL(`/api/${path}`, window.location.origin);
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(name, value);
  }

  let response;
  try {
    response = await fetch(url, { headers: { Accept: 'application/json' }, signal });
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    throw new ApiError(0, 'network', 'You appear to be offline. Check your connection and try again.');
  }

  let body = null;
  try {
    body = await response.json();
  } catch {
    // Handled below.
  }
  if (!response.ok || !body) throw new ApiError(response.status, body?.error ?? 'unknown', body?.message ?? FALLBACK_MESSAGE);
  return body;
}
