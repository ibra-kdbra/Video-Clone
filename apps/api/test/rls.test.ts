import { createHash, randomUUID } from 'node:crypto';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

/**
 * Row-level security, tested straight against Postgres as the API's role (grand_app): even a query
 * with no school filter at all must only ever reach the school the transaction acts for.
 */
let owner: postgres.Sql;
let app: postgres.Sql;
const ids = {
  alice: randomUUID(),
  bob: randomUUID(),
  schoolA: randomUUID(),
  schoolB: randomUUID(),
};
const tokenHash = createHash('sha256').update('rls-test-token').digest();

beforeAll(async () => {
  owner = postgres(inject('ownerDatabaseUrl'), { max: 1, onnotice: () => {} });
  app = postgres(inject('appDatabaseUrl'), { max: 2, onnotice: () => {} });
  const suffix = ids.schoolA.slice(0, 8);
  await owner`insert into users (id, email, name, password_hash) values
    (${ids.alice}, ${`alice-${suffix}@example.com`}, 'Alice', 'x'),
    (${ids.bob}, ${`bob-${suffix}@example.com`}, 'Bob', 'x')`;
  await owner`insert into schools (id, slug, name, created_by) values
    (${ids.schoolA}, ${`rls-a-${suffix}`}, 'School A', ${ids.alice}),
    (${ids.schoolB}, ${`rls-b-${suffix}`}, 'School B', ${ids.bob})`;
  await owner`insert into memberships (school_id, user_id, role) values
    (${ids.schoolA}, ${ids.alice}, 'owner'), (${ids.schoolB}, ${ids.bob}, 'owner'), (${ids.schoolB}, ${ids.alice}, 'student')`;
  await owner`insert into invitations (school_id, email, role, token_hash, expires_at) values
    (${ids.schoolA}, 'guest-a@example.com', 'student', ${tokenHash}, now() + interval '1 day'),
    (${ids.schoolB}, 'guest-b@example.com', 'student', ${createHash('sha256').update('other').digest()}, now() + interval '1 day')`;
});

afterAll(async () => {
  await app.end();
  await owner.end();
});

/** Runs `work` as grand_app acting for a person and school, like DatabaseService.transaction. */
function actingAs<T>(scope: { userId?: string; schoolId?: string }, work: (sql: postgres.TransactionSql) => Promise<T>) {
  return app.begin(async (sql) => {
    await sql`select set_config('app.user_id', ${scope.userId ?? ''}, true), set_config('app.school_id', ${scope.schoolId ?? ''}, true)`;
    return work(sql);
  }) as Promise<T>;
}

