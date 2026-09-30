/**
 * Which of the six monogram gradients (data-tone, in tokens.scss) a school or person gets. It comes
 * from their address or id, so a school keeps the same colors on every screen and every visit.
 */
export function toneFor(seed = '') {
  let hash = 0;
  for (const char of String(seed)) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  return (hash % 6) + 1;
}

/** "Riverside Music Academy" → "RM", "Ada" → "A": the first letter (or digit) of up to `max` words. */
export function initials(name = '', max = 2) {
  const words = String(name).match(/[\p{L}\p{N}]+/gu) ?? [];
  if (words.length === 0) return '?';
  return words
    .slice(0, max)
    .map((word) => [...word][0])
    .join('')
    .toUpperCase();
}
