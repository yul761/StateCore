# Deploy

The simplest production deployment for this repo is one VPS running:

- `demo-web`
- `api`
- `worker`
- `postgres`
- `redis`
- `caddy`

Only `caddy` is exposed publicly. `demo-web` stays the single public entrypoint and proxies the runtime API internally.

## 1. Prepare the server

Install:

- Docker Engine
- Docker Compose plugin

Clone the repo onto the VPS and enter the project directory.

## 2. Create production env

Copy the template and fill in your values:

```bash
cp .env.production.example .env.production
```

Set at minimum:

- `CADDY_DOMAIN`
- `POSTGRES_PASSWORD`
- `DATABASE_URL`
- `FEATURE_LLM=true`
- `MODEL_API_KEY` or the equivalent model-specific keys

Important:

- `DATABASE_URL` must point at the internal Compose hostname:
  - `postgresql://project_memory:...@postgres:5432/project_memory`
- `REDIS_URL` should stay:
  - `redis://redis:6379`

## 3. Build images

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production build
```

## 4. Start stateful services

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d postgres redis
```

## 5. Run Prisma migrations

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm migrate
```

## 6. Start the app stack

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d api worker demo-web caddy
```

## 7. Verify

Check containers:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production ps
```

Check the public entrypoint:

```bash
curl -I https://your-domain.example
```

If you want to verify the API from inside the server, remember the API expects a user identity header:

```bash
curl -H 'x-user-id: deploy-check' http://localhost:3000/health
```

Run a real end-to-end smoke through the public entrypoint:

```bash
BASE_URL=https://your-domain.example pnpm smoke:deploy
```

That smoke verifies:

- the public entrypoint is reachable
- a scope can be created
- a natural-language runtime turn succeeds
- Working Memory captures a goal
- Stable State commits a goal
- layer alignment and freshness converge cleanly

## 8. Updates

Pull new code, then:

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production build
docker compose -f docker-compose.prod.yml --env-file .env.production run --rm migrate
docker compose -f docker-compose.prod.yml --env-file .env.production up -d api worker demo-web caddy
```

Then rerun:

```bash
BASE_URL=https://your-domain.example pnpm smoke:deploy
```

## Notes

- `demo-web` is the only public service. It proxies `/health`, `/scopes`, `/state`, and `/memory/*` to the API internally.
- `worker` must stay running. This project is not API-only.
- If you do not have a real domain yet, set `CADDY_DOMAIN=:80` and visit the server over plain HTTP first.
- Anonymous guest isolation is browser-local. Each browser gets its own guest identity without requiring a login system.
