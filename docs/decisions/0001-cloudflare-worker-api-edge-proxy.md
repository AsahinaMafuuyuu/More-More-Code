# ADR-0001: Use a Cloudflare Worker as the API Edge Proxy

## Status

Accepted

## Date

2026-07-27

## Context

The CLI currently calls a Railway public domain directly. Some client networks
cannot establish direct connections to that domain but can use an HTTP proxy.
The API serves authenticated session data, Polar billing actions, OAuth
callbacks, and streaming chat responses. These responses must not be cached.

We need a stable user-owned public hostname and an edge layer that forwards
dynamic traffic to Railway without changing the Hono application's routing.

## Decision

Use a Cloudflare Worker bound to a user-owned API hostname. The Worker will
proxy all requests to the Railway origin, preserve request methods, query
strings, headers, and streaming response bodies, and set `Cache-Control:
no-store` on proxied responses.

The CLI will use the Cloudflare hostname through `API_URL`. Clerk's allowed
OAuth redirect URL will use the same hostname and `/auth/callback` path.
Railway remains the origin and is not replaced by Cloudflare hosting.

## Alternatives Considered

### Direct Railway Access

- Pros: No additional infrastructure.
- Cons: Not reachable from every target network.
- Rejected: Does not satisfy the connectivity requirement.

### Proxied CNAME Directly to Railway

- Pros: Less code and no Worker runtime.
- Cons: Origin host handling and Railway custom-domain configuration must be
  coordinated; it gives less control over cache and forwarding behaviour.
- Rejected: A Worker makes the proxy contract explicit and keeps the Railway
  origin hostname configurable.

### Regional Origin Deployment Only

- Pros: Can improve latency and availability in a target region.
- Cons: Requires a second deployment, data and authentication considerations,
  and potentially regional compliance work.
- Rejected for now: Larger operational scope than adding an edge proxy.

## Consequences

- A Cloudflare zone, API hostname, and Worker deployment authority are
  required.
- API traffic incurs Worker usage and should be monitored for limits.
- Cloudflare availability in a target region is not guaranteed; client network
  and compliance requirements still determine reachability.
- OAuth configuration must be updated during the client cutover.
