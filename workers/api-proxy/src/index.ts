export interface Env {
    ORIGIN_HOST: string;
}

function getOriginUrl(request: Request, originHost: string) {
    const originUrl = new URL(request.url);

    originUrl.protocol = "https:";
    originUrl.host = originHost;

    return originUrl;
}

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        const originUrl = getOriginUrl(request, env.ORIGIN_HOST);
        const originRequest = new Request(originUrl, request);

        // The origin must receive its own host, not the public Cloudflare hostname.
        originRequest.headers.delete("host");

        try {
            const originResponse = await fetch(originRequest);
            const headers = new Headers(originResponse.headers);

            // API, OAuth, billing, and SSE responses are all dynamic and private.
            headers.set("Cache-Control", "no-store");

            return new Response(originResponse.body, {
                status: originResponse.status,
                statusText: originResponse.statusText,
                headers,
            });
        } catch (error) {
            console.error("Unable to reach API origin", {
                message: error instanceof Error ? error.message : String(error),
                origin: originUrl.origin,
            });

            return Response.json(
                { error: "API origin is unavailable" },
                { status: 502, headers: { "Cache-Control": "no-store" } },
            );
        }
    },
} satisfies ExportedHandler<Env>;
