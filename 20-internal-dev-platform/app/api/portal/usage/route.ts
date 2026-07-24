import { requireAuth } from "@/lib/auth"
import { getPool } from "@/lib/db"
import type { UsageSummary } from "@/lib/types"

export const runtime = "nodejs"

/** Aggregated usage analytics for the portal dashboard (last 24 hours). */
export async function GET() {
  const denied = requireAuth()
  if (denied) return denied
  const pool = getPool()

  const [totals, byHour, byStatus, topKeys, recent] = await Promise.all([
    pool.query(
      `SELECT COUNT(*)::int AS total,
              COALESCE(AVG(latency_ms), 0)::float AS avg_latency,
              COUNT(*) FILTER (WHERE status = 429)::int AS rate_limited
       FROM usage_logs WHERE created_at > now() - interval '24 hours'`,
    ),
    pool.query(
      `SELECT to_char(date_trunc('hour', created_at), 'HH24:00') AS hour,
              COUNT(*)::int AS item_count,
              COUNT(*) FILTER (WHERE status >= 400)::int AS errors
       FROM usage_logs WHERE created_at > now() - interval '24 hours'
       GROUP BY date_trunc('hour', created_at) ORDER BY date_trunc('hour', created_at)`,
    ),
    pool.query(
      `SELECT (status / 100)::int || 'xx' AS status_class, COUNT(*)::int AS item_count
       FROM usage_logs WHERE created_at > now() - interval '24 hours'
       GROUP BY status / 100 ORDER BY status / 100`,
    ),
    pool.query(
      `SELECT k.name, k.key_prefix, COUNT(*)::int AS item_count
       FROM usage_logs u JOIN api_keys k ON k.id = u.key_id
       WHERE u.created_at > now() - interval '24 hours'
       GROUP BY k.id ORDER BY item_count DESC LIMIT 5`,
    ),
    pool.query(
      `SELECT k.name AS key_name, u.service_slug, u.method, u.path, u.status, u.latency_ms, u.created_at
       FROM usage_logs u JOIN api_keys k ON k.id = u.key_id
       ORDER BY u.id DESC LIMIT 20`,
    ),
  ])

  const summary: UsageSummary = {
    totalLast24h: totals.rows[0].total,
    avgLatencyMs: Math.round(totals.rows[0].avg_latency),
    rateLimited24h: totals.rows[0].rate_limited,
    byHour: byHour.rows.map((r) => ({ hour: r.hour, count: r.item_count, errors: r.errors })),
    byStatus: byStatus.rows.map((r) => ({ statusClass: r.status_class, count: r.item_count })),
    topKeys: topKeys.rows.map((r) => ({ keyName: r.name, keyPrefix: r.key_prefix, count: r.item_count })),
    recent: recent.rows.map((r) => ({
      keyName: r.key_name,
      serviceSlug: r.service_slug,
      method: r.method,
      path: r.path,
      status: r.status,
      latencyMs: r.latency_ms,
      createdAt: r.created_at,
    })),
  }
  return Response.json(summary)
}
