# VPS Panel

Self-hosted control panel to manage Docker containers, domains (Nginx + Certbot), and Git-based deploys on a single VPS.

> **Status:** Phase 1 MVP scaffold. Currently implements: single-admin auth + Docker container list / start / stop / restart / remove / logs. Domains, push-to-deploy, file editor, env-var management come in Phases 2–4. See [PRD.md](PRD.md).

## Stack

| Layer | Choice |
|---|---|
| API | Node 22 + Fastify + TypeScript + Prisma (`apps/api`) |
| Web | Vite + React + TailwindCSS (`apps/web`) — swapped from Next.js because SSR adds no value for a personal panel |
| DB | Postgres 16 |
| Queue / Cache | Redis 7 (scaffolded; used heavily from Phase 3) |
| Docker control | `dockerode` over the host Docker socket / named pipe |
| Auth | argon2 (`@node-rs/argon2`) + opaque session cookies |

## Prerequisites

- **Node.js >= 22**
- **pnpm >= 9** (`npm i -g pnpm` if missing)
- **Docker Desktop** (Windows / Mac) or Docker Engine (Linux) — running

## First-time setup

```powershell
# 1. Install deps
pnpm install

# 2. Copy env file and edit values (especially the secrets)
copy .env.example .env

# Generate a strong SESSION_SECRET (>=32 chars):
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"

# Generate a 32-byte PANEL_MASTER_KEY:
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"

# 3. Start Postgres + Redis
pnpm dev:services

# 4. Push the Prisma schema to the DB (first time only)
pnpm db:push

# 5. Start API + web in parallel
pnpm dev
```

- API:  http://localhost:4000
- Web:  http://localhost:3030

On first API boot, an admin user is created from `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `.env`. Log in with those credentials.

## Daily dev loop

```powershell
pnpm dev:services         # start postgres + redis (idempotent)
pnpm dev                  # runs api + web in parallel
pnpm dev:services:down    # stop postgres + redis when done
```

## Project layout

```
.
├── PRD.md                       # product spec — read this first
├── docker-compose.dev.yml       # postgres + redis for local dev
├── apps/
│   ├── api/                     # Fastify backend
│   │   ├── prisma/schema.prisma
│   │   └── src/
│   │       ├── index.ts         # entry
│   │       ├── server.ts        # Fastify wiring
│   │       ├── env.ts           # zod-validated env
│   │       ├── db.ts            # Prisma client
│   │       ├── docker.ts        # dockerode helpers
│   │       ├── lib/crypto.ts    # argon2 + AES-GCM
│   │       ├── lib/seed.ts      # first-run admin seed
│   │       ├── plugins/auth.ts  # session middleware
│   │       └── routes/          # health, auth, containers
│   └── web/                     # Vite + React frontend
│       └── src/
│           ├── main.tsx         # router root
│           ├── pages/login.tsx
│           ├── pages/containers.tsx
│           ├── components/require-auth.tsx
│           └── lib/api.ts       # fetch wrapper
└── package.json                 # pnpm workspaces root
```

## How Docker is reached

- **Windows (dev):** dockerode connects to the named pipe `//./pipe/docker_engine` automatically (Docker Desktop must be running).
- **Linux (prod):** dockerode connects to `DOCKER_SOCKET` (default `/var/run/docker.sock`). The panel container will need this socket mounted: `-v /var/run/docker.sock:/var/run/docker.sock`.

> **Security note:** Mounting the Docker socket gives the panel root-equivalent power on the host. Do not expose the API publicly without HTTPS + strong auth + (eventually) 2FA. See the risks section in `PRD.md`.

## Domain binding (Phase 2)

The panel runs an **nginx container** (`panel_nginx`) that reverse-proxies hostnames to your apps. All panel-managed app containers join a shared Docker network (`panel_net`) and are reachable inside that network by their slug (`hello`) or by `panel_<slug>`.

When you add a domain to an app:

1. Panel writes `/<hostname>.conf` into the nginx config volume via `docker putArchive`.
2. Runs `nginx -t` to validate; aborts and deletes the file if invalid.
3. Reloads nginx with `nginx -s reload`.

### Testing on Windows (no DNS)

To hit `hello.local` from your browser, edit:

```
C:\Windows\System32\drivers\etc\hosts
```

Open Notepad **as Administrator**, then add a line:

```
127.0.0.1   hello.local
```

Save. Now `http://hello.local` resolves to the panel's nginx (port 80), which proxies to your app container.

### Testing on a Linux VPS (real domain)

