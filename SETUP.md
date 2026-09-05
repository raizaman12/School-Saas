# Running this locally (no Docker)

These steps match your stated preference: native PostgreSQL install, no
Docker. Written for Windows, with Linux/Mac equivalents noted.

> Deploying this to a real server instead? See `docs/DEPLOYMENT.md` for a
> production setup guide, and `docs/SECURITY.md` for the pre-launch
> security checklist.

## 1. Install prerequisites

- **Node.js 22 LTS** — https://nodejs.org
- **PostgreSQL 16** (native Windows installer) — https://www.postgresql.org/download/windows/
  During install, set a password for the `postgres` superuser and remember it.

## 2. Create the database and roles

Open **SQL Shell (psql)** (installed with PostgreSQL) or `pgAdmin`'s Query
Tool, connect as `postgres`, and run:

```sql
CREATE ROLE school_saas_owner LOGIN PASSWORD 'pick-a-strong-password' BYPASSRLS CREATEDB;
CREATE ROLE school_saas_app LOGIN PASSWORD 'pick-a-different-strong-password';

CREATE DATABASE school_saas OWNER school_saas_owner;
GRANT ALL PRIVILEGES ON DATABASE school_saas TO school_saas_owner;
GRANT CONNECT ON DATABASE school_saas TO school_saas_app;
```

Then connect to the **school_saas** database specifically (`\c school_saas`
in psql) and run:

```sql
GRANT USAGE ON SCHEMA public TO school_saas_app;
ALTER DEFAULT PRIVILEGES FOR ROLE school_saas_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO school_saas_app;
ALTER DEFAULT PRIVILEGES FOR ROLE school_saas_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO school_saas_app;
```

> `FOR ROLE school_saas_owner` matters — migrations run as the owner
> role (step 4 below creates every table as `school_saas_owner`), so
> default privileges must be declared *for that role's* future objects.
> Leaving it out silently sets defaults for tables `postgres` creates
> instead (since that's whichever role is running this psql session),
> which is never — and the app then fails at first login/signup with
> "permission denied for table ...", even though every step up to this
> point looked successful. See `RUN_COMMANDS.md`'s Troubleshooting
> section if you hit that.

(Optional, for running the test suite) repeat the same for a second
database named `school_saas_test`.

## 3. Configure the backend

```
cd backend
copy .env.example .env      (Windows)   |   cp .env.example .env   (Mac/Linux)
```

Edit `.env`:
- `DATABASE_URL` → use the `school_saas_app` role + password you picked.
- `DATABASE_MIGRATE_URL` → use the `school_saas_owner` role + password you picked.
- `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` → replace with two long random
  strings (32+ characters each). You can generate one with:
  `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
- `CHROMIUM_EXECUTABLE_PATH` → required for report-card PDF export (Day 5).
  Point it at an installed Chrome/Chromium, e.g. on Windows:
  `C:\Program Files\Google\Chrome\Application\chrome.exe` (use double
  backslashes or forward slashes if your `.env` parser complains). Everything
  else works without this — only the PDF download endpoint needs it.

## 4. Install dependencies and run migrations

```
npm install
```

Migrations must run as the **owner** role (it has the privileges to alter
schema and create RLS policies; the app role deliberately does not).
Temporarily point `DATABASE_URL` at the owner connection string for this
one command, or run:

**Windows (PowerShell):**
```powershell
$env:DATABASE_URL="postgresql://school_saas_owner:<owner-password>@localhost:5432/school_saas?schema=public"
npx prisma migrate deploy
```

**Mac/Linux:**
```bash
DATABASE_URL="postgresql://school_saas_owner:<owner-password>@localhost:5432/school_saas?schema=public" npx prisma migrate deploy
```

## 5. Run it

```
npm run dev
```

The API listens on `http://localhost:4000`. Check `http://localhost:4000/health`.

## 6. Run the tests

Requires the `school_saas_test` database from step 2. Copy `.env` to
`.env.test`, point both `DATABASE_URL`/`DATABASE_MIGRATE_URL` at
`school_saas_test`, apply migrations there too (same as step 4, against
the test DB), keep `CHROMIUM_EXECUTABLE_PATH` set (one test generates a
real PDF), then:

```
npm test
```

## Quick smoke test

```bash
curl -X POST http://localhost:4000/api/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"schoolName":"My School","slug":"my-school","adminFullName":"Admin Name","adminEmail":"admin@myschool.test","adminPassword":"Passw0rd123"}'
```

## 7. Run the frontend (Day 11+)

With the backend already running on port 4000 (steps above):

```
cd frontend
copy .env.local.example .env.local      (Windows)   |   cp .env.local.example .env.local   (Mac/Linux)
npm install
npm run dev
```

Open `http://localhost:3000`. `NEXT_PUBLIC_API_URL` in `.env.local` must
match wherever the backend is actually running (defaults to
`http://localhost:4000`, matching the backend's default `PORT`).

Frontend checks, mirroring the backend's build-test-fix loop:

```
npm run typecheck
npm run lint
npm test
npm run build
```
