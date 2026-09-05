# Run Commands — Complete, Copy-Paste Setup Guide

This project is delivered with working `.env` files already inside the
zip (`backend/.env`, `backend/.env.test`, `frontend/.env.local`), so the
database setup commands below use the **exact same passwords** those files
already expect. If you run every command below in order, exactly as
written, the project will start with no further edits needed.

If something still fails, the "Troubleshooting" section at the bottom
covers the two gotchas that came up most often while building this — read
that before asking for help, it will likely already have your answer.

---

## 0. Prerequisites

- **Node.js 20 or 22 (LTS)** — https://nodejs.org
- **PostgreSQL 16** — https://www.postgresql.org/download/
  During install, set a password for the `postgres` superuser and remember
  it — you'll use it once, in step 1.
- **Google Chrome or Chromium** installed somewhere on your machine (only
  needed for the "Print PDF" features — admission form, attendance report,
  transfer certificate, report cards).

Check versions:

```bash
node -v
npm -v
psql --version
```

---

## 1. Create the database roles and databases

Open a terminal and connect to Postgres as the `postgres` superuser:

```bash
psql -U postgres -h localhost
```

(On Windows, use "SQL Shell (psql)" from the Start Menu instead — it asks
for host/port/database/username/password one at a time; just press Enter
to accept the defaults until it asks for the password, which is the one
you set during install.)

Once connected, run this whole block (copy-paste all of it at once):

```sql
CREATE ROLE school_saas_owner LOGIN PASSWORD 'owner_password_change_me' BYPASSRLS CREATEDB;
CREATE ROLE school_saas_app LOGIN PASSWORD 'app_password_change_me';

CREATE DATABASE school_saas OWNER school_saas_owner;
CREATE DATABASE school_saas_test OWNER school_saas_owner;

GRANT ALL PRIVILEGES ON DATABASE school_saas TO school_saas_owner;
GRANT CONNECT ON DATABASE school_saas TO school_saas_app;
GRANT ALL PRIVILEGES ON DATABASE school_saas_test TO school_saas_owner;
GRANT CONNECT ON DATABASE school_saas_test TO school_saas_app;
```

Now connect to each database individually and grant the app role table
access. This has to name `school_saas_owner` explicitly with `FOR ROLE`
— migrations run as the owner role (step 2 below), so it's the owner
role's *future* tables the app role needs default access to, not
whichever role happens to be running this psql session (`postgres`).
Leaving out `FOR ROLE school_saas_owner` is the single most common
mistake made setting this up — it silently grants defaults for tables
`postgres` creates instead, which is never, and login/signup then fails
with "permission denied for table tenants" the first time you use the
app, even though every step up to here looked like it worked:

```sql
\c school_saas
GRANT USAGE ON SCHEMA public TO school_saas_app;
ALTER DEFAULT PRIVILEGES FOR ROLE school_saas_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO school_saas_app;
ALTER DEFAULT PRIVILEGES FOR ROLE school_saas_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO school_saas_app;

\c school_saas_test
GRANT USAGE ON SCHEMA public TO school_saas_app;
ALTER DEFAULT PRIVILEGES FOR ROLE school_saas_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO school_saas_app;
ALTER DEFAULT PRIVILEGES FOR ROLE school_saas_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO school_saas_app;

\q
```

These are *default* privileges — they only take effect on tables created
**after** this point (by the migration in step 2). If you ever run
`prisma migrate deploy` before running this block, or the app still hits
"permission denied for table ..." after logging in, the tables already
exist and need a direct grant instead — see "permission denied for
table ..." under Troubleshooting below for the one-time fix.

> Using different passwords for security? That's fine — just update
> `DATABASE_URL` and `DATABASE_MIGRATE_URL` in `backend/.env` **and**
> `backend/.env.test` to match before continuing. Everything below assumes
> you kept the defaults shown above.

---

## 2. Backend — install and migrate

```bash
cd backend
npm install
```

Migrations must run as the **owner** role, not the app role (the app role
deliberately can't alter schema — that's what keeps a compromised API
server from being able to modify its own table structure). Run this exact
command — it points `DATABASE_URL` at the owner role for just this one
command, without touching your `.env` file:

**Mac/Linux/WSL:**
```bash
DATABASE_URL="postgresql://school_saas_owner:owner_password_change_me@localhost:5432/school_saas?schema=public" npx prisma migrate deploy
```

**Windows (PowerShell):**
```powershell
$env:DATABASE_URL="postgresql://school_saas_owner:owner_password_change_me@localhost:5432/school_saas?schema=public"
npx prisma migrate deploy
$env:DATABASE_URL=$null
```

