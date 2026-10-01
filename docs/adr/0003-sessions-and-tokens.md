# 3. Short access tokens in memory, rotating refresh tokens in a cookie

**Status:** accepted, 2026-09-30

## Context
The web app and the API share an origin through Netlify's proxy. Tokens in `localStorage` can be
stolen by any script that runs on the page. Cookies alone make every request cookie-authenticated,
which then needs CSRF protection everywhere. Real-time needs the same identity.

## Decision
- **Access tokens**: JWTs (HS256) valid for 15 minutes, returned in JSON and kept in memory. They
  name the person and the session. Every request checks a Redis revocation marker for the session,
  so signing out, or revoking a device, takes effect at once rather than after 15 minutes.
- **Refresh tokens**:
  - 32 random bytes, in an `httpOnly`, `Secure`, `SameSite=Strict` cookie scoped to `/api/v1/auth`.
  - Stored as SHA-256 hashes.
  - Rotated on every use.
  - A reused token ends its whole session (reuse detection).
  - Claiming a token is one atomic `UPDATE ... WHERE used_at IS NULL`.
  - The cookie routes also require the app's `Origin`.
- **Limits**: a session lasts at most 90 days, and a refresh token 30.
- **Passwords**: Argon2id (19 MiB, t=2, p=1), upgraded on login when the settings rise.
- **Login throttling**: a timing-safe dummy check for unknown addresses; a lock after 10 failed
  attempts per address; a request limit per client address.

## Consequences
- Other sites can't make requests with the cookie. Page scripts never see the refresh token.
- Tabs share one cookie, so the web app serializes refreshes across tabs with the Web Locks API.
  Otherwise, two tabs racing would look like reuse.
- Email verification and password reset aren't part of Phase 0. Accepting an emailed invitation
  marks the address as verified.
