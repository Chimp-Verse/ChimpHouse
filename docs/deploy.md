# Putting ChimpHouse online

ChimpHouse is two pieces, and each goes somewhere different:

- **The website** (the 3D house itself): a folder of files, built with `npm run build`. It goes on **Cloudflare Pages**, which is free. It is the same in every option below.
- **The room server** (what keeps every visitor's lift, screens and chimps in step): one small always-on program. It goes on **one** of three kinds of host. Pick one; they all run the same server, so you can move between them later.

Prices are from the October 2026 hosting research and each host's pricing page then. Check the host's own pricing page before paying: prices change.

## In plain words (for the owner)

| | Option 1: a small rented server (VPS) | Option 2: Fly.io | Option 3: Render / Railway / Koyeb / DigitalOcean App Platform |
| --- | --- | --- | --- |
| What it is | You rent a tiny computer in a data centre; a helper sets it up once | A host that runs the server from a recipe in the project | A host that rebuilds the server every time the code is pushed to GitHub |
| Cost per month | About $5-7 (Hetzner about EUR 6; DigitalOcean $4-6) | About $2-4, plus about $0.02 per GB sent to visitors | Render $7, Railway about $5-10, Koyeb about $2-3, DigitalOcean App Platform about $5 |
| Surprise bills | None: traffic is included | Possible: data sent is billed | Railway bills by use; the others are fixed |
| Account you create | Hetzner or DigitalOcean | Fly.io (a card is needed) | Render, Railway, Koyeb or DigitalOcean (a card is needed) |
| What you click | Create the server, add your SSH key, then give a helper the address; add one DNS record | Sign up, install one command-line tool, a helper runs it; add one DNS record | Sign up, click "connect GitHub", choose the project, set one setting; add one DNS record |
| Updates | One command on the server | One command | Automatic when code is pushed |
| Best for | Cheapest that never sleeps | Cheap and small, if you don't mind a command line | Least to look after |

Plus, for all three: a **Cloudflare account** (free; the website is hosted there) and **a domain name** (about $10-15 a year, from any registrar, or from Cloudflare). The website lives at an address like `house.example.com` and the room server at `room.example.com`.

Never use a free plan for the room server (Render's Free, Koyeb's free instance and the like): they fall asleep when quiet, and a sleeping server drops everyone out of the house. The templates here ask for paid, always-on plans only.

One thing outside ChimpHouse: the games in the arcade and the TV come from ChimpVibe (`chimpvibe.dev`, played at `play.chimpvibe.dev`). Once the house is at its real address, ChimpVibe has to allow that address (see "ChimpVibe" below). Until it does, the house still works, with its built-in sample game list.

## What an agent needs before starting

Two addresses, used in several places, written the same way each time (with `https://`, no slash at the end):

- `HOUSE_ORIGIN`: where the website is, e.g. `https://house.example.com` (and `https://<project>.pages.dev` too if visitors may use that address).
- `ROOM_URL`: where the room server is, as `wss://room.example.com` (the same address, with `wss://` in front instead of `https://`).

Facts that matter:

- The website is built with `VITE_CHIMPHOUSE_ROOM_URL=<ROOM_URL>`. That value is written into the files at build time, so changing the room server's address means building the website again.
- The room server refuses to start in production without `CHIMPHOUSE_ROOM_ORIGINS=<HOUSE_ORIGIN>` (several origins: separate them with commas). A page from any other site is refused when it tries to join. A Cloudflare preview address (`<hash>.<project>.pages.dev`) is another site, so it can't join unless it is listed too.
- Run exactly **one** room server process. The house lives in that process's memory (the lift, the shared screens); a second one would be a second, separate house with the visitors split between them.
- Restarting the server (a deploy, a reboot) puts the lift back at the lower floor with its doors shut. Visitors' pages reconnect by themselves within a few seconds and put back what they know.
- The server answers `GET /health` with `200 {"ok":true}`. It ends cleanly on SIGTERM.
- A visitor's connection must be allowed to stay open for hours: proxies that cut connections that have been quiet for 60 seconds (Nginx's default) must be told otherwise (`deploy/nginx.conf`).

Nothing in these steps needs to be changed in the code. Signing up, paying, DNS records and pressing "deploy" are for the owner or on the owner's go-ahead.

## Part A: the website on Cloudflare Pages (all options)

The build is plain static files: `npm run build` writes `dist/` (an `index.html`, `assets/` with hashed names, and the sounds, textures and small pages from `public/`). Nothing on the page needs a server of its own. Measured on 2026-10-20: 304 files, 56 MB, the largest file 7.5 MB (the main script; the rest are 3.3 MB and under), against Pages' limits of 20,000 files and 25 MiB per file.