Then do the exact same thing again, against the **test** database (needed
only if you plan to run `npm test`; skip if you just want the app
running):

**Mac/Linux/WSL:**
```bash
DATABASE_URL="postgresql://school_saas_owner:owner_password_change_me@localhost:5432/school_saas_test?schema=public" npx prisma migrate deploy
```

**Windows (PowerShell):**
```powershell
$env:DATABASE_URL="postgresql://school_saas_owner:owner_password_change_me@localhost:5432/school_saas_test?schema=public"
npx prisma migrate deploy
$env:DATABASE_URL=$null
```

Generate the Prisma client (usually happens automatically after
`npm install`, but run it explicitly to be sure):

```bash
npx prisma generate
```

### (Optional) Set the Chrome path for PDF exports

Open `backend/.env` and set `CHROMIUM_EXECUTABLE_PATH` to your installed
Chrome/Chromium's full path, e.g.:

- Windows: `C:\Program Files\Google\Chrome\Application\chrome.exe`
- Mac: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
- Linux: `/usr/bin/google-chrome` or `/usr/bin/chromium`

Everything else in the app works fine without this — only the "Print"
buttons (admission form, attendance PDF, transfer certificate, report
cards) need it.

### Start the backend

```bash
npm run dev
```

Leave this running. The API is now live at `http://localhost:4000` —
check it in a browser at `http://localhost:4000/health`, you should see
`{"status":"ok"}`.

---

## 3. Frontend — install and run

Open a **second** terminal (leave the backend running in the first one):

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:3000` in your browser. You should see the login
page.

`frontend/.env.local` already points at `http://localhost:4000` (the
backend's default port) — no edits needed unless you changed the
backend's `PORT`.

---

## 4. First login — register your school

The app has no pre-seeded school. On `http://localhost:3000`, click
**"Register your school"** and fill in your school's name, a URL slug
(e.g. `my-school`), and your own admin name/email/password. This creates
your school and your SCHOOL_ADMIN login in one step — after that you're
in the dashboard and can start adding students, staff, classes, etc.

---

## 5. Running the automated tests (optional, for verification only)

**Backend** (needs the `school_saas_test` database from step 1, and its
migrations from step 2):

```bash
cd backend
npm test
```

Expect `499 passed, 499 total`. This takes 3–5 minutes — it runs the
entire suite against a real Postgres database, in-band (one test at a
time), which is slower than a typical mocked test suite but far more
trustworthy: every test hits real HTTP endpoints and a real database.

**Frontend:**

```bash
cd frontend
npx vitest run       # unit/component tests
npx tsc --noEmit      # or: npm run typecheck
npx eslint .          # or: npm run lint
npm run build         # production build check
```

All four should finish with no errors.

---

## Getting a code update after your first setup

Whenever you receive updated backend files for a feature that changed the
database (new fields, new tables), re-apply migrations before starting the
backend again — otherwise it'll error on columns that don't exist yet in
your database. Same command as step 2, run again from `backend/`:

```powershell
$env:DATABASE_URL="postgresql://school_saas_owner:owner_password_change_me@localhost:5432/school_saas?schema=public"
npx prisma migrate deploy
$env:DATABASE_URL=$null
npx prisma generate
```

Then start the backend as usual. If you also run the test suite locally,
repeat the same two commands against `school_saas_test` (see step 2's
second `migrate deploy` block) before `npm test`.

## Troubleshooting

These are the two issues that actually came up while building this
project — check here first before treating anything as a bug.

### The backend refuses to start with "🚨 REFUSING TO START — tenant data isolation is not enforced"

