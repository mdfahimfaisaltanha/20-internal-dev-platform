"use client"

import { useCallback, useEffect, useState } from "react"
import type { UsageSummary } from "@/lib/types"

type ServiceRow = {
  id: number
  name: string
  slug: string
  upstreamUrl: string
  description: string
}

type KeyRow = {
  id: number
  name: string
  keyPrefix: string
  serviceId: number | null
  serviceName: string
  rateLimitPerMin: number
  revoked: boolean
  lastUsedAt: string | null
}

type Tab = "usage" | "services" | "keys"

export default function Portal() {
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [password, setPassword] = useState("")
  const [tab, setTab] = useState<Tab>("usage")
  const [error, setError] = useState<string | null>(null)

  const [services, setServices] = useState<ServiceRow[]>([])
  const [keys, setKeys] = useState<KeyRow[]>([])
  const [usage, setUsage] = useState<UsageSummary | null>(null)

  // New-service form
  const [svcName, setSvcName] = useState("")
  const [svcSlug, setSvcSlug] = useState("")
  const [svcUrl, setSvcUrl] = useState("")

  // New-key form
  const [keyName, setKeyName] = useState("")
  const [keyService, setKeyService] = useState("")
  const [keyLimit, setKeyLimit] = useState("60")
  const [revealedKey, setRevealedKey] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setError(null)
    try {
      const [s, k, u] = await Promise.all([
        fetch("/api/portal/services"),
        fetch("/api/portal/keys"),
        fetch("/api/portal/usage"),
      ])
      if (s.status === 401) {
        setAuthed(false)
        return
      }
      setServices((await s.json()).services ?? [])
      setKeys((await k.json()).keys ?? [])
      setUsage(await u.json())
      setAuthed(true)
    } catch {
      setError("Failed to load portal data. Is the database set up? Run `npm run setup`.")
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  async function login(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const res = await fetch("/api/portal/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    })
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || "Login failed.")
      return
    }
    setPassword("")
    void refresh()
  }

  async function createService(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    const res = await fetch("/api/portal/services", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: svcName, slug: svcSlug, upstreamUrl: svcUrl }),
    })
    if (!res.ok) {
      setError((await res.json().catch(() => ({}))).error || "Failed to create service.")
      return
    }
    setSvcName("")
    setSvcSlug("")
    setSvcUrl("")
    void refresh()
  }

  async function deleteService(id: number) {
    if (!confirm("Delete this service? Keys scoped to it will be revoked.")) return
    await fetch(`/api/portal/services?id=${id}`, { method: "DELETE" })
    void refresh()
  }

  async function createKey(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setRevealedKey(null)
    const res = await fetch("/api/portal/keys", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: keyName,
        serviceId: keyService ? Number(keyService) : null,
        rateLimitPerMin: Number(keyLimit) || undefined,
      }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      setError(data.error || "Failed to create key.")
      return
    }
    setRevealedKey(data.plainKey)
    setKeyName("")
    void refresh()
  }

  async function revokeKey(id: number) {
    if (!confirm("Revoke this key? This cannot be undone.")) return
    await fetch("/api/portal/keys", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    })
    void refresh()
  }

  if (authed === null) {
    return <main className="container"><p className="meta">Loading…</p></main>
  }

  if (!authed) {
    return (
      <main className="container">
        <div className="login-wrap card">
          <h2>🛠️ Internal Developer Platform</h2>
          <p className="meta" style={{ marginBottom: 14 }}>Sign in with the admin password (ADMIN_PASSWORD in .env.local).</p>
          <form className="row" onSubmit={login}>
            <input
              type="password"
              placeholder="Admin password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ flex: 1 }}
            />
            <button className="primary" type="submit">Sign in</button>
          </form>
          {error && <div className="error-box">⛔ {error}</div>}
        </div>
      </main>
    )
  }

  const maxHour = Math.max(1, ...(usage?.byHour.map((h) => h.count) ?? [1]))

  return (
    <main className="container">
      <div className="topbar">
        <div>
          <h1>🛠️ Internal Developer Platform</h1>
          <div className="sub">Self-service API gateway — keys, rate limits, usage · <a href="/docs">OpenAPI docs →</a></div>
        </div>
        <button
          className="ghost"
          onClick={async () => {
            await fetch("/api/portal/login", { method: "DELETE" })
            setAuthed(false)
          }}
        >
          Sign out
        </button>
      </div>

      <div className="tabs">
        {(["usage", "services", "keys"] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
            {t === "usage" ? "📊 Usage" : t === "services" ? "🗂️ Services" : "🔑 API Keys"}
          </button>
        ))}
      </div>

      {error && <div className="error-box">⛔ {error}</div>}

      {tab === "usage" && usage && (
        <>
          <div className="grid-3">
            <div className="kpi"><div className="value">{usage.totalLast24h}</div><div className="label">Requests (24h)</div></div>
            <div className="kpi"><div className="value">{usage.avgLatencyMs} ms</div><div className="label">Avg gateway latency</div></div>
            <div className="kpi"><div className="value">{usage.rateLimited24h}</div><div className="label">Rate-limited (429s)</div></div>
          </div>

          <div className="card">
            <h2>Requests by hour (24h)</h2>
            {usage.byHour.length === 0 && <p className="meta">No traffic yet — try the curl examples in the README or samples/curl-examples.md.</p>}
            {usage.byHour.map((h) => (
              <div className="bar-row" key={h.hour}>
                <span className="bar-label">{h.hour}</span>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${((h.count - h.errors) / maxHour) * 100}%` }} />
                  <div className="bar-fill err" style={{ width: `${(h.errors / maxHour) * 100}%` }} />
                </div>
                <span className="bar-count">{h.count}{h.errors > 0 ? ` (${h.errors} err)` : ""}</span>
              </div>
            ))}
          </div>

          <div className="card">
            <h2>Top keys (24h)</h2>
            {usage.topKeys.length === 0 ? <p className="meta">No traffic yet.</p> : (
              <table>
                <thead><tr><th>Key</th><th>Prefix</th><th>Requests</th></tr></thead>
                <tbody>
                  {usage.topKeys.map((k) => (
                    <tr key={k.keyPrefix}><td>{k.keyName}</td><td><code>{k.keyPrefix}…</code></td><td>{k.count}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="card">
            <h2>Recent requests</h2>
            {usage.recent.length === 0 ? <p className="meta">Nothing yet.</p> : (
              <table>
                <thead><tr><th>Key</th><th>Service</th><th>Request</th><th>Status</th><th>Latency</th></tr></thead>
                <tbody>
                  {usage.recent.map((r, i) => (
                    <tr key={i}>
                      <td>{r.keyName}</td>
                      <td><code>{r.serviceSlug}</code></td>
                      <td className="mono" style={{ background: "none", border: "none" }}>{r.method} {r.path}</td>
                      <td className={`status-${Math.floor(r.status / 100)}`}>{r.status}</td>
                      <td>{r.latencyMs} ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}

      {tab === "services" && (
        <>
          <div className="card">
            <h2>Register a service</h2>
            <form className="row" onSubmit={createService}>
              <input placeholder="Name (e.g. Payments API)" value={svcName} onChange={(e) => setSvcName(e.target.value)} />
              <input placeholder="slug (e.g. payments)" value={svcSlug} onChange={(e) => setSvcSlug(e.target.value)} />
              <input placeholder="Upstream URL (https://… or /api/demo)" value={svcUrl} onChange={(e) => setSvcUrl(e.target.value)} style={{ flex: 1, minWidth: 220 }} />
              <button className="primary" type="submit">Register</button>
            </form>
            <p className="meta" style={{ marginTop: 8 }}>Consumers then call <code>/api/gateway/&#123;slug&#125;/&#123;path&#125;</code> with an API key.</p>
          </div>

          <div className="card">
            <h2>Registered services</h2>
            <table>
              <thead><tr><th>Name</th><th>Slug</th><th>Upstream</th><th></th></tr></thead>
              <tbody>
                {services.map((s) => (
                  <tr key={s.id}>
                    <td>{s.name}<div className="meta">{s.description}</div></td>
                    <td><code>{s.slug}</code></td>
                    <td><code>{s.upstreamUrl}</code></td>
                    <td><button className="ghost" onClick={() => deleteService(s.id)}>Delete</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === "keys" && (
        <>
          <div className="card">
            <h2>Mint an API key</h2>
            <form className="row" onSubmit={createKey}>
              <input placeholder="Key name (e.g. checkout-service prod)" value={keyName} onChange={(e) => setKeyName(e.target.value)} style={{ flex: 1, minWidth: 220 }} />
              <select value={keyService} onChange={(e) => setKeyService(e.target.value)}>
                <option value="">All services</option>
                {services.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <input type="number" min={1} max={100000} value={keyLimit} onChange={(e) => setKeyLimit(e.target.value)} style={{ width: 110 }} title="Requests per minute" />
              <span className="meta">req/min</span>
              <button className="primary" type="submit">Create key</button>
            </form>
            {revealedKey && (
              <div className="key-reveal">
                ✅ Key created. <strong>Copy it now — it is shown only once</strong> (only a hash is stored):
                <div style={{ marginTop: 6 }}><code>{revealedKey}</code></div>
              </div>
            )}
          </div>

          <div className="card">
            <h2>Issued keys</h2>
            <table>
              <thead><tr><th>Name</th><th>Prefix</th><th>Scope</th><th>Limit</th><th>Status</th><th>Last used</th><th></th></tr></thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id}>
                    <td>{k.name}</td>
                    <td><code>{k.keyPrefix}…</code></td>
                    <td>{k.serviceName}</td>
                    <td>{k.rateLimitPerMin}/min</td>
                    <td>{k.revoked ? <span className="badge bad">revoked</span> : <span className="badge ok">active</span>}</td>
                    <td className="meta">{k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : "never"}</td>
                    <td>{!k.revoked && <button className="ghost" onClick={() => revokeKey(k.id)}>Revoke</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </main>
  )
}
