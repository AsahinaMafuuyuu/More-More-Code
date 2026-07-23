import {createClerkClient} from "@clerk/backend";

if (!process.env.CLERK_SECRET_KEY) {
    throw new Error("CLERK_SECRET_KEY is not set in the environment variables.");
}

if (!process.env.CLERK_PUBLISHABLE_KEY) {
    throw new Error("CLERK_PUBLISHABLE_KEY is not set in the environment variables.");
}

const clerkClient = createClerkClient({
    secretKey: process.env.CLERK_SECRET_KEY,
    publishableKey: process.env.CLERK_PUBLISHABLE_KEY,
})

export async function authenticateOAuthRequest(request: Request) {
    const requestState = await clerkClient
    .authenticateRequest(
        request,
        {
            acceptsToken: "oauth_token"
        }
    );

    if (!requestState.isAuthenticated) {
        return null;
    }

    const auth = requestState.toAuth();
    if (auth.tokenType !== "oauth_token" || !auth.userId) {
        return null;
    }

    return {
        userId: auth.userId,
    }
}