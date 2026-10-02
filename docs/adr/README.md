# Architecture decision records

Short notes on the choices that shape Grand LMS: the context, the decision, and what it costs.
A decision that changes gets a new record that supersedes the old one.

| # | Decision | Status |
| --- | --- | --- |
| [1](0001-monorepo-nestjs.md) | One repository; NestJS 12 on Fastify for the API and worker | Accepted |
| [2](0002-row-level-security.md) | Many schools in one database, separated by Postgres row-level security | Accepted |
| [3](0003-sessions-and-tokens.md) | Short access tokens in memory, rotating refresh tokens in a cookie | Accepted |
| [4](0004-outbox.md) | Transactional outbox, relayed to BullMQ | Accepted |
| [5](0005-realtime.md) | Socket.IO with single-use tickets and a Redis adapter | Accepted |
| [6](0006-free-hosting.md) | Free hosting: Netlify for the app, one Oracle Always Free server for the rest | Accepted |
| [7](0007-video-pipeline.md) | Videos in self-hosted S3 storage (Garage), uploaded directly, transcoded to HLS by the worker, played through signed URLs | Accepted |
| [8](0008-learning-progress.md) | Watch progress as a bitset of 5-second stretches; quizzes graded on the server; assignments with signed uploads; notifications from the outbox | Accepted |
| [9](0009-live-and-social.md) | Live classes over LiveKit, YouTube Live or a link, with our own chat; discussions in one table with moderation; search with Postgres full text | Accepted |
