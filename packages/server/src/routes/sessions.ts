import { Hono } from "hono";
// import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator"
import * as Sentry from "@sentry/hono/bun"
import { z } from "zod";
import { findSupportedChatModel } from "@more-more-code/shared";
import { db } from "@more-more-code/database/client"
import { Role, Mode, MessageStatus } from "@more-more-code/database/enums";
import { requireAuth, type AuthenticatedEnv } from "../../middleware/require-auth";


// 用来模拟数据
// type MockMessage = {
//     id: string;
//     role: string;
//     content: string;
//     mode: string;
//     model: string;
//     status: string;
//     parts: null;
//     duration: null;
//     createdAt: string;
//     sessionId: string;
// };

// type MockSession = {
//     id: string;
//     title: string;
//     cwd: string | null;
//     userId: string;
//     createdAt: string;
//     messages: MockMessage[];
// };

// const sessions: MockSession[] = []
// let nextId = 1;

// 首次创建对话时，传入的参数
const createSessionSchema = z.object({
    title: z.string(),
    cwd: z.string().optional(),
    initialMessage: z.object({
        role: z.enum(Role),
        content: z.string(),
        mode: z.enum(Mode),
        model: z.string().refine((id) => {
            return !!findSupportedChatModel(id)
        }, "Unsupported model")
    }).optional(),
})

const createSessionValidator = zValidator(
    "json",
    createSessionSchema,
    (result, c) => {
        if (!result.success) {
            Sentry.logger.warn("Session creation validation failed", {
                path: c.req.path,
                issues: result.error.issues.length,
            })

            return c.json({
                error: "Validation error",
                issues: result.error.issues,
            }, 400)
        }
    },
);

const app = new Hono<AuthenticatedEnv>()
    .use("*", requireAuth) // 需要身份验证
    .get('/', async (c) => {
        const userId = c.get("userId");
        const sessions = await db.session.findMany({
            where: {
                userId,
            },
            orderBy: { createdAt: "desc" },
            select: {
                id: true,
                title: true,
                createdAt: true,
            }
        })

        Sentry.logger.info("Listed sessions", {
            count: sessions.length,
        })

        return c.json(sessions);
    })
    .get("/:id", async (c) => {
        // // 模拟耗时
        // await new Promise(resolve => setTimeout(resolve, 5000));

        // // 模拟错误
        // throw new HTTPException(500, { message: "Internal Server Error" });

        const id = c.req.param("id");
        const userId = c.get("userId");
        const session = await db.session.findUnique({
            where: {
                id,
                userId,
            },
            include: {
                messages: {
                    orderBy: {
                        createdAt: "asc",
                    }
                }
            }
        })

        if (!session) {
            Sentry.logger.warn("Session not found", {
                sessionId: id,
                userId: userId
            })
            return c.json({ error: "Session not found" }, 404);
        }

        Sentry.logger.info("Retrieved session", {
            sessionId: id,
            userId: userId
        })

        return c.json(session);
    })
    // post主要就是创建一个session
    .post("/", createSessionValidator, async (c) => {
        // // 模拟耗时
        // await new Promise(resolve => setTimeout(resolve, 5000));

        // // 模拟错误
        // throw new HTTPException(500, { message: "Internal Server Error" });
        const userId = c.get("userId");
        const { initialMessage, ...data } = c.req.valid('json')
        const session = await db.session.create({
            data: {
                ...data,
                userId: userId,
                ...(initialMessage && {
                    messages: {
                        create: {
                            ...initialMessage,
                            status: MessageStatus.COMPLETE,
                        }
                    }
                }),
            },
            include: {
                messages: true,
            },
        })

        Sentry.logger.info("Created session", {
            sessionId: session.id,
            title: session.title,
            cwd: session.cwd,
        })
        return c.json(session, 201);
    })
    ;

export default app;