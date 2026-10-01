/**
 * Form errors keyed by field, from either side: a zod `safeParse` result (checked here before
 * sending) or an ApiError's `details` (checked again by the server). The key "" holds messages
 * about the whole form. Each field keeps its first message.
 */
export function issuesByField(result) {
  const errors = {};
  if (!result || result.success) return errors;
  for (const issue of result.error.issues) {
    const field = String(issue.path?.[0] ?? '');
    errors[field] ??= issue.message;
  }
  return errors;
}

export function detailsByField(error) {
  const errors = {};
  for (const detail of error?.details ?? []) errors[detail.path.split('.')[0]] ??= detail.message;
  return errors;
}

/** Moves focus to the first field (in `order`) that has an error, so it's the next thing heard. */
export function focusFirstError(errors, refs, order) {
  const field = order.find((name) => errors[name]);
  refs[field]?.current?.focus();
  return Boolean(field);
}

/** "Ada Lovelace" → "Ada", for greetings. */
export const firstName = (name) => String(name ?? '').trim().split(/\s+/)[0] || 'there';

/** "in 5 minutes", "in 40 seconds": how long a rate limit lasts, from Retry-After. */
export function waitFor(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return 'in a moment';
  if (seconds < 90) return `in ${Math.ceil(seconds)} seconds`;
  const minutes = Math.ceil(seconds / 60);
  return minutes < 90 ? `in ${minutes} minutes` : `in about ${Math.round(minutes / 60)} hours`;
}

/** The message to show for a failed request, with a clearer wait for rate limits. */
export const errorMessage = (error) =>
  error?.code === 'rate_limited' && error.retryAfter ? `Too many attempts. Please try again ${waitFor(error.retryAfter)}.` : error?.message || 'Something went wrong. Please try again.';
