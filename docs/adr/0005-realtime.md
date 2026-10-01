# 5. Socket.IO with single-use tickets and a Redis adapter

**Status:** accepted, 2026-09-30

## Context
Schools need live updates: members joining, who's online and, later, live classes and chat.
Browsers can't set an `Authorization` header on a WebSocket. A token in the URL ends up in logs.
Netlify's proxy doesn't carry WebSockets, so the browser connects to the API server directly, from
another origin.

## Decision
- **Transport**: Socket.IO on the API's port at `/api/v1/ws`. WebSocket transport only, and only
  from the web app's origins. Messages are capped at 16 KiB, with a per-connection event budget.
- **Signing in**:
  - The app asks `POST /realtime/ticket` for a ticket, using its access token.
  - The ticket is random, lives 30 seconds in Redis, and is redeemed with `GETDEL`, so it works once.
  - It goes in the handshake's `auth` field, and the app fetches a fresh one on every reconnect.
- **Rooms**: `user:{id}`, `session:{id}`, and `school:{id}` after a membership check. Revoking a
  session tells its sockets why, then disconnects them.
- **Scaling**: the Redis adapter spreads rooms, broadcasts and presence queries (`fetchSockets`)
  across API instances.

## Consequences
- The page's Content-Security-Policy allows `wss://` to the API's host (from `REALTIME_ORIGIN`).
- The Redis pub/sub connections turn auto-pipelining off. Otherwise an `UNSUBSCRIBE` could be
  deferred past the `QUIT` at shutdown.
