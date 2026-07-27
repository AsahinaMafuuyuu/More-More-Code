# Cloudflare API Proxy

This Worker exposes the Railway API on `api.asahinamafuyu.top` without caching
any response. It proxies to the hostname in `ORIGIN_HOST` and preserves the
request method, path, query string, body, and streamed response body.

## Deploy

From the repository root:

```powershell
bunx wrangler login
bun run cf:deploy
```

Cloudflare will create and manage the custom-domain route declared in
`wrangler.jsonc`. Confirm that the Cloudflare account owns the
`asahinamafuyu.top` zone before deploying.

## Service Configuration

After deployment, set these values together:

```env
# Local CLI environment
API_URL=https://api.asahinamafuyu.top

# Railway service environment
PUBLIC_API_URL=https://api.asahinamafuyu.top
```

Add this exact callback URL to the Clerk OAuth application's allowed redirect
URLs:

```text
https://api.asahinamafuyu.top/auth/callback
```

## Verification

```powershell
curl.exe -I --proxy http://127.0.0.1:7890 https://api.asahinamafuyu.top/
```

The expected response is `404 Not Found`, because the API has no `/` route. A
`502` means the Worker cannot reach the Railway origin.
