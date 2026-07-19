import { Hono } from 'hono'
import { sentry } from '@sentry/hono/bun'
import { HTTPException } from 'hono/http-exception'
import sessions from './routes/sessions'
import chatRoute from './routes/chat'
import * as Sentry from "@sentry/hono/bun";

const app = new Hono()
app.onError((error, c) => {
    if (error instanceof HTTPException) {
        // 使用sentry来处理错误
        Sentry.logger.warn("Handle HTTP error", {
            status: error.status,
            message: error.message,
            path: c.req.path,
            method: c.req.method,
        })
    }
    console.error("Unhandled server error", error);
    return c.json({
        error: 'Internal Server Error',
    }, 500)
})

app.use(
    sentry(app, {
        dsn: "https://5cfdfda68037dbe4e5f348e57cd25921@o4511721705963520.ingest.us.sentry.io/4511721730670592",
        tracesSampleRate: 1.0,
        enableLogs: true,
        dataCollection: {
            // To disable sending user data and HTTP bodies, uncomment the lines below. For more info visit:
            // https://docs.sentry.io/platforms/javascript/guides/hono/configuration/options/#dataCollection
            // userInfo: false,
            // httpBodies: [],
        },
    }),
);

// 测试接口
app.get("/debug-sentry", () => {
  // Send a log before throwing the error
  Sentry.logger.info('User triggered test error', {
    action: 'test_error_endpoint',
  });
  // Send a test metric before throwing the error
  Sentry.metrics.count('test_counter', 1);
  throw new Error("My first Sentry error!");
});

// 将session中的路由逻辑挂载到/sessions下， 聊天逻辑挂载到/chat下
const routes = app.route("/sessions", sessions).route("/chat", chatRoute)

export type AppType = typeof routes
export default {
    port: 3000,
    fetch: app.fetch,
    idleTimeout: 255,
}