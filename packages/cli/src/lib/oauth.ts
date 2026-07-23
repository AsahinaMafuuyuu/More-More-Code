import open from "open"
import { saveAuth } from "./auth"
import { ur } from "zod/v4/locales";
import { decode } from "zod";

const LOGIN_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

type OAuthState = {
    nonce: string; // 用于防止CSRF攻击的随机字符串
    port: number; // 用于本地服务器监听的端口号
}

function toBase64Url(input: Uint8Array | string) {
    return Buffer.from(input).toString("base64url"); // 使用 base64url 编码
}

async function createPkceChallenge(verifier: string) { // 生成 PKCE challenge
    const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(verifier)
    );
    return toBase64Url(new Uint8Array(digest));
}

function encodeState(state: OAuthState) {
    return toBase64Url(JSON.stringify(state)); // 将 state 对象转换为 JSON 字符串并进行 base64url 编码
}

function decodeState(encodedState: string): OAuthState {
    const [encoded] = encodedState.split("."); // 分割编码后的 state 字符串
    if (!encoded) {
        throw new Error("Invalid state format");
    }
    return JSON
        .parse(Buffer
            .from(encoded, "base64url")
            .toString()
        ) as OAuthState; // 解码并解析为 OAuthState 对象
}

function getErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error); // 获取错误信息 
}

export async function performLogin() {
    const clerkFrontendApi = process.env.CLERK_FRONTEND_API;
    const clientId = process.env.CLERK_OAUTH_CLIENT_ID;
    const apiUrl = process.env.API_URL ?? "http://localhost:3000";

    if (!clerkFrontendApi) {
        throw new Error("CLERK_FRONTEND_API is not set in the environment variables.");
    }

    if (!clientId) {
        throw new Error("CLERK_OAUTH_CLIENT_ID is not set in the environment variables.");
    }

    const nonce = crypto.randomUUID(); // 生成随机的 nonce
    const codeVerifier = toBase64Url(
        crypto.getRandomValues(new Uint8Array(32))
    ); // 生成随机的 code verifier
    const codeChallenge = await createPkceChallenge(codeVerifier); // 生成 code challenge

    let settled = false; // 标记是否已经处理过回调

    return new Promise<{ token: string }>((resolve, reject) => {
        const server = Bun.serve({
            port: 0, // 使用随机端口
            fetch: async (request) => {
                const url = new URL(request.url);

                if (url.pathname !== "/callback") {
                    return new Response("Not Found", { status: 404 });
                }

                const error = url.searchParams.get("error");
                if (error) {
                    const msg = url
                        .searchParams
                        .get("error_description") ?? error;

                    settled = true;
                    reject(new Error(`OAuth error: ${msg}`));
                    setTimeout(() => server.stop(), 500); // 停止服务器
                    return new Response(
                        `Authentication failed: ${msg}.\
                         You can close this window.`, { status: 400 });
                }

                const code = url.searchParams.get("code"); // 获取授权码
                const state = url.searchParams.get("state"); // 获取 state 参数

                if (!code || !state) {
                    settled = true;
                    reject(new Error("Missing code or state."));
                    setTimeout(() => server.stop(), 500); // 停止服务器
                    return new Response(
                        "Bad Request: Missing code or state.\
                         You can close this window.",
                        { status: 400 }
                    );
                }

                try {
                    const payload = decodeState(state); // 解码 state 参数
                    if (payload.nonce !== nonce) throw new Error(
                        "State mismatch. Potential CSRF attack."
                    )
                } catch (error) {
                    settled = true;
                    reject(error)
                    setTimeout(() => server.stop(), 500); // 停止服务器
                    return new Response(
                        "Invalid state",
                        { status: 400 }
                    )
                }

                try {
                    const redirectUri = `${apiUrl}/auth/callback`;
                    const tokenResponse = await fetch(
                        `${clerkFrontendApi}/oauth/token`,
                        {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/x-www-form-urlencoded",
                            },
                            body: new URLSearchParams({
                                grant_type: "authorization_code",
                                code,
                                redirect_uri: redirectUri,
                                client_id: clientId,
                                code_verifier: codeVerifier,
                            })
                        })

                    if (!tokenResponse.ok) {
                        const details = await tokenResponse.text();
                        throw new Error(`Failed to exchange code for token: ${details}`);
                    }

                    const tokenData = (
                        await tokenResponse.json()) as
                        { access_token: string };

                    settled = true;
                    saveAuth({ token: tokenData.access_token }); // 保存 token
                    resolve({ token: tokenData.access_token });
                    setTimeout(() => server.stop(), 500); // 停止服务器
                    return new Response(
                        "Authentication successful! \
                        You can close this window.",
                        { status: 200 });
                } catch (error) {
                    settled = true;
                    reject(error);
                    const message = getErrorMessage(error);
                    setTimeout(() => server.stop(), 500); // 停止服务器
                    return new Response(
                        `Authentication failed: ${message}. `,
                        { status: 400 }
                    )
                }
            }
        });

        const port = server.port;
        if (typeof port !== "number") {
            server.stop();
            reject(new Error(
                "Failed to start callback server. Port is not a number."
            ))
            return;
        }

        const state = encodeState({
            port,
            nonce,
        })

        const redirectUri = `${apiUrl}/auth/callback`;
        const authorizeUrl = new URL(`${clerkFrontendApi}/oauth/authorize`);

        authorizeUrl.searchParams.set("response_type", "code");
        authorizeUrl.searchParams.set("client_id", clientId);
        authorizeUrl.searchParams.set("redirect_uri", redirectUri);
        authorizeUrl.searchParams.set("scope", "openid profile email");
        authorizeUrl.searchParams.set("state", state);
        authorizeUrl.searchParams.set("prompt", "login");
        authorizeUrl.searchParams.set("code_challenge", codeChallenge);
        authorizeUrl.searchParams.set("code_challenge_method", "S256");

        void open(authorizeUrl.toString()); // 打开浏览器进行登录

        setTimeout(() => {
            if (!settled) {
                settled = true;
                server.stop();
                reject(new Error("Login timed out."));
            }
        }, LOGIN_TIMEOUT_MS)
    });
}