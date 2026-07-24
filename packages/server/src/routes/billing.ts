import { Hono } from "hono";
import { requireAuth, type AuthenticatedEnv } from "../middleware/require-auth";
import { createCheckoutUrl, createCustomerPortalUrl } from "../lib/polar";

const app = new Hono<AuthenticatedEnv>()
    .use("/checkout", requireAuth)
    .use("/portal", requireAuth)
    .post('/checkout', async (c) => {
        const userId = c.get("userId");
        return c.json({
            url: await createCheckoutUrl({
                customerExternalId: userId,
                requestUrl: c.req.url
            })
        })
    })
    .post("/portal", async (c) => {
        const userId = c.get("userId");

        return c.json({
            url: await createCustomerPortalUrl({
                customerExternalId: userId,
                requestUrl: c.req.url
            })
        })
    })
    .get("/success", async (c) => {
        return c.text("Thank you for your purchase!\
             You can now return to More More Code and continue using it.")
    })
    .get("/portal", async (c) => {
        return c.text("You have returned from the billing portal.\
             You can now return to More More Code and continue using it.")
    })

export default app;