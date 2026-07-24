"use client"

import { useEffect, useState } from "react"

/**
 * Lightweight OpenAPI renderer — fetches /api/openapi.json (generated live
 * from the service registry) and renders endpoints, auth, and curl examples
 * without heavy swagger-ui dependencies.
 */

type Spec = {
  info: { title: string; version: string; description?: string }
  servers: { url: string }[]
  paths: Record<string, Record<string, { summary?: string; description?: string; tags?: string[] }>>
}

const METHOD_ORDER = ["get", "post", "put", "patch", "delete"]

export default function DocsPage() {
  const [spec, setSpec] = useState<Spec | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/openapi.json")
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Failed to load spec.")
        setSpec(await r.json())
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load spec."))
  }, [])

  if (error) return <main className="container"><div className="error-box">⛔ {error}</div></main>
  if (!spec) return <main className="container"><p className="meta">Loading OpenAPI spec…</p></main>

  const origin = spec.servers[0]?.url ?? ""

  return (
    <main className="container">
      <div className="topbar">
        <div>
          <h1>📘 {spec.info.title}</h1>
          <div className="sub">OpenAPI {spec.info.version} · generated live from the service registry · <a href="/api/openapi.json">raw JSON</a> · <a href="/">← portal</a></div>
        </div>
      </div>

      <div className="card">
        <h2>Authentication</h2>
        <p style={{ fontSize: 14 }}>{spec.info.description}</p>
        <pre style={{ marginTop: 10 }}><code>{`curl -H "Authorization: Bearer idp_live_..." ${origin}/api/gateway/demo/users
# or
curl -H "x-api-key: idp_live_..." ${origin}/api/gateway/demo/users`}</code></pre>
      </div>

      {Object.entries(spec.paths).map(([path, ops]) => (
        <div className="card" key={path}>
          <h2 className="mono" style={{ background: "none", border: "none", padding: 0 }}>{path}</h2>
          <table>
            <thead>
              <tr><th style={{ width: 90 }}>Method</th><th>Summary</th></tr>
            </thead>
            <tbody>
              {METHOD_ORDER.filter((m) => ops[m]).map((m) => (
                <tr key={m}>
                  <td><span className={`badge ${m === "get" ? "ok" : m === "delete" ? "bad" : "warn"}`}>{m.toUpperCase()}</span></td>
                  <td>
                    {ops[m].summary}
                    <div className="meta">{ops[m].description}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="meta" style={{ marginTop: 10 }}>
            Standard gateway responses: 401 (no/invalid key) · 403 (revoked or wrong service) · 429 (rate limited, see <code>Retry-After</code>) · 502/504 (upstream down/timeout). Every response carries <code>X-RateLimit-Limit</code> and <code>X-RateLimit-Remaining</code>.
          </p>
        </div>
      ))}
    </main>
  )
}
