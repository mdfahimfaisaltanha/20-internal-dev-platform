import { createHash, timingSafeEqual } from "node:crypto"
import { cookies } from "next/headers"

/**
 * Minimal single-admin auth for the self-service portal.
 * The session cookie stores sha256("idp-session:" + ADMIN_PASSWORD), httpOnly.
 * Deliberately simple for a portfolio deploy; the README notes the upgrade
 * path (proper user table + NextAuth/OIDC) for multi-tenant use.
 */

const COOKIE_NAME = "idp_admin"

function sessionToken(): string {
  const password = process.env.ADMIN_PASSWORD
  if (!password) {
    throw new Error("ADMIN_PASSWORD is not set. Copy .env.example to .env.local and set it.")
  }
  return createHash("sha256").update(`idp-session:${password}`).digest("hex")
}

export function verifyPassword(password: string): boolean {
  const expected = Buffer.from(process.env.ADMIN_PASSWORD ?? "")
  const given = Buffer.from(password)
  return expected.length > 0 && expected.length === given.length && timingSafeEqual(expected, given)
}

export function setSessionCookie(): void {
  cookies().set(COOKIE_NAME, sessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 7,
    path: "/",
  })
}

export function clearSessionCookie(): void {
  cookies().delete(COOKIE_NAME)
}

export function isAuthed(): boolean {
  try {
    const value = cookies().get(COOKIE_NAME)?.value
    if (!value) return false
    const expected = sessionToken()
    const a = Buffer.from(value)
    const b = Buffer.from(expected)
    return a.length === b.length && timingSafeEqual(a, b)
  } catch {
    return false
  }
}

/** Guard helper for portal API routes. Returns a 401 Response or null. */
export function requireAuth(): Response | null {
  if (!isAuthed()) {
    return Response.json({ error: "Not signed in." }, { status: 401 })
  }
  return null
}
