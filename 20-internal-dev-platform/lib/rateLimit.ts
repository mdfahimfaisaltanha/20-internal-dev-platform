import { getPool } from "@/lib/db"

/**
 * Token-bucket rate limiter backed by Postgres.
 *
 * Each key has a bucket with capacity = its per-minute limit, refilling
 * continuously at limit/60 tokens per second. The refill + spend is one
 * atomic UPSERT, so concurrent serverless instances cannot double-spend:
 *
 *   tokens = clamp( least(capacity, old_tokens + elapsed*rate) - 1 , -1, capacity )
 *
 * A returned value >= 0 means the request is allowed. The floor of -1 keeps
 * abusive floods from digging an unbounded debt hole.
 *
 * Why Postgres and not Redis? One less moving part on free-tier deploys, and
 * one indexed UPSERT per request is fine at portfolio scale. The interface
 * is a single function — swapping in Redis (INCR/EXPIRE or a Lua token
 * bucket) later only changes this file.
 */

export type RateLimitResult = {
  allowed: boolean
  limitPerMin: number
  /** Approximate remaining tokens (floored at 0 for headers). */
  remaining: number
  /** Seconds until a retry is likely to succeed (only when denied). */
  retryAfterSec: number
}

export async function checkRateLimit(
  keyId: number,
  limitPerMin: number,
): Promise<RateLimitResult> {
  const capacity = Math.max(1, limitPerMin)
  const refillPerSec = capacity / 60

  const res = await getPool().query<{ tokens: string | number }>(
    `INSERT INTO rate_buckets (key_id, tokens, updated_at)
     VALUES ($1, $2 - 1, now())
     ON CONFLICT (key_id) DO UPDATE SET
       tokens = GREATEST(
         LEAST($2::float8, rate_buckets.tokens + EXTRACT(EPOCH FROM (now() - rate_buckets.updated_at)) * $3::float8) - 1,
         -1
       ),
       updated_at = now()
     RETURNING tokens`,
    [keyId, capacity, refillPerSec],
  )

  const tokens = Number(res.rows[0].tokens)
  const allowed = tokens >= 0
  return {
    allowed,
    limitPerMin: capacity,
    remaining: Math.max(0, Math.floor(tokens)),
    retryAfterSec: allowed ? 0 : Math.ceil((0 - tokens + 1) / refillPerSec),
  }
}
