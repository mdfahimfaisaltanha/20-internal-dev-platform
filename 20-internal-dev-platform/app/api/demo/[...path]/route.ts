export const runtime = "nodejs"

/**
 * Bundled demo upstream so the gateway works with zero external services.
 * Registered by `npm run setup` as the "demo" service (upstream "/api/demo").
 *
 * Endpoints:
 *   GET /users            list users
 *   GET /users/:id        one user (404 if unknown)
 *   GET /orders           list orders
 *   GET /ping             health check
 *   GET /slow             responds after 3s (exercise latency metrics)
 *   GET /error            always 500 (exercise error handling)
 *   POST /echo            echoes the JSON body back
 */

const USERS = [
  { id: 1, name: "Ayaan Rahman", email: "ayaan@example.com", plan: "pro" },
  { id: 2, name: "Fatima Khan", email: "fatima@example.com", plan: "free" },
  { id: 3, name: "Daniel Chen", email: "daniel@example.com", plan: "pro" },
  { id: 4, name: "Sofia Garcia", email: "sofia@example.com", plan: "enterprise" },
]

const ORDERS = [
  { id: 101, userId: 1, total: 49.99, status: "completed" },
  { id: 102, userId: 2, total: 129.5, status: "pending" },
  { id: 103, userId: 1, total: 15.0, status: "completed" },
  { id: 104, userId: 4, total: 890.0, status: "completed" },
]

type Ctx = { params: { path: string[] } }

export async function GET(_req: Request, { params }: Ctx) {
  const [head, id] = params.path

  switch (head) {
    case "users":
      if (id !== undefined) {
        const user = USERS.find((u) => u.id === Number(id))
        return user
          ? Response.json(user)
          : Response.json({ error: "User not found." }, { status: 404 })
      }
      return Response.json({ users: USERS })
    case "orders":
      return Response.json({ orders: ORDERS })
    case "ping":
      return Response.json({ ok: true, at: new Date().toISOString() })
    case "slow":
      await new Promise((r) => setTimeout(r, 3000))
      return Response.json({ ok: true, delayedMs: 3000 })
    case "error":
      return Response.json({ error: "Intentional demo failure." }, { status: 500 })
    default:
      return Response.json({ error: `Unknown demo endpoint "/${params.path.join("/")}".` }, { status: 404 })
  }
}

export async function POST(req: Request, { params }: Ctx) {
  if (params.path[0] === "echo") {
    const body = await req.json().catch(() => null)
    return Response.json({ echoed: body, receivedAt: new Date().toISOString() })
  }
  return Response.json({ error: "Unknown demo endpoint." }, { status: 404 })
}
