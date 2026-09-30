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
});