1. Add a DNS A record: `hello.example.com` → VPS public IP.
2. Add the domain in the panel UI.
3. SSL (Let's Encrypt) is on the Phase 2.5 roadmap — for now domains are HTTP only.

### Nginx ports

`panel_nginx` binds **host port 80 + 443**. If you have IIS, Apache, or another nginx on the host already, free those ports first or change the bindings in `docker-compose.dev.yml`.

## App sources (Phase 3)

The panel supports four ways to ship an app:

| Source | What you provide | Best for |
|---|---|---|
| **Prebuilt image** | Docker image tag (e.g. `nginx:latest`) | Off-the-shelf images |
| **Git + Dockerfile** | Repo URL + branch + Dockerfile path | Any custom app with a `Dockerfile` |
| **Git + Static** | Repo URL + branch + publish dir (e.g. `dist`) | Plain HTML / CSS / JS sites — panel auto-generates an nginx Dockerfile |
| **Git + Compose** | Repo URL + branch + compose file path | Multi-container stacks (web + db + cache) |

### Build artifacts location

Cloned repos are stored at `~/.panel-builds/<slug>/` (override with `PANEL_BUILD_DIR` env). For Dockerfile / Static modes the dir is removed after the build. For Compose mode it is kept around so `stop` / `down` can reuse the compose file.

### Compose specifics

- Project name = `panel_<slug>` (so containers become `panel_<slug>-<service>-1`).
- After `compose up`, panel automatically attaches every project container to the `panel_net` Docker network with an alias = service name. This means nginx can route to your services as `http://<service>:<port>`.
- Add domains **per service** in the app detail page — the form will ask for the service name when the app is a compose app.
- Env vars set in the panel are written to `.env.panel` inside the workdir and passed via `--env-file` to compose. They become available in your compose file as `${KEY}`.
- Private images / build args: keep them in the compose file or env vars; the panel does not currently inject docker registry creds.
- **Stop** → `docker compose stop`. **Delete app** → `docker compose down --volumes --remove-orphans` + workdir cleanup.

### Git auth

For private repos, paste a Personal Access Token in the "Git token" field when creating the app. It is stored AES-256-GCM-encrypted at rest. Cloning uses `https://x-access-token:<TOKEN>@host/...` under the hood (works for GitHub PATs; for GitLab tokens, use a deploy token with `read_repository` scope).

## Production deployment

### One-line install (recommended)

On a fresh Linux VPS (Ubuntu 22.04+, Debian 11+, RHEL/Rocky/Alma 9+) as root:

```bash
curl -fsSL https://raw.githubusercontent.com/YOUR_USER/vps-panel/main/install.sh | bash
```

The installer:
- Installs Docker + Compose plugin + git if missing
- Clones the repo to `/opt/vps-panel`
- Generates fresh secrets in `.env` (`chmod 600`)
- Sets a catch-all nginx bootstrap config so the panel is reachable by IP
- Builds the panel image and brings the full stack up
- Installs a `panel` CLI helper to `/usr/local/bin`
- Prints the admin email + initial password (**save it — won't be shown again**)

After install:
1. Open `http://<VPS_IP>` and log in with the printed credentials
2. **Settings → enable 2FA**
3. **Settings → Panel domain** → set your real hostname → click **Issue Let's Encrypt cert**
4. Apps / Projects → start deploying

Day-2 ops are one-word commands:

```bash
panel update      # git pull + rebuild + restart panel container
panel logs        # tail panel logs
panel ps          # list containers
panel health      # GET /api/health
panel exec sh     # shell inside panel_app
panel down        # stop everything (volumes preserved)
panel up          # bring it back
```

### Manual install (if you want full control)

The installer is just a wrapper. Manual steps below if you'd rather see what
each piece does.

#### 1. Provision a VPS

Any Ubuntu / Debian / RHEL host with Docker Engine + Docker Compose v2. Open
ports **80** and **443** for nginx; the panel itself only listens internally.

#### 2. Clone the repo on the VPS

```bash
git clone https://github.com/you/vps-panel.git
cd vps-panel
```

### 3. Create the production env file

```bash
cp .env.production.example .env
# Generate strong secrets:
node -e "console.log('SESSION_SECRET=' + require('crypto').randomBytes(48).toString('base64'))"
node -e "console.log('PANEL_MASTER_KEY=' + require('crypto').randomBytes(32).toString('base64'))"
# Paste the output into .env, set ADMIN_EMAIL/PASSWORD, POSTGRES_PASSWORD, PANEL_ORIGIN.
```

### 4. Build and start

```bash
mkdir -p nginx/conf.d          # bind-mount target; can be empty
docker compose -f docker-compose.prod.yml --env-file .env build
docker compose -f docker-compose.prod.yml --env-file .env up -d
```

The first start runs Prisma `db:push`-equivalent migrations automatically and
seeds the admin user from `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

> **Note:** `nginx/conf.d/` starts empty. The panel writes its own site config
> there as soon as you set the panel domain in step 6.

### 5. Open the panel (initial access)

Before DNS is wired up, the panel is reachable directly through the host on
port 80 — but no `server_name` matches yet, so nginx will 404. Use an
SSH tunnel or temporarily expose the API port:

```bash
ssh -L 4000:127.0.0.1:4000 user@your.vps    # tunnel
# OR add `ports: ["127.0.0.1:4000:4000"]` to the panel service in
# docker-compose.prod.yml for one-time local access.
```

Then open `http://localhost:4000` and log in.

### 6. Point DNS + set the panel domain in the UI

1. Create an A record: `panel.example.com` → your VPS public IP.
2. In the panel: **Settings → Panel domain** → enter `panel.example.com` →
   Apply. The panel writes `nginx/conf.d/panel.example.com.conf` and reloads
   nginx for you.
3. Open `http://panel.example.com` — the panel responds.

### 7. Issue SSL — one click, no shell

In **Settings → Panel domain → Issue Let's Encrypt cert** enter your email,
optionally toggle staging for a dry run, then **Issue cert**. The panel:

- Runs certbot in a one-shot container against the existing nginx volumes
- On success, re-writes `panel.example.com.conf` with the HTTPS server block
- Auto-redirects HTTP → HTTPS
- Reloads nginx

Open `https://panel.example.com` — green lock.

**For per-app domains** (the ones you bind under `App → Domains`), the same
**Issue SSL** button works. Auto-renewal runs daily and covers both the
panel's own cert and every app domain cert in one pass.

The panel's auto-renewal job covers this cert too — it runs `certbot renew`
across the whole volume daily.

### 8. Day-2 operations

| Task | Command |
|---|---|
| Logs | `docker logs -f panel_app` |
| Restart panel | `docker compose -f docker-compose.prod.yml restart panel` |
| Update to a new build | `git pull && docker compose -f docker-compose.prod.yml up -d --build panel` |
| Download a backup | Use the panel UI → Settings → Backups → Download |
| Server-side backup files | `/var/lib/docker/volumes/vpspanel_panel_backups/_data/` |

### Host shell

The panel ships a privileged sidecar container `panel_host` (alpine + bash + the
host's `/` mounted at `/host` + `pid: host`). The **Host shell** entry in the
sidebar opens a web terminal into this container. From there:

- Files on the VPS are at `/host/...`
- For a real host root shell run: `chroot /host /bin/bash`
- The container has the host PID namespace, so `ps -ef` shows host processes

Because this is root-equivalent, the sidecar is **only reachable through the
auth-gated panel API** (cookie session). It is never published to any port.
Still: **enable 2FA before exposing the panel** — a stolen session = host root.

### Security notes

- Mounting `/var/run/docker.sock` into the panel gives it root-equivalent access
  to the host. **Never expose the panel publicly without auth** — enable 2FA
  immediately after the first login (Settings → 2FA).
- `PANEL_MASTER_KEY` encrypts all env-var secrets in the DB. Lose it and you
  cannot recover them. Back it up out-of-band.
- The panel's `panel_nginx` binds port 80/443 on the host. If anything else is
  using those ports (Apache, system nginx, IIS), free them first.

## Roadmap status

- ✅ Phase 1 — Auth + container CRUD + apps + env vars
- ✅ Phase 2 — Nginx domain binding (HTTP)
- ✅ Phase 3 — Git push-to-deploy (Dockerfile + static + compose) + webhooks
- ✅ Phase 4 — Web terminal · rollback · live log streaming · audit log · Monaco file editor
- ✅ Phase 5 — 2FA · system dashboard · daily backups · dockerized deploy · Let's Encrypt UI

See [PRD.md](PRD.md) for the full plan.

## Commands cheat sheet

| Command | What it does |
|---|---|
| `pnpm dev` | API + web in parallel |
| `pnpm dev:services` | Postgres + Redis up |
| `pnpm dev:services:down` | Postgres + Redis down |
| `pnpm db:push` | Sync Prisma schema to DB (no migrations) |
| `pnpm db:migrate` | Create + apply a Prisma migration |
| `pnpm db:generate` | Regenerate Prisma client |
| `pnpm build` | Build both apps for production |
| `pnpm typecheck` | TypeScript check, no emit |
| `docker compose -f docker-compose.prod.yml build` | Build the production image |
| `docker compose -f docker-compose.prod.yml up -d` | Start postgres + redis + nginx + panel |
| `docker compose -f docker-compose.prod.yml logs -f panel` | Tail the panel logs |
