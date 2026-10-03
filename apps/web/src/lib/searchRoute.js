/**
 * The two things the top bar needs to know about searching, apart from the rest of search.js so the
 * app's first download stays small: the results page's address, and which school to search.
 */

/** The results page's address. */
export function searchPath(slug, q = '', type = 'all') {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (type && type !== 'all') params.set('type', type);
  const query = params.toString();
  return `/s/${slug}/search${query ? `?${query}` : ''}`;
}

/**
 * Which school the top bar's search looks in: the one this page belongs to (when the person is a
 * member), else their first school; none for someone in no school.
 */
export function searchSchoolFor(pathname, schools) {
  if (!schools?.length) return null;
  const match = /^\/s\/([^/]+)/.exec(pathname);
  const fromRoute = match && schools.find((school) => school.slug === decodeURIComponent(match[1]));
  return fromRoute ?? schools[0];
}
