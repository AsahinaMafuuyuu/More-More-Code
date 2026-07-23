import { Hono } from "hono";

const app = new Hono().get('/callback', (c) => {
    const code = c.req.query('code');
    const state = c.req.query('state');
    const error = c.req.query('error');

    const errorDescription = c.req.query('error_description');

    if (error) {
        return c.text(errorDescription ?? error, 400);
    }

    if (!code || !state) {
        return c.text("Missing authorization code or state", 400)
    }

    try {
        const [encoded] = state.split('.');
        if (!encoded) {
            return c.text("Invalid state parameter", 400);
        }

        const payload = JSON
            .parse(Buffer
                .from(
                    encoded,
                    'base64url'
                )
                .toString()
            );

        const port = payload.port;

        if (!port || typeof port !== 'number') {
            throw new Error("Invalid port in state parameter");
        }

        const redirectUrl = `http://localhost:${port}/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;

        return c.redirect(redirectUrl);
    } catch (error) {
        return c.text(`An error occurred while processing the request: ${error}`, 500);
    }
});

export default app;