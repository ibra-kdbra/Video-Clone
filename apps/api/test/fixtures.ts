import postgres from 'postgres';
import type { Ack } from '@grand/contracts';
import { type TestApi, uniqueSlug } from './helpers.js';

export type Person = Awaited<ReturnType<TestApi['signup']>>;

/** Requests as one person. */
export const as = (api: TestApi, person: Person) => ({
  get: (path: string) => api.request('GET', path, { token: person.token }),
  post: (path: string, body?: unknown) => api.request('POST', path, { token: person.token, body }),
  put: (path: string, body?: unknown) => api.request('PUT', path, { token: person.token, body }),
  patch: (path: string, body?: unknown) => api.request('PATCH', path, { token: person.token, body }),
  del: (path: string) => api.request('DELETE', path, { token: person.token }),
});

/**
 * A school with an owner (head), an instructor who writes a published course of two published
 * lessons (and one draft), two enrolled students, a member who isn't enrolled, and another
 * instructor who doesn't edit the course.
 */
export async function courseWithPeople(api: TestApi, owner: postgres.Sql, title = 'Linear Algebra Basics') {
  const people = {
    head: await api.signup('Head Teacher'),
    author: await api.signup('Course Author'),
    student: await api.signup('Student One'),
    other: await api.signup('Student Two'),
    outsider: await api.signup('Not Enrolled'),
    colleague: await api.signup('Other Instructor'),
  };
  const school = await api.createSchool(people.head.token, uniqueSlug(), 'Social School');
  for (const [person, role] of [
    [people.author, 'instructor'],
    [people.student, 'student'],
    [people.other, 'student'],
    [people.outsider, 'student'],
    [people.colleague, 'instructor'],
  ] as const) {
    await owner`insert into memberships (school_id, user_id, role) values (${school.id}, ${person.user.id}, ${role})`;
  }
  const base = `/schools/${school.slug}/courses`;
  const author = as(api, people.author);
  const { body: created } = await author.post(base, { title, summary: 'Vectors, matrices and transformations.' });
  const url = `${base}/${created.slug}`;
  const moduleId = created.modules[0].id;
  const lesson = async (lessonTitle: string, notes: string, publish = true) => {
    const { body } = await author.post(`${url}/lessons`, { moduleId, title: lessonTitle });
    await author.patch(`${url}/lessons/${body.id}`, { notes, ...(publish && { status: 'published' }) });
    return body.id as string;
  };
  const lessons = {
    vectors: await lesson('Vectors as arrows', 'A vector is an arrow from the origin. Adding vectors means walking tip to tail.'),
    determinant: await lesson('The determinant', 'The determinant measures how a transformation scales area.'),
    draft: await lesson('Eigenvectors (draft)', 'Eigenvectors stay on their own span.', false),
  };
  await author.patch(url, { status: 'published' });
  await as(api, people.student).post(`${url}/enrollment`);
  await as(api, people.other).post(`${url}/enrollment`);
  return { ...people, school, url, courseSlug: created.slug as string, courseId: created.id as string, lessons };
}

/** A socket call's answer: its data when it worked, or the error's code when it was refused. */
export function acked<T>(answer: Ack<T>): T {
  if (!answer.ok) throw new Error(`Expected the call to work, but it was refused: ${answer.error.code}`);
  return answer.data;
}
export function refused(answer: Ack<unknown>): string {
  if (answer.ok) throw new Error('Expected the call to be refused, but it worked');
  return answer.error.code;
}
