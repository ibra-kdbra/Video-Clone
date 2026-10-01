// Letters that don't come apart into a base letter and an accent.
const SPELLED = { ß: 'ss', æ: 'ae', œ: 'oe', ø: 'o', đ: 'd', ð: 'd', ł: 'l', þ: 'th', ı: 'i' };

export const MAX_SLUG = 40;

/**
 * A school address suggested from its name: "École Saint-Élie" → "ecole-saint-elie". Accents are
 * dropped, apostrophes too ("Ada's" → "adas"), anything else that isn't a letter or digit becomes
 * a single hyphen, and long names are cut at a word boundary when there's one near the limit.
 */
export function suggestSlug(name) {
  const plain = String(name ?? '')
    .toLowerCase()
    .replace(/[ßæœøđðłþı]/g, (char) => SPELLED[char])
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (plain.length <= MAX_SLUG) return plain;
  const cut = plain.slice(0, MAX_SLUG + 1);
  const boundary = cut.lastIndexOf('-');
  return (boundary >= MAX_SLUG / 2 ? cut.slice(0, boundary) : plain.slice(0, MAX_SLUG)).replace(/-+$/, '');
}

/** What people type into the address field, tidied as they go: lower case, spaces as hyphens. */
export const tidySlug = (value) => value.toLowerCase().replace(/\s+/g, '-').slice(0, MAX_SLUG);
