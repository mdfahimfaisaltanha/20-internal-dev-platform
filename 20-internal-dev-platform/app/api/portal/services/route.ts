import { requireAuth } from "@/lib/auth"
import { getPool } from "@/lib/db"

export const runtime = "nodejs"

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/

export async function GET() {
  const denied = requireAuth()
  if (denied) return denied
  const res = await getPool().query(
    `SELECT id, name, slug, upstream_url, description, created_at FROM services ORDER BY id`,
  )
  return Response.json({
    services: res.rows.map((r) => ({
      id: r.id,
      name: r.name,
      slug: r.slug,
      upstreamUrl: r.upstream_url,
      description: r.description,
      createdAt: r.created_at,
    })),
  })
}

export async function POST(req: Request) {
  const denied = requireAuth()
  if (denied) return denied
  const body = (await req.json().catch(() => ({}))) as {
    name?: string
    slug?: string
    upstreamUrl?: string
    description?: string
  }

  const name = body.name?.trim()
  const slug = body.slug?.trim().toLowerCase()
  const upstreamUrl = body.upstreamUrl?.trim()

  if (!name || !slug || !upstreamUrl) {
    return Response.json({ error: "name, slug, and upstreamUrl are required." }, { status: 400 })
  }
  if (!SLUG_RE.test(slug)) {
    return Response.json(
      { error: "Slug must be 3-40 chars: lowercase letters, digits, hyphens." },
      { status: 400 },
    )
  }
  const isPath = upstreamUrl.startsWith("/")
  const isHttp = /^https?:\/\//.test(upstreamUrl)
  if (!isPath && !isHttp) {
    return Response.json(
      { error: "upstreamUrl must be an http(s) URL or a path starting with '/'." },
      { status: 400 },
    )
  }

  try {
    const res = await getPool().query(
      `INSERT INTO services (name, slug, upstream_url, description) VALUES ($1, $2, $3, $4)
       RETURNING id`,
      [name, slug, upstreamUrl, body.description?.trim() ?? ""],
    )
    return Response.json({ ok: true, id: res.rows[0].id })
  } catch (err) {
    const message = err instanceof Error && err.message.includes("duplicate")
      ? `A service with slug "${slug}" or name "${name}" already exists.`
      : "Failed to create service."
    return Response.json({ error: message }, { status: 409 })
  }
}

export async function DELETE(req: Request) {
  const denied = requireAuth()
  if (denied) return denied
  const id = Number(new URL(req.url).searchParams.get("id"))
  if (!Number.isInteger(id)) {
    return Response.json({ error: "Pass ?id=<service id>." }, { status: 400 })
  }
  // Keys scoped to this service are revoked, not deleted — audit trail stays.
  const pool = getPool()
  await pool.query(`UPDATE api_keys SET revoked = true WHERE service_id = $1`, [id])
  await pool.query(`DELETE FROM services WHERE id = $1`, [id])
  return Response.json({ ok: true })
}
