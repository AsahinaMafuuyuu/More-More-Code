import { Hono } from "hono";
// import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator"
import * as Sentry from "@sentry/hono/bun"
import { z } from "zod";
import { db } from "@more-more-code/database/client"
import type { Prisma } from "@more-more-code/database";

import { requireAuth, type AuthenticatedEnv } from "../middleware/require-auth";



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

const persistMessagesSchema = z.object({
    messages: z.array(z.unknown()),
});

const persistMessagesValidator = zValidator(
    "json",
    persistMessagesSchema,
    (result, c) => {
        if (!result.success) {
            return c.json({ error: "Invalid session messages" }, 400);
        }
    },
);

const legacySessionStateSchema = z.object({
    version: z.literal(1),
    rootNodeId: z.string(),
    activeNodeId: z.string(),
    nodes: z.array(z.object({
        id: z.string(),
        parentId: z.string().nullable(),
        createdAt: z.number(),
        messages: z.array(z.unknown()),
        runId: z.string().optional(),
        inputMessageId: z.string().optional(),
    })),
});

const eventBackedSessionStateSchema = z.object({
    version: z.literal(2),
    rootNodeId: z.string(),
    activeNodeId: z.string(),
    nodes: z.array(z.object({
        id: z.string(),
        parentId: z.string().nullable(),
        createdAt: z.number(),
        eventIds: z.array(z.string()),
        runId: z.string().optional(),
        inputMessageId: z.string().optional(),
    })),
    events: z.array(z.object({
        id: z.string(),
        nodeId: z.string(),
        kind: z.literal("message-upsert"),
        messageId: z.string(),
        createdAt: z.number(),
        message: z.unknown(),
    })),
});

const sessionEntryMetadataSchema = {
    runId: z.string().optional(),
    turnId: z.string().optional(),
    stepId: z.string().optional(),
    inputMessageId: z.string().optional(),
};

const sessionEntryBaseSchema = {
    id: z.string(),
    parentId: z.string().nullable(),
    createdAt: z.number(),
    ...sessionEntryMetadataSchema,
};

const sessionEntrySchema = z.discriminatedUnion("type", [
    z.object({ ...sessionEntryBaseSchema, type: z.literal("session_start") }),
    z.object({
        ...sessionEntryBaseSchema,
        type: z.literal("user_message"),
        messageId: z.string(),
        message: z.unknown(),
    }),
    z.object({
        ...sessionEntryBaseSchema,
        type: z.literal("assistant_message"),
        messageId: z.string(),
        message: z.unknown(),
    }),
    z.object({
        ...sessionEntryBaseSchema,
        type: z.literal("custom_message"),
        messageId: z.string(),
        message: z.unknown(),
    }),
    z.object({
        ...sessionEntryBaseSchema,
        type: z.literal("message_update"),
        messageId: z.string(),
        message: z.unknown(),
    }),
    z.object({
        ...sessionEntryBaseSchema,
        type: z.literal("tool_call"),
        toolCallId: z.string(),
        toolName: z.string(),
        input: z.unknown(),
    }),
    z.object({
        ...sessionEntryBaseSchema,
        type: z.literal("tool_result"),
        toolCallId: z.string(),
        toolName: z.string().optional(),
        output: z.unknown().optional(),
        error: z.string().optional(),
    }),
    z.object({
        ...sessionEntryBaseSchema,
        type: z.literal("error"),
        message: z.string(),
        code: z.string().optional(),
        details: z.unknown().optional(),
    }),
    z.object({
        ...sessionEntryBaseSchema,
        type: z.literal("model_change"),
        model: z.string(),
        provider: z.string().optional(),
    }),
    z.object({
        ...sessionEntryBaseSchema,
        type: z.literal("mode_change"),
        mode: z.string(),
    }),
    z.object({
        ...sessionEntryBaseSchema,
        type: z.literal("config_change"),
        key: z.string(),
        value: z.unknown(),
        previousValue: z.unknown().optional(),
    }),
    z.object({
        ...sessionEntryBaseSchema,
        type: z.literal("compaction"),
        summary: z.unknown(),
        tokensBefore: z.number().optional(),
        compactedMessageIds: z.array(z.string()).optional(),
        retainedTailMessageIds: z.array(z.string()).optional(),
    }),
    z.object({
        ...sessionEntryBaseSchema,
        type: z.literal("branch_summary"),
        summary: z.unknown(),
    }),
    z.object({
        ...sessionEntryBaseSchema,
        type: z.literal("custom"),
        customType: z.string(),
        data: z.unknown(),
    }),
]);

const sessionEntryTreeStateSchema = z.object({
    version: z.literal(3),
    rootEntryId: z.string(),
    activeEntryId: z.string(),
    entries: z.array(sessionEntrySchema),
});

const persistStateSchema = z.object({
    state: z.union([
        legacySessionStateSchema,
        eventBackedSessionStateSchema,
        sessionEntryTreeStateSchema,
    ]),
});

const persistStateValidator = zValidator(
    "json",
    persistStateSchema,
    (result, c) => {
        if (!result.success) {
            return c.json({ error: "Invalid session state" }, 400);
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
    .post("/:id/state", persistStateValidator, async (c) => {
        const id = c.req.param("id");
        const userId = c.get("userId");
        const { state } = c.req.valid("json");

        const result = await db.session.updateMany({
            where: { id, userId },
            data: {
                messages: state as Prisma.InputJsonValue,
            },
        });

        if (result.count === 0) {
            return c.json({ error: "Session not found" }, 404);
        }

        return c.json({ success: true as const });
    })
    .post("/:id/messages", persistMessagesValidator, async (c) => {
        const id = c.req.param("id");
        const userId = c.get("userId");
        const { messages } = c.req.valid("json");

        const result = await db.session.updateMany({
            where: { id, userId },
            data: {
                messages: messages as Prisma.InputJsonValue,
            },
        });

        if (result.count === 0) {
            return c.json({ error: "Session not found" }, 404);
        }

        return c.json({ success: true as const });
    })
    // Server only creates and persists session state; it does not execute agents.
    .post("/", createSessionValidator, async (c) => {
        // // 模拟耗时
        // await new Promise(resolve => setTimeout(resolve, 5000));

        // // 模拟错误
        // throw new HTTPException(500, { message: "Internal Server Error" });
        const userId = c.get("userId");
        const data  = c.req.valid('json')
        const session = await db.session.create({
            data: {
                ...data,
                userId: userId,
            }
        })

        Sentry.logger.info("Created session", {
            sessionId: session.id,
            title: session.title,
        })
        return c.json(session, 201);
    })
    ;

export default app;