# Deploying Grand LMS for free

The web app runs on Netlify. The API, the worker, Postgres, Redis and Garage (the video store) run
on one Oracle Cloud Always Free server, behind Caddy for HTTPS, with LiveKit for live classes if
you want them. The API and the video store get free DuckDNS names. Nothing here
charges money: Netlify's free plan pauses at its limit instead of billing, and Always Free
resources stay free unless you upgrade the Oracle account to Pay As You Go. Oracle asks for a card
to verify your identity when you sign up; it isn't charged for Always Free resources.

```text
visitors ──► https://your-site.netlify.app ──(/api/v1/* proxied)──► https://grand-lms.duckdns.org
         ├──────────────── WebSocket (wss) ───────────────────────►  Caddy ► API ► Postgres, Redis
         ├── uploads, video (signed URLs) ──► https://media.grand-lms.duckdns.org ► Garage
         └── live classes (optional) ───────► wss://live.grand-lms.duckdns.org ► LiveKit
                                              + 7881/tcp, 7882/udp (audio, video)
                                                                     worker ► email (SMTP), ffmpeg
```

## 1. The server

1. Create an [Oracle Cloud](https://www.oracle.com/cloud/free/) account and a compute instance:
   - **Image**: Ubuntu 24.04.
   - **Shape**: VM.Standard.A1.Flex (Ampere, Always Free eligible). 4 OCPUs and 24 GB of memory
     is the whole free allowance and leaves room for transcoding video; 2 OCPUs and 12 GB is
     enough without many uploads.
   - **Boot volume**: videos are stored on the server's disk. Choose a custom boot volume size,
     such as 150 GB. Always Free covers 200 GB of block storage in total, and the default is
     about 47 GB.
   - **Networking**: assign a public IPv4 address. Reserve it, so it survives a restart.
   - **SSH**: add your SSH key.
2. Let web traffic in, in two places:
   - **The subnet**: in the subnet's security list, add ingress rules for TCP 80 and 443 (and
     UDP 443 for HTTP/3) from `0.0.0.0/0`.
   - **The server's own firewall**: Oracle's Ubuntu images block everything but SSH. Run:
     ```bash
     sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
     sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
     sudo iptables -I INPUT 6 -m state --state NEW -p udp --dport 443 -j ACCEPT
     sudo netfilter-persistent save
     ```
3. Install Docker with the Compose plugin, following Docker's guide for Ubuntu:
   ```bash
   curl -fsSL https://get.docker.com | sudo sh
   sudo usermod -aG docker $USER   # log out and back in
   ```

## 2. Names for the API and the video store

