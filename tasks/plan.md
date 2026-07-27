# Implementation Plan: Cloudflare Edge Proxy for the API

## Overview

Expose the Railway-hosted Hono API through a user-owned Cloudflare hostname. A
Cloudflare Worker will proxy every dynamic API request to the existing Railway
origin without caching responses. The CLI will use the Cloudflare hostname via
`API_URL`; Railway remains the application origin.

## Architecture Decisions

- Use a Cloudflare Worker rather than a proxied CNAME directly to Railway. The
  Worker controls the origin host, preserves streaming responses, and does not
  require Railway to accept the public hostname as its origin `Host` header.
- Disable caching for every request. Sessions, billing, OAuth callbacks, and
  chat SSE responses are all user-specific or streaming.
- Keep the Railway public hostname private to configuration. The Worker reads
  it from a non-secret `ORIGIN_HOST` environment variable.

## Task List

### Phase 1: Prerequisites

- [x] Task 1: Confirm the Cloudflare zone and hostname to expose:
  `api.asahinamafuyu.top`.
- [x] Task 2: Authenticate Wrangler to the Cloudflare account and verify it
  can deploy Workers to `api.asahinamafuyu.top`.

### Phase 2: Edge Proxy

- [x] Task 3: Add the Worker project and Wrangler configuration.
- [x] Task 4: Implement transparent method, query, header, and response-stream
  proxying to the Railway origin with caching disabled.
- [x] Task 4a: Add an explicit public API URL for Polar redirect URLs so they
  use the edge hostname rather than the Railway origin.
- [x] Task 5: Deploy the Worker with `ORIGIN_HOST` set to
  `more-more-codeserver-production.up.railway.app`.

### Checkpoint: Edge Proxy

- [x] `GET /` through the Cloudflare hostname returns the origin's `404`.
- [x] Authenticated `GET /sessions` returns the same result through both
  public hostnames.
- [ ] Chat SSE responses are streamed rather than buffered.

### Phase 3: Client and OAuth Cutover

- [ ] Task 6: Set local CLI `API_URL` to the Cloudflare hostname.
- [ ] Task 7: Add `https://<hostname>/auth/callback` to Clerk's permitted OAuth
  redirect URLs.
- [ ] Task 8: Validate `/login`, `/usage`, `/upgrade`, and a credited chat
  request end to end.

### Checkpoint: Complete

- [ ] The CLI operates through Cloudflare without a Railway-specific URL.
- [ ] No dynamic endpoint is cached.
- [ ] Railway remains reachable directly for operational recovery.

## Risks and Mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Region cannot reach Cloudflare | High | Test from target networks before cutover; keep the Railway origin as a fallback. |
| Caching an authenticated or SSE response | High | Set `Cache-Control: no-store` and do not use Cloudflare cache options. |
| OAuth callback mismatch | High | Change the Clerk allowlist and CLI `API_URL` together. |
| Worker cannot reach the origin | Medium | Keep `ORIGIN_HOST` configurable and validate with a non-authenticated route first. |

## Open Questions

- Is the aim only better connectivity from restricted networks, or an official
  deployment for a regulated region? The latter may require regional hosting
  and compliance work beyond an edge proxy.
