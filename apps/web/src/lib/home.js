import { ROLE_RANK } from './roles.js';

/**
 * The LMS home page and navigation, without the React: where "My school" leads, the greeting, and
 * which courses the dashboard shows.
 */

/**
 * Where the main navigation's school link leads: straight to the school for someone in one, to
 * their account (which lists them) for someone in several; nothing for someone in none.
 */
export function schoolsLink(schools) {
  if (!schools?.length) return null;
  if (schools.length === 1) return { to: `/s/${schools[0].slug}`, label: 'My school', match: ['/s/'] };
  return { to: '/account', label: 'My schools', match: ['/s/'] };
}

/** The main navigation: home, and the person's school (or schools). */
export function mainLinks(schools, pathname) {
  const school = schoolsLink(schools);
  return [
    { to: '/', label: 'Home', icon: 'home', active: pathname === '/' },
    school && { to: school.to, label: school.label, icon: 'school', active: school.match.some((prefix) => pathname.startsWith(prefix)) },
  ].filter(Boolean);
}

/** "Good morning, Amira", from the hour where the reader is. */
export function greeting(name, date = new Date()) {
  const hour = date.getHours();
  const part = hour < 5 ? 'Good evening' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const first = String(name ?? '')
    .trim()
    .split(/\s+/)[0];
  return first ? `${part}, ${first}` : part;
}

/** Instructors, admins and the owner. */
export const isStaff = (role) => (ROLE_RANK[role] ?? -1) >= ROLE_RANK.instructor;

const lastActivity = (course) => Date.parse(course.progress?.lastActivityAt ?? '') || 0;
const finished = (course) => course.progress && course.progress.totalLessons > 0 && course.progress.completedLessons >= course.progress.totalLessons;

/**
 * "Continue learning": the published courses this person is enrolled in, across their schools
 * (each catalog is `{ school, courses }`), the one worked on most recently first, then those not
 * started, and finished ones last. At most `limit`.
 */
export function continueLearning(catalogs, limit = 6) {
  const enrolled = catalogs.flatMap(({ school, courses }) =>
    (courses ?? []).filter((course) => course.enrolled && course.status === 'published').map((course) => ({ school, course })),
  );
  const rank = ({ course }) => (finished(course) ? 2 : lastActivity(course) ? 0 : 1);
  return enrolled.sort((a, b) => rank(a) - rank(b) || lastActivity(b.course) - lastActivity(a.course) || a.course.title.localeCompare(b.course.title)).slice(0, limit);
}

/**
 * "Courses you teach": the courses this person wrote, in the schools where they're on the staff
 * (`details` are the full courses, by school and address, which say who wrote each), drafts first.
 */
export function coursesYouTeach(catalogs, details, userId) {
  return catalogs
    .filter(({ school }) => isStaff(school.role))
    .flatMap(({ school, courses }) =>
      (courses ?? []).map((course) => ({ school, course, detail: details.get(`${school.slug}/${course.slug}`) })).filter(({ detail }) => detail?.createdBy?.id === userId),
    )
    .sort((a, b) => Number(a.course.status === 'published') - Number(b.course.status === 'published') || a.course.title.localeCompare(b.course.title));
}

/** One line under the greeting: how things stand. */
export function dashboardLine({ learning, teaching }) {
  const active = learning.filter(({ course }) => !finished(course) && lastActivity(course)).length;
  const parts = [];
  if (active) parts.push(`${active} ${active === 1 ? 'course' : 'courses'} in progress`);
  if (teaching) parts.push(`${teaching} ${teaching === 1 ? 'course' : 'courses'} you teach`);
  return parts.length ? `${parts.join(' · ')}.` : 'Pick up where you left off, or find something new to learn.';
}
