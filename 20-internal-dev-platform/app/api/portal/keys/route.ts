import { requireAuth } from "@/lib/auth"
import { DEFAULT_RATE_LIMIT, getPool } from "@/lib/db"
import { generateApiKey } from "@/lib/keys"

export const runtime = "nodejs"

export async function GET() {
  const denied = requireAuth()
  if (denied) return denied
  const res = await getPool().query(
    `SELECT k.id, k.name, k.key_prefix, k.service_id, k.rate_limit_per_min, k.revoked,
            k.created_at, k.last_used_at, s.name AS service_name
     FROM api_keys k LEFT JOIN services s ON s.id = k.service_id
     ORDER BY k.id DESC`,
  )
  return Response.json({
    keys: res.rows.map((r) => ({
      id: r.id,
      name: r.name,
      keyPrefix: r.key_prefix,
      serviceId: r.service_id,
      serviceName: r.service_name ?? "All services",
      rateLimitPerMin: r.rate_limit_per_min,
      revoked: r.revoked,
      createdAt: r.created_at,
      lastUsedAt: r.last_used_at,
    })),
  })
}

/** Create a key. The plaintext is returned ONCE and never stored. */
export async function POST(req: Request) {
  const denied = requireAuth()
  if (denied) return denied
  const body = (await req.json().catch(() => ({}))) as {
    name?: string
    serviceId?: number | null
    rateLimitPerMin?: number
  }

  const name = body.name?.trim()
  if (!name) {
    return Response.json({ error: "Key name is required (e.g. \"checkout-service prod\")." }, { status: 400 })
  }
  const rateLimit =
    Number.isInteger(body.rateLimitPerMin) && (body.rateLimitPerMin as number) >= 1 && (body.rateLimitPerMin as number) <= 100_000
      ? (body.rateLimitPerMin as number)
      : DEFAULT_RATE_LIMIT
  const serviceId = Number.isInteger(body.serviceId) ? body.serviceId : null

  const { plainKey, keyHash, keyPrefix } = generateApiKey()
  const res = await getPool().query(
    `INSERT INTO api_keys (name, key_prefix, key_hash, service_id, rate_limit_per_min)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [name, keyPrefix, keyHash, serviceId, rateLimit],
  )

  return Response.json({
    ok: true,
    id: res.rows[0].id,
    plainKey,
    note: "Store this key now — it is shown only once and cannot be recovered.",
  })
}

/** Revoke (never delete — the usage audit trail stays intact). */
export async function PATCH(req: Request) {
  const denied = requireAuth()
  if (denied) return denied
  const body = (await req.json().catch(() => ({}))) as { id?: number }
  if (!Number.isInteger(body.id)) {
    return Response.json({ error: "Pass { id } of the key to revoke." }, { status: 400 })
  }
  await getPool().query(`UPDATE api_keys SET revoked = true WHERE id = $1`, [body.id])
  return Response.json({ ok: true })
}
