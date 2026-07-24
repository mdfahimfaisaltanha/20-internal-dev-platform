# Gateway curl examples

Replace `$KEY` with the key printed by `npm run setup` (or one minted in the portal), and `$HOST` with `http://localhost:3000` or your deployed URL.

```bash
KEY=idp_live_...
HOST=http://localhost:3000
```

## Happy path

```bash
# List users through the gateway (Bearer style)
curl -s -H "Authorization: Bearer $KEY" $HOST/api/gateway/demo/users | jq

# Same, x-api-key style
curl -s -H "x-api-key: $KEY" $HOST/api/gateway/demo/users/1 | jq

# POST passes the body through
curl -s -X POST -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d '{"hello":"gateway"}' $HOST/api/gateway/demo/echo | jq

# Rate-limit headers on every response
curl -si -H "Authorization: Bearer $KEY" $HOST/api/gateway/demo/ping | grep -i x-ratelimit
```

## Auth failures

```bash
# 401 — no key
curl -si $HOST/api/gateway/demo/users | head -1

# 401 — invalid key
curl -si -H "x-api-key: idp_live_deadbeef" $HOST/api/gateway/demo/users | head -1

# 403 — after revoking the key in the portal
curl -si -H "x-api-key: $KEY" $HOST/api/gateway/demo/users | head -1
```

## Rate limiting demo

Mint a key with a low limit (e.g. 5 req/min) in the portal, then:

```bash
for i in $(seq 1 8); do
  curl -s -o /dev/null -w "%{http_code} " -H "x-api-key: $LOW_LIMIT_KEY" $HOST/api/gateway/demo/ping
done; echo
# → 200 200 200 200 200 429 429 429

# Inspect Retry-After on a 429
curl -si -H "x-api-key: $LOW_LIMIT_KEY" $HOST/api/gateway/demo/ping | grep -iE "retry-after|x-ratelimit"
```

## Upstream failure handling

```bash
# Upstream 500 is relayed as-is (and logged)
curl -si -H "x-api-key: $KEY" $HOST/api/gateway/demo/error | head -1

# Slow upstream (3s) — watch x-gateway-latency-ms
curl -si -H "x-api-key: $KEY" $HOST/api/gateway/demo/slow | grep -i x-gateway-latency

# Unknown service → 404
curl -si -H "x-api-key: $KEY" $HOST/api/gateway/nope/users | head -1
```

## Docs

```bash
# Live OpenAPI spec (generated from the service registry)
curl -s $HOST/api/openapi.json | jq '.info, (.paths | keys)'
```

Human-readable docs: open `$HOST/docs` in a browser.
