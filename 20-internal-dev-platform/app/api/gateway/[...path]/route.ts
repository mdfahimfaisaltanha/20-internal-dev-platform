import { getPool } from "@/lib/db"
import { extractApiKey, hashApiKey } from "@/lib/keys"
import { checkRateLimit } from "@/lib/rateLimit"

export const runtime = "nodejs"
export const maxDuration = 30

const UPSTREAM_TIMEOUT_MS = 15_000
const MAX_BODY_BYTES = 2 * 1024 * 1024 // 2 MB

/** Hop-by-hop / sensitive headers never forwarded in either direction. */
const STRIP_REQUEST_HEADERS = new Set([
  "host", "connection", "content-length", "authorization", "x-api-key", "cookie", "accept-encoding",
])
const STRIP_RESPONSE_HEADERS = new Set([
  "connection", "transfer-encoding", "content-encoding", "content-length", "set-cookie",
])

type KeyRow = {
  id: number
  name: string
  service_id: number | null
  rate_limit_per_min: number
  revoked: boolean
}

type ServiceRow = {
  id: number
  slug: string
  upstream_url: string
}

function rateHeaders(limit: number, remaining: number): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(limit),
    "X-RateLimit-Remaining": String(remaining),
  }
}

async function handle(req: Request, params: { path: string[] }): Promise<Response> {
  const started = Date.now()
  const [slug, ...rest] = params.path

  if (!slug) {
    return Response.json({ error: "Missing service slug. Use /api/gateway/{service}/{path}." }, { status: 404 })
  }

  // --- 1. Authenticate the API key ---
  const plainKey = extractApiKey(req)
  if (!plainKey) {
    return Response.json(
      { error: "Missing API key. Send it as `Authorization: Bearer <key>` or `x-api-key: <key>`." },
      { status: 401 },
    )
  }

  const pool = getPool()
  const keyRes = await pool.query<KeyRow>(
    `SELECT id, name, service_id, rate_limit_per_min, revoked FROM api_keys WHERE key_hash = $1`,
    [hashApiKey(plainKey)],
  )
  const key = keyRes.rows[0]
  if (!key) {
    return Response.json({ error: "Invalid API key." }, { status: 401 })
  }
  if (key.revoked) {
    return Response.json({ error: "This API key has been revoked." }, { status: 403 })
  }

  // --- 2. Resolve the service ---
  const svcRes = await pool.query<ServiceRow>(
    `SELECT id, slug, upstream_url FROM services WHERE slug = $1`,
    [slug],
  )
  const service = svcRes.rows[0]
  if (!service) {
    return Response.json({ error: `Unknown service "${slug}".` }, { status: 404 })
  }
  if (key.service_id !== null && key.service_id !== service.id) {
    return Response.json({ error: "This API key is not authorized for this service." }, { status: 403 })
  }

  // --- 3. Rate limit (atomic token bucket) ---
  const rate = await checkRateLimit(key.id, key.rate_limit_per_min)
  if (!rate.allowed) {
    logUsage(key.id, service.slug, req.method, "/" + rest.join("/"), 429, Date.now() - started)
    return Response.json(
      { error: "Rate limit exceeded.", retryAfterSeconds: rate.retryAfterSec },
      {
        status: 429,
        headers: { ...rateHeaders(rate.limitPerMin, 0), "Retry-After": String(rate.retryAfterSec) },
      },
    )
  }

  // --- 4. Proxy to the upstream ---
  const reqUrl = new URL(req.url)
  // Path-style upstreams (e.g. "/api/demo") resolve against this app's own
  // origin — lets the bundled demo service work in any environment.
  const base = service.upstream_url.startsWith("/")
    ? `${reqUrl.origin}${service.upstream_url}`
    : service.upstream_url
  const target = `${base.replace(/\/$/, "")}/${rest.map(encodeURIComponent).join("/")}${reqUrl.search}`

  const headers = new Headers()
  req.headers.forEach((value, name) => {
    if (!STRIP_REQUEST_HEADERS.has(name.toLowerCase())) headers.set(name, value)
  })
  headers.set("x-forwarded-by", "idp-gateway")
  headers.set("x-consumer-key", key.name)

  let body: ArrayBuffer | undefined
  if (req.method !== "GET" && req.method !== "HEAD") {
    body = await req.arrayBuffer()
    if (body.byteLength > MAX_BODY_BYTES) {
      return Response.json({ error: "Request body too large (max 2 MB)." }, { status: 413 })
    }
  }

  let upstream: Response
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers,
      body,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      redirect: "manual",
    })
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError"
    const status = timedOut ? 504 : 502
    logUsage(key.id, service.slug, req.method, "/" + rest.join("/"), status, Date.now() - started)
    return Response.json(
      {
        error: timedOut
          ? `Upstream timed out after ${UPSTREAM_TIMEOUT_MS / 1000}s.`
          : "Upstream is unreachable.",
        service: service.slug,
      },
      { status, headers: rateHeaders(rate.limitPerMin, rate.remaining) },
    )
  }

  // --- 5. Log + relay the response ---
  const latency = Date.now() - started
  logUsage(key.id, service.slug, req.method, "/" + rest.join("/"), upstream.status, latency)
  void pool.query(`UPDATE api_keys SET last_used_at = now() WHERE id = $1`, [key.id]).catch(() => {})

  const respHeaders = new Headers(rateHeaders(rate.limitPerMin, rate.remaining))
  upstream.headers.forEach((value, name) => {
    if (!STRIP_RESPONSE_HEADERS.has(name.toLowerCase())) respHeaders.set(name, value)
  })
  respHeaders.set("x-gateway-latency-ms", String(latency))

  return new Response(upstream.body, { status: upstream.status, headers: respHeaders })
}

/** Fire-and-forget usage logging — never blocks or fails the request path. */
function logUsage(
  keyId: number,
  serviceSlug: string,
  method: string,
  path: string,
  status: number,
  latencyMs: number,
): void {
  void getPool()
    .query(
      `INSERT INTO usage_logs (key_id, service_slug, method, path, status, latency_ms) VALUES ($1, $2, $3, $4, $5, $6)`,
      [keyId, serviceSlug, method, path.slice(0, 500), status, latencyMs],
    )
    .catch(() => {})
}

type Ctx = { params: { path: string[] } }
export async function GET(req: Request, ctx: Ctx) { return handle(req, ctx.params) }
export async function POST(req: Request, ctx: Ctx) { return handle(req, ctx.params) }
export async function PUT(req: Request, ctx: Ctx) { return handle(req, ctx.params) }
export async function PATCH(req: Request, ctx: Ctx) { return handle(req, ctx.params) }
export async function DELETE(req: Request, ctx: Ctx) { return handle(req, ctx.params) }
