# Production deployment guide

`SETUP.md` at the repo root covers **local development** (Windows, native
PostgreSQL, no Docker — matching how this project was built). This document
covers taking the same codebase to a real production server. It assumes a
single Linux VPS (Ubuntu 22.04/24.04 LTS) running everything — Postgres,
the API, and the frontend — which is the simplest and cheapest setup for a
pilot/early-customer deployment. Notes on scaling past that are at the
bottom.

Nothing here is Pakistan-specific, but it's written with that context in
mind: budget hosting (a $10–20/mo VPS from DigitalOcean/Vultr/Linode, or a
local provider), a single region, and no dependency on a managed database
service (Postgres runs on the same box, same as local dev).

## 0. Architecture recap

- **backend/** — Express + TypeScript, compiled to plain Node.js
  (`npm run build` → `dist/`), talks to Postgres via Prisma. Stateless
  except for the DB — safe to run multiple instances behind a load
  balancer later if needed.
- **frontend/** — Next.js (App Router), needs a Node.js process to run
  `next start` (this app uses server-side proxy/middleware and dynamic
  routes, so a fully static export is not an option).
- **PostgreSQL** — the only stateful piece. Everything else can be
  rebuilt from git + `npm install` + `npm run build`.

## 1. Provision the server

- Ubuntu 22.04 or 24.04 LTS, 2 vCPU / 4GB RAM is comfortable for a
  single-school-to-a-few-dozen-schools pilot.
- Create a non-root sudo user; disable root SSH login and password auth
  (key-based only). This is standard VPS hardening, not specific to this
  app, so it isn't repeated in `docs/SECURITY.md`.
- Open only ports 22 (SSH), 80, and 443 in the firewall (`ufw allow OpenSSH`,
  `ufw allow 80`, `ufw allow 443`, `ufw enable`). Postgres (5432), the API
  (4000), and the frontend (3000) should NOT be exposed to the internet —
  only nginx on 80/443 is public; it reverse-proxies to the app ports on
  localhost.

Install prerequisites:

```bash
# Node.js 22 LTS
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# PostgreSQL 16
sudo apt-get install -y postgresql-16

# nginx + certbot (reverse proxy + free TLS certs)
sudo apt-get install -y nginx certbot python3-certbot-nginx

# Chromium, for the exams module's report-card PDF export (puppeteer-core
# drives an external browser rather than bundling one — see backend's
# CHROMIUM_EXECUTABLE_PATH env var)
sudo apt-get install -y chromium-browser

# pm2, to keep both Node processes running and restart them on crash/reboot
sudo npm install -g pm2
```

## 2. Database setup

Same role/permission model as local dev (see `SETUP.md` §2), with
production-strength passwords — generate them, don't reuse anything from
`.env.example` or your dev machine:

```bash
sudo -u postgres psql
```

```sql
CREATE ROLE school_saas_owner LOGIN PASSWORD '<generate-a-strong-password>' BYPASSRLS CREATEDB;
CREATE ROLE school_saas_app LOGIN PASSWORD '<generate-a-different-strong-password>';

CREATE DATABASE school_saas OWNER school_saas_owner;
GRANT ALL PRIVILEGES ON DATABASE school_saas TO school_saas_owner;
GRANT CONNECT ON DATABASE school_saas TO school_saas_app;
\c school_saas
GRANT USAGE ON SCHEMA public TO school_saas_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO school_saas_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO school_saas_app;
```

Generate strong passwords with, e.g.:
```bash
node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"
```

By default Postgres only listens on localhost, which is what you want here
(the app connects over localhost, nothing external ever reaches Postgres
directly) — no `postgresql.conf`/`pg_hba.conf` changes needed for this
single-box layout.

## 3. Get the code onto the server and configure it

```bash
git clone <your-repo-url> /opt/school-saas
cd /opt/school-saas

cd backend
cp .env.example .env
```

Edit `backend/.env` for production:

| Variable | Production value |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | `4000` (or leave default — nginx proxies to it) |
| `APP_URL` | `https://api.yourschoolsaas.com` (your actual API domain) |
| `DATABASE_URL` | `postgresql://school_saas_app:<app-password>@localhost:5432/school_saas?schema=public` |
| `DATABASE_MIGRATE_URL` | `postgresql://school_saas_owner:<owner-password>@localhost:5432/school_saas?schema=public` |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Two independent 48+ byte random strings — `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`. **Different from any value ever used in dev.** |
| `BCRYPT_SALT_ROUNDS` | `12` (default is fine) |
| `CORS_ORIGIN` | `https://app.yourschoolsaas.com` (your actual frontend domain — exact match, no wildcard, no trailing slash) |
| `CORS_WILDCARD_DOMAIN` | `yourschoolsaas.com` — only needed if subdomain-per-school (below) is turned on; leave unset otherwise |
| `COOKIE_DOMAIN` | `yourschoolsaas.com` — only needed if subdomain-per-school is turned on; leave unset otherwise |
| `CHROMIUM_EXECUTABLE_PATH` | `/usr/bin/chromium-browser` (from step 1) |
| `STORAGE_DIR` | `/var/lib/school-saas/storage` (or any persistent path outside the app's deploy directory) — holds generated bulk report-card zip files AND uploaded student/staff photos (`STORAGE_DIR/uploads/<tenantId>/...`, served publicly at `/uploads/...` — see `src/modules/uploads/uploads.ts`); make sure it's included in your backup routine and NOT wiped on redeploy. Uploaded images grow this directory over time (5MB cap per file) — monitor disk usage the same way you would for the report-card zips. |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_SMS_FROM` | Optional — leave all three unset to keep SMS simulated (logged, not delivered). Set all three (from your Twilio console) to go live. |
| `WHATSAPP_CLOUD_API_TOKEN` / `WHATSAPP_CLOUD_PHONE_NUMBER_ID` | Optional — leave both unset to keep WhatsApp simulated. Set both (from Meta's WhatsApp Business Cloud API console) to go live. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | Optional — leave unset to keep Email simulated. Set all five (any SMTP provider — SendGrid, Mailgun, Amazon SES, or a Google Workspace/Microsoft 365 account) to go live. |

Each of the three notification channels above goes live independently — you can wire up SMS now and leave WhatsApp/Email for later. `GET /api/notifications/channel-status` (surfaced as a warning banner on the dashboard's Notifications page) always shows which channels are actually live vs. still simulated, so there's no need to guess after deploying.

```bash
cd ../frontend
cp .env.local.example .env.local
```

Edit `frontend/.env.local`:

| Variable | Production value |
|---|---|
| `NEXT_PUBLIC_API_URL` | `https://api.yourschoolsaas.com` |
| `NEXT_PUBLIC_APP_DOMAIN` | `yourschoolsaas.com` — only needed if subdomain-per-school is turned on; leave unset otherwise |

`NEXT_PUBLIC_*` variables are baked into the frontend's client-side
JavaScript bundle at **build time** — if you ever change this value you
must rebuild the frontend (`npm run build`), not just restart it.

### Subdomain-per-school (optional)

Each school can get its own login URL — `<slug>.yourschoolsaas.com` —
instead of typing a school ID into a shared login form. This needs three
things beyond the base setup above, all covered in this document:

1. The four env vars in the tables above (`CORS_WILDCARD_DOMAIN`,
   `COOKIE_DOMAIN`, `NEXT_PUBLIC_APP_DOMAIN`) set to your bare production
   domain.
2. Wildcard DNS pointed at this server — see step 7 below.
3. A wildcard TLS certificate (a normal single-domain certbot run does
   **not** cover `*.yourschoolsaas.com`) — also step 7.

If you don't need this yet, leave all three `_DOMAIN` env vars unset —
everything else in this guide works identically, schools just use the
existing manual school-ID field on the shared login page instead of a
personalized URL.

## 4. Install, build, migrate

```bash
cd /opt/school-saas/backend
npm ci --omit=dev=false   # dev deps needed for the build step itself
npm run build             # tsc -> dist/

# Migrations run as the owner role — DATABASE_URL in .env is already the
# app role, so point at the owner URL just for this command:
DATABASE_URL="$(grep DATABASE_MIGRATE_URL .env | cut -d= -f2- | tr -d '"')" npx prisma migrate deploy

cd ../frontend
npm ci
npm run build              # next build -> .next/
```

`prisma migrate deploy` (not `migrate dev`) is the correct command for
production: it applies pending migrations without prompting for
confirmation and without generating new ones — exactly the same command
this project's own tests and CI-style verification used throughout
development (see `backend/package.json`'s `prisma:deploy` script).

## 5. Bootstrap the first platform admin

There's no self-service signup for platform administrators (`SUPER_ADMIN`
— the role that manages tenants and billing plans in
`/dashboard/platform/*`), by design. Create the first one directly:

```bash
cd /opt/school-saas/backend
SUPER_ADMIN_EMAIL="you@yourcompany.com" \
SUPER_ADMIN_PASSWORD="<a-strong-password>" \
SUPER_ADMIN_NAME="Your Name" \
npm run create-super-admin
```

Log in at the frontend's `/platform-login` page (a separate screen from
the regular school `/login` — platform admins have no tenant/school slug,
so they can't use the tenant login form) or directly against
`POST /api/auth/platform-login`. `/platform-login` is linked in small
print at the bottom of the regular `/login` page. This only needs to be
run once per environment; running it again with the same email safely
refuses with "already exists" rather than creating a duplicate.

## 6. Process management (pm2)

Run both apps under pm2 so they restart on crash and on server reboot:

```bash
cd /opt/school-saas
pm2 start backend/dist/server.js --name school-saas-api
pm2 start "npm run start" --name school-saas-web --cwd frontend
pm2 save
pm2 startup   # prints a systemd command to run once, so pm2 itself survives reboots
```

Useful commands: `pm2 logs`, `pm2 restart school-saas-api`, `pm2 status`.

## 7. nginx reverse proxy + TLS

Two server blocks — one per domain/subdomain. Example for
`app.yourschoolsaas.com` (frontend, port 3000) and
`api.yourschoolsaas.com` (backend, port 4000):

```nginx
# /etc/nginx/sites-available/school-saas
server {
    listen 80;
    server_name app.yourschoolsaas.com;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}

server {
    listen 80;
    server_name api.yourschoolsaas.com;
    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/school-saas /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx

# TLS — certbot edits the config above in place to add the 443 blocks
sudo certbot --nginx -d app.yourschoolsaas.com -d api.yourschoolsaas.com
```

The backend's `app.set('trust proxy', 1)` (already in `src/app.ts`) is what
makes `req.ip` and the `secure` cookie flag behave correctly behind this
proxy — no further change needed there.

Two-domain (subdomain-per-service) is simplest and is what's documented
above. If you'd rather serve both under one domain
(`yourschoolsaas.com` for the frontend, `yourschoolsaas.com/api/` proxied
to the backend), that also works — just set `CORS_ORIGIN` and
`NEXT_PUBLIC_API_URL` to match whatever you actually choose, and note the
backend's routes are already mounted under `/api/...` so a path-based
split needs no backend changes, only the nginx `location` block and the
frontend's `NEXT_PUBLIC_API_URL`.

### Subdomain-per-school: DNS, wildcard TLS, and nginx

Skip this subsection entirely if you left the `_DOMAIN` env vars unset
above. If you turned subdomain-per-school on, each school's login lives at
`<slug>.yourschoolsaas.com`, which needs a **wildcard** DNS record, a
**wildcard** TLS certificate, and an nginx `server_name` that matches it —
none of which the two-domain config above provides on its own.

**1. Wildcard DNS.** In your DNS provider, add (alongside the existing
`app` and `api` records):

```
*.yourschoolsaas.com.   A   <server-ip>
```

**2. Wildcard TLS certificate.** A wildcard cert can only be issued via
DNS-01 challenge (proving you control the domain by creating a TXT
record) — the HTTP-01 challenge `certbot --nginx` uses above does not
support wildcards at all. This means you need a certbot DNS plugin for
your specific DNS provider (Cloudflare, Route53, DigitalOcean, etc.):

```bash
# Example: Cloudflare. Swap the plugin/package for your actual DNS provider.
sudo apt-get install -y python3-certbot-dns-cloudflare

# API token needs Zone:DNS:Edit permission on this zone only.
sudo mkdir -p /etc/letsencrypt
echo "dns_cloudflare_api_token = <your-token>" | sudo tee /etc/letsencrypt/cloudflare.ini
sudo chmod 600 /etc/letsencrypt/cloudflare.ini

sudo certbot certonly \
  --dns-cloudflare \
  --dns-cloudflare-credentials /etc/letsencrypt/cloudflare.ini \
  -d yourschoolsaas.com -d '*.yourschoolsaas.com'
```

This issues one certificate covering both the bare domain and every
subdomain, at `/etc/letsencrypt/live/yourschoolsaas.com/`. Certbot's
systemd timer renews it automatically the same as the HTTP-01 certs from
step 7 above — `sudo certbot renew --dry-run` still verifies renewal for
both.

**3. nginx `server_name` wildcard.** Add a third server block (alongside
`app.` and `api.` above) that matches every school subdomain and proxies
to the same frontend process as `app.yourschoolsaas.com`:

```nginx
server {
    listen 443 ssl;
    server_name *.yourschoolsaas.com;

    ssl_certificate     /etc/letsencrypt/live/yourschoolsaas.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/yourschoolsaas.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}

server {
    listen 80;
    server_name *.yourschoolsaas.com;
    return 301 https://$host$request_uri;
}
```

`server_name *.yourschoolsaas.com` matches any single-label subdomain
(`alpha-school.yourschoolsaas.com`) but not the bare domain or
multi-level subdomains — that's intentional, it mirrors what
`extractTenantSlugFromHost()` (`frontend/src/lib/subdomain.ts`) accepts.
Reuse the same cert for the `app.yourschoolsaas.com` server block above
(or reissue that one from the wildcard cert too) so you're not managing
two separate certificates for the same underlying frontend process.

Verify with `sudo nginx -t && sudo systemctl reload nginx`, then confirm
an actual school subdomain resolves and shows the "Signing in to
&lt;School&gt;" banner before relying on this in front of real users — the
same headless-browser check this feature was built and verified with
(`GET https://<a-real-tenant-slug>.yourschoolsaas.com/login`).

## 8. Logging and monitoring

- The backend logs structured JSON in production (`winston`, see
  `src/lib/logger.ts`) to stdout — pm2 captures this
  (`~/.pm2/logs/school-saas-api-out.log`). Point a log shipper (Vector,
  Filebeat, or even a simple `pm2-logrotate` + periodic `scp`) at that file
  if you want centralized logs later; nothing in the app needs to change.
- `GET /health` returns `{"status":"ok","timestamp":...}` — point any
  uptime monitor (UptimeRobot, a cron `curl` + alert, etc.) at
  `https://api.yourschoolsaas.com/health`.
- `morgan` access logs (also routed through winston) log every request in
  production with the `combined` format (includes response time, status,
  IP).

## 9. Backups

Postgres is the only state. A daily `pg_dump`, kept off-box, is the
minimum viable backup strategy:

```bash
# /etc/cron.daily/school-saas-backup (make executable: chmod +x)
#!/bin/bash
set -euo pipefail
BACKUP_DIR=/var/backups/school-saas
mkdir -p "$BACKUP_DIR"
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
PGPASSWORD='<owner-password>' pg_dump -h localhost -U school_saas_owner -Fc school_saas \
  > "$BACKUP_DIR/school_saas-$TIMESTAMP.dump"
# Keep 14 days locally; ship elsewhere (S3/Backblaze/etc) for real durability.
find "$BACKUP_DIR" -name '*.dump' -mtime +14 -delete
```

Restore with `pg_restore -h localhost -U school_saas_owner -d school_saas --clean <file>.dump`.
Test the restore path at least once before you need it for real.

## 10. Deploying updates

```bash
cd /opt/school-saas
git pull

cd backend
npm ci
npm run build
DATABASE_URL="$(grep DATABASE_MIGRATE_URL .env | cut -d= -f2- | tr -d '"')" npx prisma migrate deploy
pm2 restart school-saas-api

cd ../frontend
npm ci
npm run build
pm2 restart school-saas-web
```

This is a brief-downtime deploy (a few seconds per service while pm2
restarts). Fine for a pilot; a zero-downtime rolling deploy would need
multiple app instances behind nginx and is not set up here — flag it if
traffic/uptime requirements grow past what a single instance handles.

## 11. Scaling notes (not needed for a pilot, kept brief)

- The backend is stateless (JWT auth, no in-memory session state) — you
  can run multiple `pm2` instances (`pm2 start dist/server.js -i 2`) or
  multiple boxes behind a load balancer without any code changes.
- Postgres itself would become the bottleneck first. A managed Postgres
  service (RDS, DigitalOcean Managed DB, etc.) with connection pooling
  (PgBouncer) is the standard next step — Prisma's connection pool size is
  controlled via the `DATABASE_URL`'s `connection_limit` parameter if
  tuning is ever needed.
- The frontend (`next start`) is also stateless and horizontally scalable
  the same way.

## 12. Security checklist

See `docs/SECURITY.md` for the full review. Before going live, confirm at
minimum:

- [ ] `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` are unique to this
      environment (never copied from dev/.env.example) and 32+ characters.
- [ ] `NODE_ENV=production` is actually set (controls cookie `Secure` flag,
      error detail suppression, and log format).
- [ ] `CORS_ORIGIN` is the exact production frontend origin, not `*` and
      not a dev URL.
- [ ] Postgres is not reachable from outside localhost (default — verify
      `pg_hba.conf`/firewall weren't changed from the defaults above).
- [ ] TLS is active on both domains (certbot handles renewal automatically
      via a systemd timer — `sudo certbot renew --dry-run` to verify).
- [ ] Backups are actually running (`ls /var/backups/school-saas`) and the
      restore path has been tested at least once.
- [ ] If subdomain-per-school is on: `CORS_WILDCARD_DOMAIN`,
      `COOKIE_DOMAIN`, and `NEXT_PUBLIC_APP_DOMAIN` are all the same bare
      production domain (not a dev value, not mismatched with each
      other), and the wildcard TLS cert actually covers
      `*.yourschoolsaas.com` (`echo | openssl s_client -connect
      alpha-school.yourschoolsaas.com:443 -servername
      alpha-school.yourschoolsaas.com 2>/dev/null | openssl x509 -noout
      -text | grep DNS` should list the wildcard).
