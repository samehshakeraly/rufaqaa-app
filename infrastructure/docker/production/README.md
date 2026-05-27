# Rufaqaa — Production stack (reference)

A single-host docker-compose with:

- **postgres** (PostGIS image)
- **redis** (Celery broker + result backend)
- **backend** (uvicorn × 4 workers)
- **worker** (Celery)
- **beat** (Celery scheduler)
- **frontend** (built SPA served by nginx-alpine)
- **nginx** (reverse proxy: `/` → frontend, `/api/*` → backend)

Designed for a small VPS deployment. TLS termination is intentionally
out of scope — put this behind your load balancer / Cloudflare /
caddy / certbot-managed nginx.

## Quick start

```bash
cd infrastructure/docker/production
cp .env.example .env
$EDITOR .env          # POSTGRES_PASSWORD, SECRET_KEY, JWT_SECRET_KEY, PUBLIC_HOST
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml exec backend alembic upgrade head
docker compose -f docker-compose.prod.yml exec backend python -m app.scripts.seed
```

The app is then reachable at `http://${PUBLIC_HOST}/`.

## Backups

Drop a cron entry on the host that calls
`infrastructure/scripts/backup_postgres.sh` with `POSTGRES_HOST=postgres`
and the password from your `.env`.
