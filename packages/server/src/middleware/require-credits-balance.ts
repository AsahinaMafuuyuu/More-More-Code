import { createMiddleware } from "hono/factory";
import type { AuthenticatedEnv } from "../middleware/require-auth";
import { getAvailableCreditsBalance } from "../lib/polar";

export const requireCreditsBalance = createMiddleware<AuthenticatedEnv>(
    async (c, next) => {
        try {
            const userId = c.get("userId");
            const creditsBalance = await getAvailableCreditsBalance(userId);

            if (creditsBalance <= 0) {
                return c.json({
                    error: "Insufficient credits balance. \nRun /upgrade to add more credits."
                }, 402)
            }

            await next(); 
        } catch (error) {
            return c.json({
                error: "Unable to verify credits balance. \
                Please try again later."
            }, 503)
        }
    })