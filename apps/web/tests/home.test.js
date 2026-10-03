import { describe, expect, it } from 'vitest';

import { continueLearning, coursesYouTeach, dashboardLine, greeting, isStaff, mainLinks, schoolsLink } from '../src/lib/home.js';

const school = (slug, role = 'student') => ({ id: `id-${slug}`, slug, name: slug.replace(/-/g, ' '), role, createdAt: '2026-01-01T00:00:00Z' });
const course = (slug, { enrolled = true, status = 'published', completed = 0, total = 5, last = null } = {}) => ({
  id: `c-${slug}`,
  slug,
  title: slug,
  status,
  enrolled,
  progress: enrolled ? { completedLessons: completed, totalLessons: total, percent: Math.round((completed / total) * 100), lastLessonId: last ? 'l1' : null, lastActivityAt: last } : null,
});

describe('navigation', () => {
  it('leads "My school" straight to the one school, or to the list of several', () => {
    expect(schoolsLink([])).toBeNull();
    expect(schoolsLink([school('riverside')])).toMatchObject({ to: '/s/riverside', label: 'My school' });
    expect(schoolsLink([school('riverside'), school('hilltop')])).toMatchObject({ to: '/account', label: 'My schools' });
  });

  it('builds the main links, with the current one marked', () => {
    expect(mainLinks([], '/').map((link) => [link.label, link.active])).toEqual([['Home', true]]);
    const links = mainLinks([school('riverside')], '/s/riverside/c/piano');
    expect(links.map((link) => link.label)).toEqual(['Home', 'My school']);
    expect(links.find((link) => link.active).label).toBe('My school');
    expect(mainLinks([school('riverside')], '/account').some((link) => link.active)).toBe(false);
  });
});

describe('the dashboard', () => {
  it('greets by first name and time of day', () => {
    expect(greeting('Amira Haddad', new Date(2026, 9, 1, 8))).toBe('Good morning, Amira');
    expect(greeting('Amira Haddad', new Date(2026, 9, 1, 14))).toBe('Good afternoon, Amira');
    expect(greeting('Amira Haddad', new Date(2026, 9, 1, 21))).toBe('Good evening, Amira');
    expect(greeting('', new Date(2026, 9, 1, 3))).toBe('Good evening');
  });

  it('lists courses to continue: latest first, then unstarted, finished last, across schools', () => {
    const catalogs = [
      {
        school: school('riverside'),
        courses: [
          course('old', { completed: 1, last: '2026-09-01T00:00:00Z' }),
          course('done', { completed: 5, last: '2026-09-30T00:00:00Z' }),
          course('not-mine', { enrolled: false }),
          course('draft', { status: 'draft' }),
        ],
      },
      { school: school('hilltop'), courses: [course('new', { completed: 2, last: '2026-09-29T00:00:00Z' }), course('fresh')] },
      { school: school('loading'), courses: undefined },
    ];
    expect(continueLearning(catalogs).map(({ course: item }) => item.slug)).toEqual(['new', 'old', 'fresh', 'done']);
    expect(continueLearning(catalogs, 2)).toHaveLength(2);
    expect(continueLearning(catalogs)[0].school.slug).toBe('hilltop');
  });

  it('lists the courses someone teaches, drafts first, from the schools where they are staff', () => {
    const catalogs = [
      { school: school('riverside', 'instructor'), courses: [course('mine', { enrolled: false }), course('theirs', { enrolled: false }), course('my-draft', { enrolled: false, status: 'draft' })] },
      { school: school('hilltop', 'student'), courses: [course('elsewhere', { enrolled: false })] },
    ];
    const details = new Map([
      ['riverside/mine', { createdBy: { id: 'me' } }],
      ['riverside/theirs', { createdBy: { id: 'someone' } }],
      ['riverside/my-draft', { createdBy: { id: 'me' } }],
      ['hilltop/elsewhere', { createdBy: { id: 'me' } }],
    ]);
    expect(coursesYouTeach(catalogs, details, 'me').map(({ course: item }) => item.slug)).toEqual(['my-draft', 'mine']);
    expect(isStaff('instructor')).toBe(true);
    expect(isStaff('student')).toBe(false);
  });

  it('sums things up in a line', () => {
    const learning = [{ course: course('a', { completed: 1, last: '2026-09-01T00:00:00Z' }) }, { course: course('b', { completed: 5, last: '2026-09-01T00:00:00Z' }) }];
    expect(dashboardLine({ learning, teaching: 0 })).toBe('1 course in progress.');
    expect(dashboardLine({ learning, teaching: 3 })).toBe('1 course in progress · 3 courses you teach.');
    expect(dashboardLine({ learning: [], teaching: 0 })).toBe('Pick up where you left off, or find something new to learn.');
  });
});
