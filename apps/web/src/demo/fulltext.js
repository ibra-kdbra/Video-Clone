import { SNIPPET_MARK_END, SNIPPET_MARK_START } from '@grand/contracts';

/**
 * Full-text search for the demo, in place of Postgres's (apps/api/src/search): words in all their
 * forms (light English stemming, so "vectors" finds "vector"), common words ignored, the last word
 * typed matched as a prefix, every word required, fields weighted title > summary > long text
 * (ts_rank's A, B and C), and snippets of about 28 words around the first match with the matches
 * between SNIPPET_MARK_START and SNIPPET_MARK_END, never HTML.
 */

/** ts_rank's default weights for A (titles), B (summaries) and C (long text). */
export const WEIGHTS = { A: 1, B: 0.4, C: 0.2 };

/** Postgres's English stop words, the common ones: never indexed, dropped from queries. */
const STOP_WORDS = new Set(
  `a about above after again against all am an and any are as at be because been before being below between both but by can could did do does doing don down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just me more most my myself no nor not now of off on once only or other our ours ourselves out over own s same she should so some such t than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why will with you your yours yourself yourselves`.split(
    ' ',
  ),
);

/** Plurals that don't follow the rules. */
const IRREGULAR = { matrices: 'matrix', vertices: 'vertex', indices: 'index', appendices: 'appendix', axes: 'axis', analyses: 'analysis', theses: 'thesis', crises: 'crisis', children: 'child', people: 'person', mice: 'mouse', teeth: 'tooth', feet: 'foot', geese: 'goose' };

const VOWEL = /[aeiouy]/;
const DOUBLE = /([bdgkmnprt])\1$/;

/**
 * A word's stem, by light English rules: plurals (-s, -es, -ies), -ing and -ed, a final e, and
 * doubled consonants left by those ("running" → "run"). Enough that a word's common forms meet:
 * vector/vectors, transform/transforming, grade/graded/grades, study/studies/studied.
 */
export function stem(word) {
  if (word.length <= 2 || /^\d/.test(word)) return word;
  if (IRREGULAR[word]) return IRREGULAR[word];
  let w = word;
  if (w.endsWith('ies') && w.length > 4) w = `${w.slice(0, -3)}y`;
  else if (w.endsWith('sses')) w = w.slice(0, -2);
  else if (/(?:s|x|z|ch|sh)es$/.test(w) && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith('s') && !/(?:ss|us|is)$/.test(w) && w.length > 3) w = w.slice(0, -1);

  if (w.endsWith('ied') && w.length > 4) w = `${w.slice(0, -3)}y`;
  else if (w.endsWith('ing') && w.length - 3 >= 3 && VOWEL.test(w.slice(0, -3))) w = undouble(w.slice(0, -3));
  else if (w.endsWith('ed') && !w.endsWith('eed') && w.length - 2 >= 2 && VOWEL.test(w.slice(0, -2))) w = undouble(w.slice(0, -2));

  if (w.endsWith('e') && w.length >= 3) w = w.slice(0, -1);
  return w;
}

const undouble = (w) => (DOUBLE.test(w) ? w.slice(0, -1) : w);

/** Letters and digits only, lower case, accents dropped (î → i), as the API reads a query. */
export const normalize = (text) =>
  String(text ?? '')
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase();

const WORD = /[\p{L}\p{N}]+/gu;

/** A text's indexed words, stemmed, without stop words. */
export function terms(text) {
  const found = [];
  for (const word of normalize(text).match(WORD) ?? []) if (!STOP_WORDS.has(word)) found.push(stem(word));
  return found;
}

/**
 * What was typed, as the API's toTsQuery reads it (up to eight words of letters and digits), then
 * as Postgres would: stop words dropped, the rest stemmed, the last word typed also a prefix.
 * Null when nothing searchable is left.
 */
export function parseQuery(text) {
  const words = (normalize(text).match(WORD) ?? []).slice(0, 8);
  const parsed = [];
  for (const [index, word] of words.entries()) {
    if (STOP_WORDS.has(word)) continue;
    parsed.push({ term: stem(word), prefix: index === words.length - 1 });
  }
  return parsed.length ? parsed : null;
}

const matches = (query, term) => (query.prefix ? term.startsWith(query.term) : term === query.term);

/** A document's fields as weighted term lists, ready to search: `{ A: '…', B: '…', C: '…' }`. */
export function indexDocument(fields) {
  const index = {};
  for (const [weight, text] of Object.entries(fields)) {
    const counts = new Map();
    for (const term of terms(text)) counts.set(term, (counts.get(term) ?? 0) + 1);
    index[weight] = counts;
  }
  return index;
}

/**
 * How well a document matches: 0 unless every word of the query is somewhere in it; otherwise the
 * sum, over the query's words and the document's fields, of the field's weight times a gently
 * damped count of the matches, so the field decides (a title match beats any number in the notes)
 * and the count only breaks ties.
 */
export function rank(index, query) {
  let score = 0;
  for (const part of query) {
    let found = 0;
    for (const [weight, counts] of Object.entries(index)) {
      let count = 0;
      for (const [term, n] of counts) if (matches(part, term)) count += n;
      if (count) found += WEIGHTS[weight] * (1 + 0.25 * Math.log(count));
    }
    if (!found) return 0;
    score += found;
  }
  return score;
}

/** Markdown's markers don't belong in a snippet (as the API's `plain`). */
const plain = (text) =>
  String(text ?? '')
    .replace(/\]\([^)]*\)/g, ' ')
    .replace(/[*_`#>|~[\]]+/g, ' ');

const SNIPPET_WORDS = 28;
const BEFORE_MATCH = 8;

/**
 * About 28 words of `text` around its first match, with every matching word marked; the opening
 * words, unmarked, when nothing in it matches (the match was in the title). "…" where it was cut.
 */
export function snippet(text, query) {
  const words = plain(text).split(/\s+/).filter(Boolean);
  if (!words.length) return '';
  const hits = words.map((word) => (word.match(WORD) ?? []).some((piece) => isMatch(piece, query)));
  const first = hits.indexOf(true);
  let start = first < 0 ? 0 : Math.max(0, first - BEFORE_MATCH);
  const end = Math.min(words.length, start + SNIPPET_WORDS);
  start = Math.max(0, Math.min(start, end - SNIPPET_WORDS));
  const shown = words.slice(start, end).map((word, index) => (hits[start + index] ? mark(word, query) : word));
  return `${start > 0 ? '… ' : ''}${shown.join(' ')}${end < words.length ? ' …' : ''}`;
}

function isMatch(piece, query) {
  const word = normalize(piece);
  if (STOP_WORDS.has(word)) return false;
  const term = stem(word);
  return query.some((part) => matches(part, term));
}

/** The matching letters of a word between the marks, its punctuation outside them: "(vectors," → "(␂vectors␃,". */
const mark = (word, query) => word.replace(WORD, (piece) => (isMatch(piece, query) ? `${SNIPPET_MARK_START}${piece}${SNIPPET_MARK_END}` : piece));