1. Make a Cloudflare account and, in the dashboard, **Workers & Pages** > **Create** > **Pages** > **Connect to Git** > pick the ChimpHouse repository. (Without Git: `npx wrangler pages deploy dist --project-name chimphouse` after a local build; that uploads, so it is the owner's go-ahead.)
2. Build settings:
   - Framework preset: None
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Root directory: leave empty
   - Environment variables (production): `VITE_CHIMPHOUSE_ROOM_URL` = `wss://room.example.com` (the `ROOM_URL`), and `NODE_VERSION` = `22` (`.node-version` in the repository says the same).
3. Save and deploy. Cloudflare installs the packages, runs the build and publishes `dist/`. The first build takes a minute or two.
4. **Custom domain**: the project's **Custom domains** tab > add `house.example.com`. If the domain's DNS is on Cloudflare this is two clicks; otherwise Cloudflare shows a CNAME record to add at the registrar.
5. Tell the room server about this address (Part B: `CHIMPHOUSE_ROOM_ORIGINS`).

Details:

- `public/_headers` (copied into `dist/`) gives the hashed files in `assets/` a one-year cache and sets `X-Content-Type-Options: nosniff`. It sets no framing, referrer or content-security rule on purpose: nothing in the page or its code sets one either, so YouTube's player (theatre) and ChimpVibe's games (arcade, Game Room TV) load in their frames. Don't add a `Content-Security-Policy` or `Referrer-Policy: no-referrer` without allowing `https://www.youtube.com`, `https://www.youtube-nocookie.com`, `https://play.chimpvibe.dev` and `https://chimpvibe.dev` as frame and connect sources: YouTube's player refuses to play (error 153) when it isn't told which site is asking.
- `npm run build` also type-checks the pages and the room server; it needs the development packages, which Pages installs unless `NODE_ENV=production` is set in its build variables (don't set it there).
- Pages serves `index.html` for any address that isn't a file. The house is one page; there are no other routes.
- The 26 concept-art pictures (about 44 MB of the 56 MB) are in `dist/assets/` because `src/world/viewpoints.ts` imports them for the developer-only viewpoint comparison. Only the developer-only viewpoint comparison shows them, so visitors don't download them; they count toward the upload only.

### ChimpVibe

In a browser, the house reads ChimpVibe's game list (`https://chimpvibe.dev/shared/showcase.json`, and `catalog.json` for the TV) straight from ChimpVibe, and frames its games at `https://play.chimpvibe.dev/<game>`. For this to work from the real address, ChimpVibe's side must allow `HOUSE_ORIGIN`: CORS for the two lists and the game art, and permission to be framed by it. Until then the console says "ChimpVibe's game list isn't available" and the house uses the sample list in `public/arcade/chimphouse.json`. (In development the Vite server relays those requests; that relay doesn't exist on a static host.) This is for ChimpVibe's maintainers to set, not something to change here.

## Part B: the room server

All three options run the same compiled program. The commands, from the project folder:

```sh
npm ci
npm run room:build          # compiles server/main.ts to server/dist/ (node runs it; no tsx)
CHIMPHOUSE_ROOM_ORIGINS=https://house.example.com npm run room:start
```

Settings (environment variables): `CHIMPHOUSE_ROOM_ORIGINS` (required), `PORT` or `CHIMPHOUSE_ROOM_PORT` (the port; hosts that set `PORT` are followed), `CHIMPHOUSE_ROOM_HOST` (`localhost` by default; `0.0.0.0` in the Dockerfile; `127.0.0.1` behind a proxy on the same machine). `CHIMPHOUSE_ROOM_TEST_COMMANDS` is ignored in production. The full list is in the README, "The room server".

The container (`Dockerfile`, room server only, Node 24, non-root, production packages only) listens on port 8080:

```sh
docker build -t chimphouse-room .
docker run -d --name chimphouse-room --restart unless-stopped -p 8080:8080 \
  -e CHIMPHOUSE_ROOM_ORIGINS=https://house.example.com chimphouse-room
curl -i http://localhost:8080/health      # 200
```

### Option 1: a small VPS (Hetzner or DigitalOcean) with Caddy

Recommended. Cost: Hetzner CX23 about EUR 6 a month with its IPv4 address, DigitalOcean Basic $4 (512 MB) or $6 (1 GB, the safer size). Pick the region nearest most visitors (US East, or Germany).

1. Create the server: Ubuntu 24.04, the smallest size above, with your SSH key. Note its IP address.
2. DNS: add an `A` record `room` -> the server's IP (and `AAAA` if it has an IPv6 address) at the domain's DNS. If the domain is on Cloudflare, set the record to **DNS only** (grey cloud) so Caddy can get its certificate directly.
3. On the server (as root, or with sudo):
   ```sh
   apt update && apt -y upgrade
   ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw --force enable
   curl -fsSL https://deb.nodesource.com/setup_24.x | bash - && apt -y install nodejs git
   apt -y install debian-keyring debian-archive-keyring apt-transport-https curl gnupg
   # Caddy: follow https://caddyserver.com/docs/install#debian-ubuntu-raspbian (adds its package source), then: apt -y install caddy
   useradd --system --create-home --shell /usr/sbin/nologin chimp
   git clone <the repository's address> /opt/chimphouse && chown -R chimp:chimp /opt/chimphouse
   cd /opt/chimphouse && sudo -u chimp npm ci && sudo -u chimp npm run room:build
   mkdir -p /etc/chimphouse
   cp deploy/chimphouse-room.conf.example /etc/chimphouse/room.conf
   ```
4. Edit `/etc/chimphouse/room.conf`: set `CHIMPHOUSE_ROOM_ORIGINS` to the `HOUSE_ORIGIN`; leave the rest. Then `chmod 600 /etc/chimphouse/room.conf`.
5. Start it: `cp deploy/chimphouse-room.service /etc/systemd/system/ && systemctl daemon-reload && systemctl enable --now chimphouse-room`. Look: `systemctl status chimphouse-room`, `journalctl -u chimphouse-room -n 20` (it should say "listening ... (production)").
6. HTTPS in front: copy `deploy/Caddyfile` to `/etc/caddy/Caddyfile`, replace `room.example.com` with the real name, `systemctl reload caddy`. Caddy gets the certificate by itself (the DNS record must already point here) and passes WebSockets through with no setting; it has no idle limit on them.
   - Nginx instead of Caddy: `deploy/nginx.conf` (Upgrade headers and 86400 s read and send timeouts, written out; Nginx's default is 60 s), then `certbot --nginx -d room.example.com`.
   - pm2 instead of systemd: `deploy/ecosystem.config.cjs` (fork mode, one instance).
   - Docker instead of Node on the machine: use the `docker run` command above with `-p 127.0.0.1:2567:8080`, and Caddy's `reverse_proxy 127.0.0.1:2567`.
7. Check (see "Checking it works").
8. **Update**: `cd /opt/chimphouse && sudo -u chimp git pull && sudo -u chimp npm ci && sudo -u chimp npm run room:build && systemctl restart chimphouse-room`.

### Option 2: Fly.io

Cost: a shared 1-CPU machine with 512 MB is about $3.70 a month (256 MB about $2.20) in the cheapest regions, plus about $0.02 per GB sent. A credit card is required. The room server's data use is small at tens of visitors; at 50 visitors all moving it is about 18 GB an hour, so watch the bill if the house gets busy.

`fly.toml` is ready: one machine, always on (`auto_stop_machines = "off"`, `min_machines_running = 1`), health check on `/health`, internal port 8080.

1. Install `flyctl` (https://fly.io/docs/flyctl/install/) and `fly auth signup` (or `fly auth login`).
2. In the project folder: `fly launch --no-deploy --copy-config --name <your-app-name>` (answer No to a database and to deploying now; keep the existing `fly.toml`). Pick the region nearest most visitors (`primary_region` in `fly.toml`).
3. `fly secrets set CHIMPHOUSE_ROOM_ORIGINS=https://house.example.com` (before the first deploy: without it the server refuses to start).
4. `fly deploy --ha=false` (`--ha=false` keeps it to one machine). Then `fly status` should show one machine, `started`, with the check passing.
5. Address: `wss://<your-app-name>.fly.dev` works at once. For `room.example.com`: `fly certs add room.example.com`, then add the CNAME record it prints. Build the website with whichever you use.
6. **Update**: `fly deploy --ha=false`. Never `fly scale count` above 1.

### Option 3: git-push hosts (Render, Railway, Koyeb, DigitalOcean App Platform)

All four build the `Dockerfile` from the GitHub repository and set `PORT` themselves; the server follows it. Use their paid, always-on plans, one instance, and set `CHIMPHOUSE_ROOM_ORIGINS` as an environment variable. Each wants a health check path of `/health`.

- **Render** (Starter, $7 a month): **New** > **Blueprint** > pick the repository; it reads `render.yaml` (Docker, Starter plan, one instance, health check `/health`). Edit the `CHIMPHOUSE_ROOM_ORIGINS` value in `render.yaml` before the first deploy, or in the service's **Environment** tab afterwards. Custom domain: **Settings** > **Custom Domains** > `room.example.com`, add the CNAME it shows. A push to the branch redeploys.
- **Railway** (Hobby, about $5-10 a month by use): **New Project** > **Deploy from GitHub repo**. `railway.json` makes it build the Dockerfile, one replica, health check `/health`. **Variables**: add `CHIMPHOUSE_ROOM_ORIGINS`. **Settings** > **Networking** > **Generate Domain** (or add `room.example.com` and its CNAME). Set the region in **Settings** to the one nearest visitors.
- **Koyeb** (Eco instances, about $1.60-2.70 a month): create a **Web Service** from the GitHub repository, builder **Dockerfile**, an Eco instance of 512 MB (not the free instance: it scales to zero when idle), scaling min 1 max 1, port 8080 over HTTP, health check path `/health`, environment variable `CHIMPHOUSE_ROOM_ORIGINS`. Add `room.example.com` under **Domains**.
- **DigitalOcean App Platform** (about $5 a month for 512 MB): **Create App** from the GitHub repository; it detects the Dockerfile. Make it a **Web Service**, one container (Basic, 512 MB), HTTP port 8080, health check `/health`, environment variable `CHIMPHOUSE_ROOM_ORIGINS`. Add `room.example.com` under **Settings** > **Domains**. WebSockets through App Platform were not confirmed in the research: do the browser check below before relying on it.

On any of these, the room server's address is the host's `https://...` address with `wss://` instead, or the custom domain.

## Checking it works

Replace the names. An agent can run all of this.

```sh
curl -i https://room.example.com/health                  # HTTP 200, {"ok":true}
```

1. The server's log says `listening ... (production) (pages from https://house.example.com)`.
2. A page from an allowed site joins, one from another doesn't. With Node and the `ws` package (already installed by `npm ci`), connect after a matchmaking request, once with `Origin: https://house.example.com` (stays open) and once with `Origin: https://evil.example` (closed with code 4002 at once).
3. Open `https://house.example.com` in two browsers (or one normal window and one private window). In one, walk to the lift and call it (E). In the other, the car should be moving and its music playing. That is the shared room working through the host's proxy.
4. In the browser console (F12), no `WebSocket connection failed` and no `CORS` message about the room address. The wrong `VITE_CHIMPHOUSE_ROOM_URL` or a missing `https://house...` in `CHIMPHOUSE_ROOM_ORIGINS` are the usual causes; fix and rebuild the website (for the first) or restart the server (the second).
5. Restart the server and watch both browsers: they should reconnect by themselves within seconds and the lift should be back at the lower floor.

On a development computer the same checks run with `tools/test-lift-sync.mjs` against the built website (`URL=http://localhost:5199 node tools/test-lift-sync.mjs`, after `vite preview --port 5199`) and a production room server started with `CHIMPHOUSE_ROOM_ORIGINS=http://localhost:5199 PORT=5198`, the website built with `VITE_CHIMPHOUSE_ROOM_URL=ws://localhost:5198`. `tools/test-room.mjs` needs the test commands, which production refuses, and the `tools/room-visitor.html` page, which only the development server serves: run the compiled server without `NODE_ENV=production` and with `CHIMPHOUSE_ROOM_TEST_COMMANDS=1` for it.

## Things that go wrong

- **The server exits at once with "CHIMPHOUSE_ROOM_ORIGINS is not set"**: set it (the host's environment-variable page, or `/etc/chimphouse/room.conf`).
- **Visitors are dropped now and then, at regular intervals**: a proxy in front is cutting long-lived connections. Nginx needs the timeouts in `deploy/nginx.conf`; on a VPS keep the room's DNS record grey (DNS only) rather than behind Cloudflare's orange-cloud proxy.
- **Every visitor alone in their own house** (nobody sees anyone): two server processes, or a host scaling to two. Keep one.
- **"This house doesn't take visitors from that site"** in the server log: the page's address isn't in `CHIMPHOUSE_ROOM_ORIGINS` (check `www.`, `http` against `https`, a trailing slash, the `pages.dev` address).
- **Mixed content / blocked ws:// connection**: the website is on HTTPS, so `VITE_CHIMPHOUSE_ROOM_URL` must be `wss://`.
- **A host's free or sleeping plan**: the server stops when quiet. Use the paid, always-on plan.

## What was left out on purpose

Colyseus Cloud, Google Cloud Run, AWS Lightsail and other static hosts (Netlify, Vercel, GitHub Pages) are not set up here; the October 2026 hosting research says why. Nothing here needs Redis, sticky sessions or a public address: one process, one house.
