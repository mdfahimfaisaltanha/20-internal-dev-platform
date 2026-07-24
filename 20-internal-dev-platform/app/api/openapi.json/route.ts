import { getPool } from "@/lib/db"

export const runtime = "nodejs"

/**
 * OpenAPI 3.0 spec for the gateway, generated live from the service registry.
 * Every registered service contributes a wildcard proxy path; standard
 * gateway responses (401/403/404/413/429/502/504) are documented once and
 * referenced everywhere.
 */
export async function GET(req: Request) {
  const origin = new URL(req.url).origin
  const services = await getPool().query(
    `SELECT name, slug, description FROM services ORDER BY id`,
  )

  const errorRef = { $ref: "#/components/schemas/Error" }
  const stdResponses = {
    "401": { description: "Missing or invalid API key", content: { "application/json": { schema: errorRef } } },
    "403": { description: "Key revoked or not authorized for this service", content: { "application/json": { schema: errorRef } } },
    "404": { description: "Unknown service or upstream path", content: { "application/json": { schema: errorRef } } },
    "413": { description: "Request body over 2 MB", content: { "application/json": { schema: errorRef } } },
    "429": {
      description: "Rate limit exceeded. Check Retry-After and X-RateLimit-* headers.",
      headers: {
        "Retry-After": { schema: { type: "integer" }, description: "Seconds until a retry may succeed" },
        "X-RateLimit-Limit": { schema: { type: "integer" } },
        "X-RateLimit-Remaining": { schema: { type: "integer" } },
      },
      content: { "application/json": { schema: errorRef } },
    },
    "502": { description: "Upstream unreachable", content: { "application/json": { schema: errorRef } } },
    "504": { description: "Upstream timed out (15s)", content: { "application/json": { schema: errorRef } } },
  }

  const paths: Record<string, unknown> = {}
  for (const svc of services.rows) {
    const op = (method: string) => ({
      tags: [svc.name],
      summary: `Proxy ${method.toUpperCase()} to ${svc.name}`,
      description: svc.description || `Forwards the request to the "${svc.slug}" upstream after key auth and rate limiting.`,
      operationId: `${method}_${svc.slug}_proxy`,
      security: [{ ApiKeyAuth: [] }, { BearerAuth: [] }],
      parameters: [
        {
          name: "path",
          in: "path",
          required: true,
          schema: { type: "string" },
          description: "Upstream path, e.g. `users` or `users/1`",
        },
      ],
      responses: {
        "200": { description: "Upstream response, relayed with X-RateLimit-* and x-gateway-latency-ms headers" },
        ...stdResponses,
      },
    })
    paths[`/api/gateway/${svc.slug}/{path}`] = {
      get: op("get"),
      post: op("post"),
      put: op("put"),
      patch: op("patch"),
      delete: op("delete"),
    }
  }

  return Response.json({
    openapi: "3.0.3",
    info: {
      title: "Internal Developer Platform — API Gateway",
      version: "1.0.0",
      description:
        "All requests require an API key issued via the self-service portal. Send it as `Authorization: Bearer <key>` or `x-api-key: <key>`. Keys are rate-limited per minute with a token bucket.",
    },
    servers: [{ url: origin }],
    tags: services.rows.map((s) => ({ name: s.name, description: s.description || undefined })),
    paths,
    components: {
      securitySchemes: {
        ApiKeyAuth: { type: "apiKey", in: "header", name: "x-api-key" },
        BearerAuth: { type: "http", scheme: "bearer" },
      },
      schemas: {
        Error: {
          type: "object",
          properties: { error: { type: "string" } },
          required: ["error"],
        },
      },
    },
  })
}