describe('row-level security', () => {
  it("shows a school's memberships and invitations only to a transaction acting for it", async () => {
    const [members, invitations] = await actingAs({ userId: ids.alice, schoolId: ids.schoolA }, async (sql) => [
      await sql`select school_id from memberships where school_id in (${ids.schoolA}, ${ids.schoolB})`,
      await sql`select school_id from invitations where school_id in (${ids.schoolA}, ${ids.schoolB})`,
    ]);
    // Alice also sees her own student membership in B: people may always read their own memberships.
    expect(members.map((row) => row.school_id).sort()).toEqual([ids.schoolA, ids.schoolB].sort());
    expect(invitations.map((row) => row.school_id)).toEqual([ids.schoolA]);

    const bobsMembershipsFromA = await actingAs({ userId: ids.alice, schoolId: ids.schoolA }, (sql) =>
      sql`select 1 from memberships where user_id = ${ids.bob}`,
    );
    expect(bobsMembershipsFromA).toHaveLength(0);
  });

  it('sees nothing school-scoped without a school, apart from your own memberships', async () => {
    const [members, invitations] = await actingAs({ userId: ids.bob }, async (sql) => [
      await sql`select school_id from memberships where school_id in (${ids.schoolA}, ${ids.schoolB})`,
      await sql`select 1 from invitations where school_id in (${ids.schoolA}, ${ids.schoolB})`,
    ]);
    expect(members.map((row) => row.school_id)).toEqual([ids.schoolB]);
    expect(invitations).toHaveLength(0);
    expect(await actingAs({}, (sql) => sql`select 1 from memberships where school_id in (${ids.schoolA}, ${ids.schoolB})`)).toHaveLength(0);
  });

  it("can't change or join another school", async () => {
    const renamed = await actingAs({ userId: ids.alice, schoolId: ids.schoolA }, (sql) =>
      sql`update schools set name = 'Taken over' where id = ${ids.schoolB}`,
    );
    expect(renamed.count).toBe(0);
    await expect(
      actingAs({ userId: ids.alice, schoolId: ids.schoolA }, (sql) =>
        sql`insert into memberships (school_id, user_id, role) values (${ids.schoolB}, ${ids.alice}, 'admin')`,
      ),
    ).rejects.toThrow(/row-level security/);
    const promoted = await actingAs({ userId: ids.alice, schoolId: ids.schoolA }, (sql) =>
      sql`update memberships set role = 'admin' where school_id = ${ids.schoolB} and user_id = ${ids.alice}`,
    );
    expect(promoted.count).toBe(0);
    await expect(
      actingAs({ userId: ids.alice, schoolId: ids.schoolA }, (sql) =>
        sql`insert into invitations (school_id, email, role, token_hash, expires_at)
            values (${ids.schoolB}, 'sneaky@example.com', 'admin', ${createHash('sha256').update('sneaky').digest()}, now())`,
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('only lets people create schools in their own name', async () => {
    await expect(
      actingAs({ userId: ids.alice }, (sql) =>
        sql`insert into schools (slug, name, created_by) values (${`forged-${ids.bob.slice(0, 8)}`}, 'Forged', ${ids.bob})`,
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('keeps the audit log append-only and hides other schools’ entries', async () => {
    await actingAs({ userId: ids.alice, schoolId: ids.schoolA }, (sql) =>
      sql`insert into audit_log (school_id, actor_id, action) values (${ids.schoolA}, ${ids.alice}, 'test.entry')`,
    );
    await expect(actingAs({ userId: ids.alice, schoolId: ids.schoolA }, (sql) => sql`delete from audit_log`)).rejects.toThrow(/permission denied/);
    await expect(actingAs({ userId: ids.alice, schoolId: ids.schoolA }, (sql) => sql`update audit_log set action = 'x.y'`)).rejects.toThrow(/permission denied/);
    await expect(
      actingAs({ userId: ids.alice, schoolId: ids.schoolA }, (sql) =>
        sql`insert into audit_log (school_id, action) values (${ids.schoolB}, 'test.forged')`,
      ),
    ).rejects.toThrow(/row-level security/);
    const fromB = await actingAs({ userId: ids.bob, schoolId: ids.schoolB }, (sql) => sql`select 1 from audit_log where school_id = ${ids.schoolA}`);
    expect(fromB).toHaveLength(0);
  });

  it('never lets the API role delete people or schools, or alter the schema', async () => {
    await expect(actingAs({}, (sql) => sql`delete from users where id = ${ids.bob}`)).rejects.toThrow(/permission denied/);
    await expect(actingAs({ schoolId: ids.schoolB }, (sql) => sql`delete from schools where id = ${ids.schoolB}`)).rejects.toThrow(/permission denied/);
    await expect(actingAs({}, (sql) => sql`alter table schools disable row level security`)).rejects.toThrow(/must be owner/);
  });

  it('finds an invitation by its token hash, and only that one, without a school', async () => {
    const rows = await actingAs({}, (sql) => sql`select school_id, email from app.invitation_by_token(${tokenHash})`);
    expect(rows).toEqual([{ school_id: ids.schoolA, email: 'guest-a@example.com' }]);
    const none = await actingAs({}, (sql) => sql`select 1 from app.invitation_by_token(${createHash('sha256').update('nope').digest()})`);
    expect(none).toHaveLength(0);
  });

  it('forgets the school when the transaction ends, so pooled connections never carry it over', async () => {
    await actingAs({ userId: ids.alice, schoolId: ids.schoolA }, async () => {});
    const settings = await Promise.all(
      [1, 2, 3, 4].map(() => app`select app.current_school_id() as school, app.current_user_id() as person`),
    );
    for (const [row] of settings) expect(row).toEqual({ school: null, person: null });
  });

  describe('courses and videos', () => {
    const course = { a: randomUUID(), b: randomUUID() };
    const modules = { a: randomUUID(), b: randomUUID() };

    beforeAll(async () => {
      await owner`insert into courses (id, school_id, slug, title) values
        (${course.a}, ${ids.schoolA}, ${`rls-${course.a.slice(0, 8)}`}, 'Course A'),
        (${course.b}, ${ids.schoolB}, ${`rls-${course.b.slice(0, 8)}`}, 'Course B')`;
      await owner`insert into course_modules (id, school_id, course_id, title, position) values
        (${modules.a}, ${ids.schoolA}, ${course.a}, 'M', 0), (${modules.b}, ${ids.schoolB}, ${course.b}, 'M', 0)`;
    });

    it("keeps each school's courses, outlines, videos and quota to itself", async () => {
      const seen = await actingAs({ userId: ids.alice, schoolId: ids.schoolA }, async (sql) => ({
        courses: (await sql`select id from courses where id in (${course.a}, ${course.b})`).map((row) => row.id),
        modules: (await sql`select id from course_modules where id in (${modules.a}, ${modules.b})`).map((row) => row.id),
        storage: (await sql`select school_id from school_storage where school_id in (${ids.schoolA}, ${ids.schoolB})`).map((row) => row.school_id),
      }));
      expect(seen).toEqual({ courses: [course.a], modules: [modules.a], storage: [ids.schoolA] });
    });

    it("can't attach a lesson to another school's course, even with its own school id", async () => {
      // Acting for school A, with school A's id on the row, but B's course: the composite key refuses it.
      await expect(
        actingAs({ userId: ids.alice, schoolId: ids.schoolA }, (sql) =>
          sql`insert into lessons (school_id, course_id, module_id, title, position) values (${ids.schoolA}, ${course.b}, ${modules.b}, 'Sneaky', 0)`,
        ),
      ).rejects.toThrow(/foreign key/);
      // A module of course A can't hold a lesson of another course.
      await expect(
        owner`insert into lessons (school_id, course_id, module_id, title, position) values (${ids.schoolB}, ${course.b}, ${modules.a}, 'Mixed', 0)`,
      ).rejects.toThrow(/foreign key/);
    });

    it("can't raise its own quota", async () => {
      const raised = await actingAs({ userId: ids.alice, schoolId: ids.schoolB }, (sql) =>
        sql`update school_storage set quota_bytes = 1e15 where school_id = ${ids.schoolA}`,
      );
      expect(raised.count).toBe(0);
      await expect(actingAs({ schoolId: ids.schoolA }, (sql) => sql`delete from school_storage`)).rejects.toThrow(/permission denied/);
    });

    it('lists abandoned uploads across schools by id only', async () => {
      const [stale] = await owner<{ id: string }[]>`
        insert into media_assets (school_id, status, file_name, content_type, declared_bytes, created_at)
        values (${ids.schoolB}, 'uploading', 'old.mp4', 'video/mp4', 10, now() - interval '2 days') returning id`;
      const rows = await actingAs({}, (sql) => sql`select * from app.stale_uploads(interval '1 day')`);
      expect(rows).toContainEqual({ id: stale!.id, school_id: ids.schoolB });
      expect(Object.keys(rows[0]!)).toEqual(['id', 'school_id']);
      // Without acting for school B, the row itself stays out of reach.
      expect(await actingAs({}, (sql) => sql`select 1 from media_assets where id = ${stale!.id}`)).toHaveLength(0);
    });
  });
  describe('learning and notifications', () => {
    it("keeps each school's progress, attempts and submissions to itself, and attempts unchangeable", async () => {
      const [course] = await owner<{ id: string }[]>`insert into courses (school_id, slug, title) values (${ids.schoolB}, ${`rls-learn-${randomUUID().slice(0, 8)}`}, 'Course B2') returning id`;
      const [module] = await owner<{ id: string }[]>`insert into course_modules (school_id, course_id, title, position) values (${ids.schoolB}, ${course!.id}, 'M', 0) returning id`;
      const [lesson] = await owner<{ id: string }[]>`
        insert into lessons (school_id, course_id, module_id, kind, title, position) values (${ids.schoolB}, ${course!.id}, ${module!.id}, 'quiz', 'Q', 0) returning id`;
      await owner`insert into lesson_progress (school_id, course_id, lesson_id, user_id) values (${ids.schoolB}, ${course!.id}, ${lesson!.id}, ${ids.alice})`;
      const [attempt] = await owner<{ id: string }[]>`
        insert into quiz_attempts (school_id, course_id, lesson_id, user_id, answers, results, score, max_score, percent, passed)
        values (${ids.schoolB}, ${course!.id}, ${lesson!.id}, ${ids.alice}, '{}', '[]', 0, 1, 0, false) returning id`;

      const fromA = await actingAs({ userId: ids.alice, schoolId: ids.schoolA }, async (sql) => ({
        progress: await sql`select 1 from lesson_progress where lesson_id = ${lesson!.id}`,
        attempts: await sql`select 1 from quiz_attempts where lesson_id = ${lesson!.id}`,
      }));
      expect(fromA).toEqual({ progress: [], attempts: [] });
      await expect(
        actingAs({ userId: ids.alice, schoolId: ids.schoolB }, (sql) => sql`update quiz_attempts set passed = true where id = ${attempt!.id}`),
      ).rejects.toThrow(/permission denied/);
      // Progress can't name a lesson of another course.
      const [other] = await owner<{ id: string }[]>`insert into courses (school_id, slug, title) values (${ids.schoolB}, ${`rls-other-${randomUUID().slice(0, 8)}`}, 'Other') returning id`;
      await expect(
        owner`insert into lesson_progress (school_id, course_id, lesson_id, user_id) values (${ids.schoolB}, ${other!.id}, ${lesson!.id}, ${ids.bob})`,
      ).rejects.toThrow(/foreign key/);
    });

    it('writes notifications only for members of the school acting for, and shows each person only their own', async () => {
      const dedupe = `rls-${randomUUID()}`;
      const added = await actingAs({ schoolId: ids.schoolB }, (sql) =>
        sql`select * from app.add_notifications(${[ids.alice, ids.bob, ids.alice]}::uuid[], 'course.published', ${sql.json({ title: 'Hi', body: '', path: '/', schoolName: 'B' })}, ${dedupe})`,
      );
      expect(added.map((row) => row.user_id).sort()).toEqual([ids.alice, ids.bob].sort());
      // The same event again notifies nobody twice.
      expect(await actingAs({ schoolId: ids.schoolB }, (sql) => sql`select * from app.add_notifications(${[ids.alice]}::uuid[], 'course.published', '{}', ${dedupe})`)).toHaveLength(0);
      // Bob isn't a member of school A, and nothing is written without a school.
      await expect(
        actingAs({ schoolId: ids.schoolA }, (sql) => sql`select * from app.add_notifications(${[ids.bob]}::uuid[], 'course.published', '{}', ${`${dedupe}-a`})`),
      ).rejects.toThrow(/foreign key/);
      expect(await actingAs({}, (sql) => sql`select * from app.add_notifications(${[ids.alice]}::uuid[], 'course.published', '{}', ${`${dedupe}-none`})`)).toHaveLength(0);

      const visible = await actingAs({ userId: ids.alice }, (sql) => sql`select user_id from notifications where dedupe_key = ${dedupe}`);
      expect(visible.map((row) => row.user_id)).toEqual([ids.alice]);
      const marked = await actingAs({ userId: ids.alice }, (sql) => sql`update notifications set read_at = now() where dedupe_key = ${dedupe}`);
      expect(marked.count).toBe(1);
      await expect(
        actingAs({ userId: ids.alice, schoolId: ids.schoolB }, (sql) =>
          sql`insert into notifications (user_id, school_id, type) values (${ids.bob}, ${ids.schoolB}, 'course.published')`,
        ),
      ).rejects.toThrow(/permission denied/);
    });
  });
});
