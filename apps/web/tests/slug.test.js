import { describe, expect, it } from 'vitest';
import { schoolSlug } from '@grand/contracts';

import { MAX_SLUG, suggestSlug, tidySlug } from '../src/lib/slug.js';

describe('suggestSlug: a school address from its name', () => {
  it.each([
    ['Riverside Music Academy', 'riverside-music-academy'],
    ['École Saint-Élie', 'ecole-saint-elie'],
    ["Ada's Coding Club!", 'adas-coding-club'],
    ['Ada’s Coding Club', 'adas-coding-club'],
    ['Straße & Søn Æsthetics', 'strasse-son-aesthetics'],
    ['  --Hello   World--  ', 'hello-world'],
    ['Class of 2026', 'class-of-2026'],
    ['Ünïcödé Çafé', 'unicode-cafe'],
    ['İstanbul Dil Okulu', 'istanbul-dil-okulu'],
    ['日本語学校', ''],
    ['', ''],
  ])('%s → %s', (name, slug) => expect(suggestSlug(name)).toBe(slug));

  it('cuts long names at a word boundary, within the limit', () => {
    const slug = suggestSlug('The International Academy of Performing Arts and Sciences');
    expect(slug).toBe('the-international-academy-of-performing');
    expect(slug.length).toBeLessThanOrEqual(MAX_SLUG);
  });

  it('cuts a single long word at the limit', () => {
    const slug = suggestSlug('Supercalifragilisticexpialidociousacademyofmusic');
    expect(slug).toHaveLength(MAX_SLUG);
    expect(slug.endsWith('-')).toBe(false);
  });

  it('suggests addresses the API accepts', () => {
    for (const name of ['Riverside Music Academy', 'École Saint-Élie', "Ada's Coding Club!", 'The International Academy of Performing Arts and Sciences', 'A   B   C']) {
      expect(schoolSlug.safeParse(suggestSlug(name)).success, name).toBe(true);
    }
  });
});

describe('tidySlug: typing an address', () => {
  it('lower-cases and turns spaces into hyphens as people type', () => {
    expect(tidySlug('My School')).toBe('my-school');
    expect(tidySlug('x'.repeat(60))).toHaveLength(MAX_SLUG);
  });
});
