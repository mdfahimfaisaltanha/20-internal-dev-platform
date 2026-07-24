import { readFileSync } from "node:fs"
import { createHash, randomBytes } from "node:crypto"
import pg from "pg"

/**
 * One-shot setup: creates tables, registers the bundled demo service, and
 * mints a demo API key (printed once).
 *
 *   npm run setup
 *
 * Reads DATABASE_URL from .env.local (or the environment). Safe to re-run:
 * tables use IF NOT EXISTS and the demo rows are only inserted when missing.
 */

function loadEnvLocal() {
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "")
    }
  } catch {
    /* no .env.local — rely on the environment */
  }
}

loadEnvLocal()

if (!process.env.DATABASE_URL) {
  console.error("\n❌ DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.\n")
  process.exit(1)
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 })

const SCHEMA = `
CREATE TABLE IF NOT EXISTS services (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL UNIQUE,
  slug          TEXT NOT NULL UNIQUE,
  upstream_url  TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_keys (
  id                 SERIAL PRIMARY KEY,
  name               TEXT NOT NULL,
  key_prefix         TEXT NOT NULL,
  key_hash           TEXT NOT NULL UNIQUE,
  service_id         INTEGER REFERENCES services(id) ON DELETE SET NULL,
  rate_limit_per_min INTEGER NOT NULL DEFAULT 60,
  revoked            BOOLEAN NOT NULL DEFAULT false,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at       TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS usage_logs (
  id           BIGSERIAL PRIMARY KEY,
  key_id       INTEGER NOT NULL,
  service_slug TEXT NOT NULL,
  method       TEXT NOT NULL,
  path         TEXT NOT NULL,
  status       INTEGER NOT NULL,
  latency_ms   INTEGER NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS usage_logs_created_idx ON usage_logs (created_at);
CREATE INDEX IF NOT EXISTS usage_logs_key_idx ON usage_logs (key_id);

CREATE TABLE IF NOT EXISTS rate_buckets (
  key_id     INTEGER PRIMARY KEY,
  tokens     DOUBLE PRECISION NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`

async function main() {
  console.log("⏳ Creating tables…")
  await pool.query(SCHEMA)

  // Demo service (upstream is a path — resolved against the app's own origin)
  const svc = await pool.query(`SELECT id FROM services WHERE slug = 'demo'`)
  if (svc.rows.length === 0) {
    await pool.query(
      `INSERT INTO services (name, slug, upstream_url, description)
       VALUES ('Demo API', 'demo', '/api/demo', 'Bundled mock upstream: /users, /orders, /ping, /slow, /error, POST /echo')`,
    )
    console.log("✅ Registered the bundled 'demo' service (upstream /api/demo).")
  } else {
    console.log("ℹ️  'demo' service already registered.")
  }

  // Demo key — only if no keys exist at all
  const existing = await pool.query(`SELECT COUNT(*)::int AS item_count FROM api_keys`)
  if (existing.rows[0].item_count === 0) {
    const plainKey = `idp_live_${randomBytes(20).toString("hex")}`
    const keyHash = createHash("sha256").update(plainKey).digest("hex")
    await pool.query(
      `INSERT INTO api_keys (name, key_prefix, key_hash, service_id, rate_limit_per_min)
       VALUES ('demo key', $1, $2, NULL, 60)`,
      [plainKey.slice(0, 12), keyHash],
    )
    console.log("\n🔑 Demo API key (shown ONCE — only its hash is stored):\n")
    console.log(`   ${plainKey}\n`)
    console.log("   Try it:")
    console.log(`   curl -H "Authorization: Bearer ${plainKey}" http://localhost:3000/api/gateway/demo/users\n`)
  } else {
    console.log("ℹ️  API keys already exist — skipping demo key. Mint more in the portal.")
  }

  console.log("🎉 Setup complete. Run: npm run dev → http://localhost:3000")
  await pool.end()
}

main().catch((err) => {
  console.error("\n❌ Setup failed:", err.message)
  process.exit(1)
})
