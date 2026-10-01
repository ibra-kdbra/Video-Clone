# 2. Many schools in one database, separated by row-level security

**Status:** accepted, 2026-09-30

## Context
Grand LMS hosts many schools (tenants) on free infrastructure: one Postgres instance. The usual
options are:
- a database per school, which doesn't fit a free server
- a schema per school, which makes migrations slower with every school
- shared tables with a `school_id` column

The risk with shared tables is a single forgotten `WHERE school_id = ...` that shows one school's
data to another.

## Decision
- Shared tables with `school_id`, and Postgres row-level security enforcing the separation.
- **Two roles**: the API and the worker connect as `grand_app`, which owns no table, so policies
  always apply to it. Migrations run as the owner. `grand_app` gets only the grants it needs; for
  example, the audit log accepts `INSERT` and `SELECT` only.
- **Scoping**: every API transaction begins with
  `set_config('app.user_id', ...)` and `set_config('app.school_id', ...)`, transaction-local, so
  pooled connections never carry them over. The policies compare rows against
  `app.current_school_id()` and `app.current_user_id()`.
- **The one case without a school**: someone holding an invitation link doesn't act for any school
  yet. It's served by a `SECURITY DEFINER` function that returns exactly the row matching the
  token's hash.

## Consequences
- A missing filter in application code returns nothing from other schools, instead of leaking them.
  `test/rls.test.ts` proves this against the real database.
- Every query must go through `DatabaseService.transaction(scope, ...)`. That's the only way the
  API reaches the database.
- A school that outgrows the shared database can later be moved to its own, and the policies move
  with the tables.
