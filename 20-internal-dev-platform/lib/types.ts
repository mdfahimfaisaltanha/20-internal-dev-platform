/** Shared types for the internal developer platform. */

export type Service = {
  id: number
  name: string
  slug: string
  /** Absolute URL, or a path like "/api/demo" resolved against this app's origin. */
  upstreamUrl: string
  description: string
  createdAt: string
}

export type ApiKey = {
  id: number
  name: string
  /** First characters of the key, for identification. The full key is never stored. */
  keyPrefix: string
  /** null = key works for all services. */
  serviceId: number | null
  rateLimitPerMin: number
  revoked: boolean
  createdAt: string
  lastUsedAt: string | null
}

/** Returned exactly once, at creation time. */
export type CreatedApiKey = ApiKey & { plainKey: string }

export type UsageSummary = {
  totalLast24h: number
  avgLatencyMs: number
  rateLimited24h: number
  byHour: { hour: string; count: number; errors: number }[]
  byStatus: { statusClass: string; count: number }[]
  topKeys: { keyName: string; keyPrefix: string; count: number }[]
  recent: {
    keyName: string
    serviceSlug: string
    method: string
    path: string
    status: number
    latencyMs: number
    createdAt: string
  }[]
}
