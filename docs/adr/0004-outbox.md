# 4. Transactional outbox, relayed to BullMQ

**Status:** accepted, 2026-09-30

## Context
Some changes must cause work elsewhere: an invitation sends an email, and a new member will later
notify people and update analytics. Sending from the request handler can lose the work (a crash
after the commit) or do it for a change that rolled back.

## Decision
- **Writing**: the API writes each event to the `outbox` table in the same transaction as the
  change. An `AFTER INSERT` trigger sends `pg_notify('outbox', id)`, which Postgres delivers only
  on commit.
- **Relaying**: the worker's relay listens for it, and polls every 5 s in case a notification was
  missed.
  - It claims rows with `FOR UPDATE SKIP LOCKED`, so several workers can run.
  - It adds them to BullMQ with job id `outbox-{id}`, so re-publishing is a no-op.
  - Then it marks them published.
- **Processing**: the BullMQ processor checks `processed_at` before handling an event and sets it
  after, with retries and exponential backoff. Payload fields marked secret (the invitation link)
  are removed once handled.
- **Clean-up**: a nightly BullMQ job scheduler removes handled events after 14 days, expired
  refresh tokens, and sessions ended over 30 days ago.

## Consequences
- Delivery is at least once: an email can be repeated after a crash, but never lost.
- The API doesn't depend on BullMQ at all; only the worker does.
- New event types need only a handler in `apps/worker/src/jobs/outbox.processor.ts`.