At [duckdns.org](https://www.duckdns.org), sign in and create a subdomain, such as `grand-lms`.
Point it at the server's public IP. The API will be `https://grand-lms.duckdns.org`, and the video
store `https://media.grand-lms.duckdns.org`: DuckDNS sends every name under yours to the same
address, so there is nothing more to set up. Any domain you own works the same way, with an `A`
record for each name.

## 3. Email

The worker sends invitations and notification emails (grades, by default) over SMTP. Free options:
- **[Brevo](https://www.brevo.com)**: 300 emails a day. Use
  `smtp://LOGIN:SMTP_KEY@smtp-relay.brevo.com:587`, and verify your sender address.
- **[Resend](https://resend.com)**: 100 emails a day. Use `smtps://resend:API_KEY@smtp.resend.com:465`.

## 4. Start the backend

```bash
git clone https://github.com/ibra-kdbra/video-clone.git grand-lms && cd grand-lms
cp infra/.env.prod.example infra/.env.prod
nano infra/.env.prod
```

Fill in every value:
- `API_DOMAIN`: the DuckDNS name. `MEDIA_DOMAIN`: the video store's name, `media.` and the same.
- `WEB_ORIGINS` and `PUBLIC_WEB_URL`: the Netlify site's address. Links in emails start with
  `PUBLIC_WEB_URL`.
- `SMTP_URL` and `MAIL_FROM`: from step 3.
- The four secrets: `POSTGRES_PASSWORD`, `APP_DB_PASSWORD`, `REDIS_PASSWORD` and `JWT_SECRET`.
  Generate each with:
  ```bash
  openssl rand -base64 48 | tr -d '/+=' | cut -c1-40
  ```
- Garage's secrets and the key the API and worker use to reach it. Garage expects hex:
  ```bash
  echo "GARAGE_RPC_SECRET=$(openssl rand -hex 32)"
  echo "GARAGE_ADMIN_TOKEN=$(openssl rand -hex 32)"
  echo "S3_ACCESS_KEY_ID=GK$(openssl rand -hex 12)"
  echo "S3_SECRET_ACCESS_KEY=$(openssl rand -hex 32)"
  ```

Then start everything:

```bash
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod up -d --build
```

Compose builds the images and starts Postgres, Redis and Garage. Next come two one-off containers:
- `migrate` runs the migrations, as the database owner.
- `storage-setup` gives Garage its storage role, creates the `grand-media` bucket and the access
  key, and lets the web app's origins upload to it (CORS).

Then Compose starts the API, the worker, and Caddy, which fetches Let's Encrypt certificates for
`API_DOMAIN` and `MEDIA_DOMAIN`. Every `up` runs both one-off containers again; they only change
what needs changing.

Check it:

```bash
curl https://grand-lms.duckdns.org/api/v1/health/ready
docker compose -f infra/docker-compose.prod.yml logs -f api worker
```

## 5. The web app on Netlify

1. In Netlify, import the repository. `netlify.toml` sets the build: base is the repository root,
   the command is `npm run build -w @grand/web`, and it publishes `apps/web/dist`.

   As it comes, `netlify.toml` also sets `VITE_DEMO = "true"`: the site runs the demo school in the
   browser, with no API (see the README's *Demo mode*). That's how the public demo is built. To use
   your own server, delete that line and set the variables below.
2. Under **Site configuration → Environment variables**, add:

| Variable | Value |
| --- | --- |
| `API_ORIGIN` | `https://grand-lms.duckdns.org` (no trailing slash) |
| `MEDIA_ORIGIN` | `https://media.grand-lms.duckdns.org`: the page may load video and images from here |
| `LIVEKIT_ORIGIN` | Only with LiveKit (step 6): `wss://live.grand-lms.duckdns.org` |
| `YOUTUBE_API_KEY`, `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` | Optional: the titles, pictures and lengths of the YouTube videos and Twitch clips lessons embed (see the README) |

3. Deploy. The build writes `dist/_redirects`, which proxies `/api/v1/*` to the API, and
   `dist/_headers`, whose Content-Security-Policy allows WebSockets to the API's host and video
   from the video store.
4. Put the site's address in `WEB_ORIGINS` and `PUBLIC_WEB_URL` on the server. If you changed
   them, restart the API and worker, which also updates the video store's CORS:
   ```bash
   docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod up -d
   ```

Requests through Netlify carry the visitor's address in `x-nf-client-connection-ip`, which the API
uses for rate limits (`CLIENT_IP_HEADER` in the compose file). Otherwise, all visitors would share
Netlify's few addresses and one busy visitor could slow everyone down.

## 6. Live classes with LiveKit (optional)

Every school can hold live classes with a YouTube Live stream or a meeting link (Zoom, Meet)
without any of this. [LiveKit](https://livekit.io), an open-source WebRTC server, adds classes
right in the browser: the host's camera, microphone and screen, and students who raise a hand
and are let in to speak. It runs on the same server, for free.

1. **Open its media ports**, in the same two places as in step 1: TCP 7881 and UDP 7882 from
   `0.0.0.0/0` in the subnet's security list, and on the server:
   ```bash
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 7881 -j ACCEPT
   sudo iptables -I INPUT 6 -m state --state NEW -p udp --dport 7882 -j ACCEPT
   sudo netfilter-persistent save
   ```
2. **Fill in** the LiveKit lines of `infra/.env.prod`:
   ```bash
   LIVE_DOMAIN=live.grand-lms.duckdns.org
   LIVEKIT_URL=wss://live.grand-lms.duckdns.org
   LIVEKIT_API_KEY=grand
   LIVEKIT_API_SECRET=   # openssl rand -hex 32
   ```
   `live.` and your DuckDNS name needs no DNS setup, like `media.`.
3. **Start it** with the `live` profile. Use the profile from now on in every `docker compose`
   command, or set it once for your shell:
   ```bash
   echo 'export COMPOSE_PROFILES=live' >> ~/.bashrc && . ~/.bashrc
   docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod up -d
   ```
   Caddy fetches a certificate for `LIVE_DOMAIN`, and the API starts offering LiveKit when a
   class is scheduled.
4. **On Netlify**, add `LIVEKIT_ORIGIN` = `wss://live.grand-lms.duckdns.org` and deploy again.
   The page's Content-Security-Policy only lets it connect to that server when it's named there.

Check it: `docker compose -f infra/docker-compose.prod.yml logs livekit` shows the public address
LiveKit found for itself, and it should be the server's. There's no TURN relay, so a few networks
that block everything but web traffic can't join; those students can follow a class streamed to
YouTube instead.

## Backups

Take a nightly compressed dump and keep the last 14:

```bash
mkdir -p ~/backups
crontab -e
# add:
15 2 * * * cd ~/grand-lms && docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod exec -T postgres pg_dump -U grand -Fc grand > ~/backups/grand-$(date +\%F).dump && find ~/backups -name 'grand-*.dump' -mtime +14 -delete
```

Copy the dumps off the server too, for example with [rclone](https://rclone.org) to a cloud drive.

The videos are not in the dump; they live in Garage's volumes on the boot volume. Back that up from
the Oracle console (**Compute → Boot volumes → your volume → Boot volume backups**). Always Free
includes five volume backups. A lost video can also be uploaded again: its lesson keeps everything
else.

To restore into an empty database:

```bash
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod exec -T postgres \
  pg_restore -U grand -d grand --clean --if-exists < ~/backups/grand-2026-09-30.dump
```

## Updating

```bash
git pull
docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.prod up -d --build
```

Migrations run before the new API starts. They're forward-only: to undo one, restore the backup
taken before the update and deploy the previous version (`git checkout <tag>`). With LiveKit, keep
the `live` profile (step 6), or LiveKit stops with the update.

## When something's wrong

| Symptom | Look at |
| --- | --- |
| The certificate isn't issued | The DuckDNS name must point at the server, and ports 80 and 443 must be open (step 1). See `docker compose ... logs caddy`. |
| `/health/ready` says down | `logs postgres redis api`. The API waits for the migrations; check `logs migrate`. |
| Sign-in works but the session is lost on reload | `WEB_ORIGINS` must exactly match the site's origin. The refresh call is refused from any other origin. |
| No live updates | The browser console shows the WebSocket error. Check that `API_ORIGIN` was set when the site was built, since the CSP names the API's host. |
| Invitations or notification emails don't arrive | `logs worker`. Failed sends retry with backoff, and the error is saved in `outbox.last_error`. Notification emails also depend on each person's settings (Account → Notifications). |
| Handing in a file fails | Same as uploads below: the site's origin must be in `WEB_ORIGINS`, and the school must have storage left. |
| Uploads fail at once, with a CORS error in the console | The site's origin must be in `WEB_ORIGINS`; run `up -d` again so `storage-setup` updates the bucket. See `logs storage-setup`. |
| Videos stay at "Processing" | `logs worker`: ffmpeg's error is there, and in the lesson's error message once it gives up. |
| Videos don't play | `MEDIA_ORIGIN` must be set on Netlify (the CSP names it), and `https://MEDIA_DOMAIN` must have a certificate (`logs caddy`). |
| LiveKit isn't offered when scheduling a class | `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` must all be set; restart the API after changing them. |
| A LiveKit class says it can't connect | The console shows a CSP error: `LIVEKIT_ORIGIN` isn't set on Netlify. Otherwise check `logs livekit caddy`, and that `LIVE_DOMAIN` has a certificate. |
| People join a LiveKit class but see and hear nothing | The media ports aren't open: TCP 7881 and UDP 7882, in the security list and in iptables (step 6). |
| Class reminders don't arrive | `logs worker`: the live classes job runs every minute. Reminders go 15 minutes before the start, to the course's students and the host. |
