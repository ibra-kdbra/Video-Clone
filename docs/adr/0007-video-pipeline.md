# 7. Video: storage, transcoding and playback

**Status:** accepted, 2026-10-01. Replaces the video storage plan in [ADR 6](0006-free-hosting.md).

## Context
Phase 1 lets instructors upload lesson videos. They have to work within these limits:
- Everything stays free, with nothing that could be billed. ADR 6 planned Cloudflare R2, but R2
  can only be turned on with a payment method attached, and use beyond its free tier is then
  billed.
- One small server runs the API, the worker and the databases. Uploads of a gigabyte or more must
  not pass through the API or through Netlify's proxy.
- Viewers' connections vary, so playback has to adapt.
- A video belongs to its school: a link copied out of the page should stop working soon after.

## Decision
- **Storage:** any S3-compatible store. By default this is [Garage](https://garagehq.deuxfleurs.fr)
  on the same server.
  - Garage is a single small binary with a low memory footprint. Its data sits on the server's free
    block storage (Always Free includes 200 GB).
  - MinIO was the obvious other choice, but its community edition no longer ships ready-made images.
  - Cloudflare R2, Backblaze B2 or any other S3-compatible service works with the same code, by
    changing the `S3_*` settings.
  - The bucket is private. Browsers reach it at its own name (`MEDIA_DOMAIN`), through Caddy.
- **Uploads go straight to storage:** presigned multipart upload from the browser.
  - Parts are 16 MiB, larger only when a file would otherwise need more than 10,000 parts.
  - The declared size is reserved against the school's quota when the upload starts
    (`school_storage.reserved_bytes`, row-locked).
  - When it completes, the stored size is checked against the declared one.
  - Uploads left unfinished are cleared away after a day by the worker. Two days is also a bucket
    lifecycle rule.
- **Transcoding:** the worker takes `media.uploaded` events from the outbox and runs a BullMQ
  `media` queue.
  - One ffmpeg run produces an HLS ladder in fragmented MP4: 1080p, 720p, 480p and 360p, but only
    the qualities at or below the source's.
  - Keyframes come every 2 seconds, in 6-second segments.
  - The worker also makes a poster frame and a storyboard: 10×10 sprite sheets plus WebVTT, for
    previews when scrubbing.
  - Progress is broadcast as it goes, to the school's staff (instructors and above) over Socket.IO.
  - A file ffmpeg can't read, or a video over the length limit, fails with a reason the
    instructor sees, and its storage is freed.
  - Originals are deleted once transcoded, unless `MEDIA_KEEP_ORIGINALS`.
- **Playback:**
  - The API checks enrollment, then returns a playlist address that carries an HMAC token. The
    token is signed for one video, with a key of its own, and expires after
    `MEDIA_URL_TTL_SECONDS` (4 hours by default).
  - The API serves the playlists itself. It rewrites them so that every segment, poster and sprite
    is a presigned storage URL. The bytes stream from storage; the API only sends a few kilobytes
    of text.
  - Signatures are made for fixed one-hour windows. The same segment then has the same URL for an
    hour, so browsers and the API's playlist cache can reuse it.
  - hls.js plays it, choosing the quality from the connection. Safari plays HLS natively.
- **Embeds:** a lesson can use a YouTube, Dailymotion or Twitch video instead. Only the video id
  is stored, checked against each platform's id format, and the platform's own player plays it.

## Consequences
- Transcoding shares the server's four cores with everything else. By default the worker
  transcodes one video at a time, on two threads (`TRANSCODE_CONCURRENCY`, `TRANSCODE_THREADS`).
  A long upload takes a while to be ready, and the progress bar says how far along it is.
- Videos live on one disk, with one copy each. They are not in the nightly database backup. A
  block-volume backup covers them; Oracle includes five for free (see docs/deploy.md).
- Signed URLs can be passed on until they expire. This keeps casual sharing in check, but it is
  not DRM, and a determined viewer can still save what they watch.
- Moving to R2 or B2 later means copying the bucket and changing settings, not code.