This is the backend deliberately protecting you from the worst possible
bug in a multi-school system: one school's admin panel silently showing
another school's students/staff/everything else, mixed together, with
nothing in the response to hint anything is wrong. It happens when
`DATABASE_URL` ends up pointing at `school_saas_owner` (the migration
role, which intentionally bypasses Postgres's Row-Level Security) instead
of `school_saas_app` (the normal, tenant-isolated role the running server
must always use).

The usual cause: you ran one of the `$env:DATABASE_URL="...school_saas_owner..."`
commands from this guide (e.g. to apply a migration) and then ran
`npm run dev` in that **same PowerShell window** afterward — PowerShell
keeps that override for the rest of the session, and it silently wins over
whatever `.env` says. The server used to start anyway in that state; now
it refuses to, and tells you why in the log line.

Fix: close that terminal, open a **fresh** one, `cd` into `backend`, and
run `npm run dev` there (don't set `$env:DATABASE_URL` in it). If you
want to double check first: `echo $env:DATABASE_URL` in the terminal you
were about to use — if it prints anything with `school_saas_owner` in it,
that confirms it; a fresh terminal has nothing set there and falls back to
`.env`'s `school_saas_app` URL correctly.

If you ever saw a school's admin panel actually showing another school's
data before updating to this version, that terminal-leftover is almost
certainly why — it wasn't a real bug in the tenant-isolation logic itself
(which is covered by dozens of automated tests, all still passing), just
the server running with the safety mechanism switched off by accident.
Nothing needs cleaning up in the database itself once you restart
correctly — this was a serving-side leak, not stored incorrectly.

### "P3014" or a migration error mentioning permission / cannot create database

This means `prisma migrate deploy` (or `migrate dev`) was run with
`DATABASE_URL` still pointing at the **app** role (`school_saas_app`),
not the **owner** role. The app role intentionally cannot create/alter
schema. Re-run the migrate command from step 2 above, making sure
`DATABASE_URL` in that one command points at `school_saas_owner`, not
`school_saas_app`. (Your saved `.env` file stays pointed at the app role
for normal running — this override is only for that one command, and only
needs the `$env:DATABASE_URL=$null` / a fresh terminal afterward so it
doesn't leak into later commands.)

### The app starts fine, but login/signup fails with "permission denied for table ..."

The tables exist (migrations ran), but the `school_saas_app` role never
got access to them — almost always because step 1's `ALTER DEFAULT
PRIVILEGES` was run without `FOR ROLE school_saas_owner`, so it granted
defaults for tables `postgres` creates instead of tables
`school_saas_owner` creates (which is what migrations actually run as).
Default privileges also never apply retroactively to tables that already
exist — so even the corrected command won't fix already-created tables by
itself. Fix both parts, per affected database (`school_saas`, and
`school_saas_test` if you use it):

```sql
psql -U postgres -h localhost
```
```sql
\c school_saas
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO school_saas_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO school_saas_app;
ALTER DEFAULT PRIVILEGES FOR ROLE school_saas_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO school_saas_app;
ALTER DEFAULT PRIVILEGES FOR ROLE school_saas_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO school_saas_app;

\c school_saas_test
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO school_saas_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO school_saas_app;
ALTER DEFAULT PRIVILEGES FOR ROLE school_saas_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO school_saas_app;
ALTER DEFAULT PRIVILEGES FOR ROLE school_saas_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO school_saas_app;

\q
```

The first `GRANT ... ON ALL TABLES` in each database fixes access
immediately, no backend restart needed — just retry the request that
failed. The `ALTER DEFAULT PRIVILEGES FOR ROLE ...` lines prevent the
same error from coming back the next time a migration adds a table.

### `prisma migrate deploy` errors about `datasource property "url"` no longer being supported, or installs `prisma@7.x`

This means `npx prisma` couldn't find this project's own pinned Prisma
version (6.19.3, in `backend/package.json`) and downloaded the latest
major version instead, which changed how the CLI reads connection URLs
and isn't compatible with this project's `schema.prisma`. This only
happens if `npm install` hasn't been run in `backend/` yet — run it
first, then re-run the `prisma migrate deploy` command; `npx` will pick
up the local pinned version automatically. If it still happens after
`npm install`, force the pinned version explicitly:
`npx prisma@6.19.3 migrate deploy` (with the same `DATABASE_URL`
override as step 2).

### `npm run dev` fails with "@prisma/client did not initialize yet"

`npm install`'s automatic `prisma generate` step was blocked by npm's
install-script allowlist (shows as an `npm warn install-scripts ...`
during `npm install`, easy to miss). Run it manually — this always works
regardless of that allowlist:

```bash
npx prisma generate
```

### `npm test` fails with `column "..." does not exist`, or seems to hang

This is not a hang — it's the migrations having been applied to the
**dev** database (`school_saas`) but not the **test** database
(`school_saas_test`), or vice versa. Each database is completely
independent and needs migrations applied to it separately. Re-run the
"against the test database" migrate command from step 2. If the test
output is scrolling by too fast to read, run a single file instead to see
the real error clearly:

```bash
npx jest tests/integration/auth.test.ts --verbose
```

### Starting over — wipe the databases and redo setup from scratch

If step 1 partially ran before (e.g. "role already exists" errors), or
you just want a totally clean slate, connect as `postgres` (`psql -U
postgres -h localhost`) and run this whole block. **This permanently
deletes all data** in `school_saas` and `school_saas_test` — that's the
point, but make sure that's really what you want first.

```sql
-- Kick out any open connections so DROP DATABASE doesn't fail
SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname IN ('school_saas', 'school_saas_test');

-- Drop everything
DROP DATABASE IF EXISTS school_saas;
DROP DATABASE IF EXISTS school_saas_test;
-- If a DROP ROLE below errors with "cannot be dropped because some
-- objects depend on it" (privileges left over on the "postgres"
-- maintenance database itself from an earlier run), run this first for
-- whichever role it names, then repeat the DROP ROLE:
--   DROP OWNED BY school_saas_app;
--   DROP OWNED BY school_saas_owner;
DROP ROLE IF EXISTS school_saas_app;
DROP ROLE IF EXISTS school_saas_owner;

-- Recreate roles
CREATE ROLE school_saas_owner LOGIN PASSWORD 'owner_password_change_me' BYPASSRLS CREATEDB;
CREATE ROLE school_saas_app LOGIN PASSWORD 'app_password_change_me';

-- Recreate databases
CREATE DATABASE school_saas OWNER school_saas_owner;
CREATE DATABASE school_saas_test OWNER school_saas_owner;
GRANT ALL PRIVILEGES ON DATABASE school_saas TO school_saas_owner;
GRANT CONNECT ON DATABASE school_saas TO school_saas_app;
GRANT ALL PRIVILEGES ON DATABASE school_saas_test TO school_saas_owner;
GRANT CONNECT ON DATABASE school_saas_test TO school_saas_app;

-- Grant table/sequence privileges in each database — FOR ROLE
-- school_saas_owner matters here, see step 1's note above.
\c school_saas
GRANT USAGE ON SCHEMA public TO school_saas_app;
ALTER DEFAULT PRIVILEGES FOR ROLE school_saas_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO school_saas_app;
ALTER DEFAULT PRIVILEGES FOR ROLE school_saas_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO school_saas_app;

\c school_saas_test
GRANT USAGE ON SCHEMA public TO school_saas_app;
ALTER DEFAULT PRIVILEGES FOR ROLE school_saas_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO school_saas_app;
ALTER DEFAULT PRIVILEGES FOR ROLE school_saas_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO school_saas_app;

\q
```

Then redo step 2's two `prisma migrate deploy` commands (dev DB, then
test DB) — the tables won't exist until you do.

### Windows: "password authentication failed for user postgres"

The installer-set superuser password isn't being accepted (easy to
mistype during install, or forget later). Simplest fix for a **local dev
machine only** — do NOT do this on a server exposed to the internet:

1. Find `pg_hba.conf` — usually
   `C:\Program Files\PostgreSQL\<version>\data\pg_hba.conf`.
2. Open it as Administrator (Notepad run "as administrator" works) and
   change the `METHOD` column from `scram-sha-256` (or `md5`) to `trust`
   for the `127.0.0.1/32` and `::1/128` lines.
3. Restart the PostgreSQL service from the **Services** app (search
   "Services" in the Start Menu, find "postgresql-x64-...", right-click →
   Restart) — `Restart-Service` from a non-admin PowerShell will fail with
   a permissions error, so use the Services app's GUI instead, or run
   PowerShell itself "as administrator" first.
4. `psql -U postgres -h localhost` now connects without asking for a
   working password. You can change it back to `scram-sha-256` afterward
   once you know your actual password (`ALTER USER postgres PASSWORD
   'newpassword';` while connected).

### "Postgres is not running" / connection refused

Start the Postgres service:

- **Windows**: it should already be running as a service after install
  (check Services app for "postgresql-x64-16"); if not, start it there.
- **Mac** (Homebrew): `brew services start postgresql@16`
- **Linux**: `sudo service postgresql start`

### Port already in use (3000 or 4000)

Something else on your machine is already using that port. Either stop
that other program, or change the port: for the backend, edit `PORT` in
`backend/.env` (and update `NEXT_PUBLIC_API_URL` in
`frontend/.env.local` to match); for the frontend, run
`npm run dev -- -p 3001` instead.

### Emails (portal login credentials, password resets) aren't actually sending

This is expected out of the box. `backend/.env`'s `SMTP_*` variables are
blank, so the app falls back to just logging the email to the backend's
terminal instead of sending it for real — you'll still see the
credentials there (or on-screen in a copyable box, for guardian/staff
logins created via the dashboard). To send real emails, fill in
`SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` in
`backend/.env` with your email provider's SMTP details (Gmail, Outlook,
SendGrid, etc. all work) and restart the backend.
