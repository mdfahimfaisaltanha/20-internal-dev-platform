# Internal Developer Platform / API Gateway

A self-service API gateway: teams register upstream services, mint scoped API keys, and consume any service through one authenticated, rate-limited entry point — with usage analytics and live OpenAPI docs.

```
                       ┌──────────────────────────────┐
  consumer ─ API key → │            GATEWAY               │ → upstream service
                       │ 1. authenticate (hashed keys)    │    (e.g. /api/demo,
                       │ 2. authorize (service scope)     │     payments API, …)
                       │ 3. rate limit (token bucket)     │
                       │ 4. proxy w/ 15s timeout          │
                       │ 5. log usage (fire-and-forget)   │
                       └──────────────────────────────┘
```

Built with **Next.js 14 (App Router)**, **TypeScript**, and **Postgres**. No Redis required (see “Rate limiting” for the tradeoff discussion).

---

## Quick start

```bash
npm install
cp .env.example .env.local   # set DATABASE_URL (Neon/Supabase free tier) + ADMIN_PASSWORD
npm run setup                # creates tables, registers the demo service, prints a demo key ONCE
npm run dev                  # http://localhost:3000
```

Then hit the gateway with the key that `npm run setup` printed:

```bash
curl -H "Authorization: Bearer idp_live_..." http://localhost:3000/api/gateway/demo/users
```

More examples (rate-limit demo, error paths) in `samples/curl-examples.md`.

---

## What's inside

| Piece | File | Notes |
|---|---|---|
| Gateway proxy | `app/api/gateway/[...path]/route.ts` | `/api/gateway/{service}/{path}` — auth → scope check → rate limit → proxy (15s timeout, 2 MB body cap) → log |
| API keys | `lib/keys.ts` | `idp_live_` prefix, SHA-256 hash-only storage, shown once, constant-time compare |
| Rate limiter | `lib/rateLimit.ts` | Token bucket in Postgres — one atomic UPSERT per request |
| Self-service portal | `app/page.tsx` + `app/api/portal/*` | Register services, mint/revoke keys, usage dashboard (24h KPIs, hourly bars, top keys, recent requests) |
| OpenAPI docs | `app/api/openapi.json/route.ts` + `app/docs/page.tsx` | Spec generated live from the service registry; lightweight renderer, no swagger-ui dependency |
| Demo upstream | `app/api/demo/[...path]/route.ts` | Bundled mock API (`/users`, `/orders`, `/ping`, `/slow`, `/error`, `POST /echo`) so everything works with zero external services |
| Setup script | `scripts/setup.mjs` | Idempotent: tables + demo service + one demo key |

## Key security

- Keys look like `idp_live_<40 hex>` — the recognizable prefix makes leaked keys greppable and secret-scanner friendly.
- **Only the SHA-256 hash is stored.** The plaintext is returned exactly once at mint time; a leaked database doesn't leak usable keys.
- Lookups compare hashes with `timingSafeEqual` (no timing side-channel).
- Keys are **revoked, never deleted**, so the usage audit trail survives.
- Keys can be scoped to a single service or all services, each with its own req/min limit.

## Rate limiting (interview talking point)

Token bucket, implemented as **one atomic Postgres UPSERT**:

```
tokens = clamp( min(capacity, tokens + elapsed_seconds × capacity/60) − 1 , −1, capacity )
```

- Refill is continuous (capacity/60 tokens per second), so bursts up to capacity are allowed but sustained traffic converges to the per-minute limit — smoother than fixed windows, no boundary spikes.
- The refill + spend happens in a single `INSERT … ON CONFLICT DO UPDATE … RETURNING`, so concurrent serverless instances can't double-spend.
- Denied requests get `429` with `Retry-After` (computed from the refill rate) plus `X-RateLimit-Limit` / `X-RateLimit-Remaining` on every response.
- **Why Postgres, not Redis?** One less moving part on a free-tier deploy, and one indexed UPSERT per request is fine at this scale. The limiter is a single function — swapping in Redis (Lua token bucket) later touches only `lib/rateLimit.ts`.

## Edge cases handled

| Case | Behavior |
|---|---|
| Missing / invalid key | `401` with a hint about `Authorization: Bearer` / `x-api-key` |
| Revoked key | `403`, distinct from invalid |
| Key scoped to another service | `403` |
| Unknown service slug | `404` |
| Rate limit exceeded | `429` + `Retry-After`, still logged for the dashboard |
| Upstream down | `502` with the service name |
| Upstream timeout | `504` after 15s (`AbortSignal.timeout`) |
| Oversized body | `413` at 2 MB, checked before proxying |
| Header hygiene | `Authorization`/`x-api-key`/`Cookie` are stripped before forwarding (upstream never sees gateway credentials); hop-by-hop headers stripped both ways |
| Usage logging failure | Fire-and-forget — analytics never break the request path |
| Duplicate service slug | `409` with a clear message |

## Deployment (Vercel + Neon)

1. Create a free Postgres database at [neon.tech](https://neon.tech) and copy the connection string.
2. Run setup locally against it: `DATABASE_URL=... npm run setup` (or set `.env.local` first).
3. Push to GitHub → import in Vercel → set `DATABASE_URL` and `ADMIN_PASSWORD` env vars → deploy.
4. The demo service uses a path upstream (`/api/demo`) resolved against the deployed origin, so it works in production unchanged.

## Limitations / roadmap

- Single-admin portal auth (`ADMIN_PASSWORD`) — the upgrade path for multi-team use is a users table + NextAuth/OIDC and per-team key ownership.
- Request logging stores metadata only (method, path, status, latency) — no bodies, by design.
- Streaming upstream responses are relayed, but WebSockets are not proxied (serverless constraint).
- Per-service OpenAPI pass-through (registering an upstream's own spec URL) is a natural next feature.
