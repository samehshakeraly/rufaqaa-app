# Deploying the Rufaqaa demo / staging stack

A single-host (KVM VPS + Docker) demo of the platform behind a Caddy reverse
proxy with automatic HTTPS. It layers `docker-compose.prod.yml` over the base
`docker-compose.yml`: built images, no source bind-mounts, no hot-reload, and
only Caddy (80/443) is published to the host.

> This is a **demo**: it ships obviously-fake sample data and sandbox payment
> keys. Do not put real beneficiary data on it.

## Prerequisites

- A VPS with **Docker Engine** and **Docker Compose v2.24.4+** (the override
  uses the `!reset` merge tag).
- Ports **80** and **443** open to the internet.
- A DNS **A/AAAA record** for your domain (default `demo.rufaqaa.app`)
  pointing at the VPS IP. Caddy needs this resolvable to issue a Let's Encrypt
  certificate. `/media` and `/api` are served under the same host, so a single
  record is enough.

## 1. Get the code and configure secrets

```bash
git clone https://github.com/samehshakeraly/rufaqaa-app.git
cd rufaqaa-app

cp .env.prod.example .env
```

Edit `.env` and replace every `REPLACE_WITH_*` placeholder. At minimum:

- `DOMAIN` — your hostname (e.g. `demo.rufaqaa.app`).
- `SECRET_KEY`, `JWT_SECRET_KEY` — `python -c "import secrets; print(secrets.token_urlsafe(64))"`
- `FIELD_ENCRYPTION_KEY` — generate **once** and keep stable forever
  (rotating it makes existing encrypted `national_id` values undecryptable):
  ```bash
  python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
  ```
- `POSTGRES_PASSWORD` (and the matching password in `DATABASE_URL`).
- `MINIO_ROOT_PASSWORD` + `S3_SECRET_KEY` (must be identical); likewise
  `MINIO_ROOT_USER` == `S3_ACCESS_KEY`.
- `MYFATOORAH_API_KEY`, `MYFATOORAH_WEBHOOK_SECRET` — sandbox values from
  the MyFatoorah portal (the secrets guard requires them to be non-empty).

`ENVIRONMENT` must stay `staging` (or `production`) so the boot-time secrets
guard is active.

To avoid repeating `-f` on every command, export the file list once:

```bash
export COMPOSE_FILE=docker-compose.yml:docker-compose.prod.yml
```

(All commands below assume this is set; otherwise prepend
`-f docker-compose.yml -f docker-compose.prod.yml` to each `docker compose`.)

## 2. Build the images

`VITE_API_URL` is inlined into the frontend bundle at build time from `DOMAIN`,
so the build must happen after `.env` is set.

```bash
docker compose build
```

## 3. Apply the database schema (migrations)

This starts Postgres (and waits for it to be healthy) and runs Alembic in a
throwaway backend container:

```bash
docker compose run --rm backend alembic upgrade head
```

This loads the canonical schema + all migrations, including the reference
country/currency seed. **Do not** hand-edit the schema or migrations.

## 4. Seed the demo data

Idempotent, data-only, and scoped to two clearly-fake demo organizations
(safe to re-run; it skips if the demo data already exists, or pass `--force`
to wipe and recreate it):

```bash
docker compose run --rm backend python -m app.scripts.staging_seed
```

It prints the demo `org_admin` logins (e.g.
`demo-admin-a@demo.rufaqaa.app` / `demo-admin-12345`).

## 5. Bring the stack up

```bash
docker compose up -d
```

Caddy will obtain a certificate for `DOMAIN` on first start (this needs the
DNS record from the prerequisites to already resolve to the VPS). Watch it
with:

```bash
docker compose logs -f caddy
```

## 6. Verify

```bash
curl -fsS https://<DOMAIN>/api/v1/health        # backend behind Caddy
```

Then open `https://<DOMAIN>/` in a browser and sign in with a demo admin
login from step 4. The orphans/donors/sponsorships and placeholder
media/documents should render.

## Operating notes

- **Logs:** `docker compose logs -f backend worker caddy`
- **Re-seed:** `docker compose run --rm backend python -m app.scripts.staging_seed --force`
- **Update:** `git pull && docker compose build && docker compose run --rm backend alembic upgrade head && docker compose up -d`
- **Debug tools** (Adminer, MailHog) are parked behind a profile and off by
  default; start them with `docker compose --profile debug up -d` if needed.
- **Data** lives in the named volumes `rufaqaa-postgres-data`,
  `rufaqaa-minio-data`, `rufaqaa-redis-data` and `rufaqaa-caddy-data`
  (certs). Back up or remove these to reset.
- Postgres, Redis and MinIO are **not** published on the host — reach them
  with `docker compose exec` (e.g. `docker compose exec postgres psql -U rufaqaa`).
