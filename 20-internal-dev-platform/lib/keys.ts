import { createHash, randomBytes, timingSafeEqual } from "node:crypto"

/**
 * API key lifecycle.
 *
 * Security model (README § "Key security"):
 * - Keys look like `idp_live_<40 hex chars>` — prefixed so they're greppable
 *   in leaked code and recognizable in secret scanners.
 * - Only the SHA-256 hash is stored. The plaintext is shown exactly once at
 *   creation. A leaked database does not leak usable keys.
 * - The first 12 characters are stored as a display prefix for identification.
 */

export function generateApiKey(): { plainKey: string; keyHash: string; keyPrefix: string } {
  const plainKey = `idp_live_${randomBytes(20).toString("hex")}`
  return {
    plainKey,
    keyHash: hashApiKey(plainKey),
    keyPrefix: plainKey.slice(0, 12),
  }
}

export function hashApiKey(plainKey: string): string {
  return createHash("sha256").update(plainKey).digest("hex")
}

/** Constant-time comparison of two hex hashes (avoids timing side-channels). */
export function hashesEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "hex")
  const bb = Buffer.from(b, "hex")
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

/** Extract the presented API key from Authorization: Bearer or x-api-key. */
export function extractApiKey(req: Request): string | null {
  const auth = req.headers.get("authorization")
  if (auth?.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim() || null
  }
  return req.headers.get("x-api-key")?.trim() || null
}
