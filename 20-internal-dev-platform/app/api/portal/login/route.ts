import { clearSessionCookie, isAuthed, setSessionCookie, verifyPassword } from "@/lib/auth"

export const runtime = "nodejs"

/** GET: session status. POST: sign in. DELETE: sign out. */

export async function GET() {
  return Response.json({ authed: isAuthed() })
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { password?: string }
  if (!process.env.ADMIN_PASSWORD) {
    return Response.json(
      { error: "ADMIN_PASSWORD is not configured on the server. Set it in .env.local." },
      { status: 500 },
    )
  }
  if (!body.password || !verifyPassword(body.password)) {
    return Response.json({ error: "Wrong password." }, { status: 401 })
  }
  setSessionCookie()
  return Response.json({ ok: true })
}

export async function DELETE() {
  clearSessionCookie()
  return Response.json({ ok: true })
}
