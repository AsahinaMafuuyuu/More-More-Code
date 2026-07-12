import { Hono } from "hono";
// import { HTTPException } from "hono/http-exception";
import { zValidator } from "@hono/zod-validator"
import { z } from "zod";
import { findSupportedChatModel } from "@more-more-code/shared";
import { db } from "@more-more-code/database"
import { Role, Mode, MessageStatus } from "@more-more-code/database/enums";


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
            return c.json({ error: "Invalid request body" }, 400);
        }
    },
);

const app = new Hono()
    .get('/', async (c) => {
        const sessions = await db.session.findMany({
            orderBy: { createdAt: "desc" },
            select: {
                id: true,
                title: true,
                createdAt: true,
            }
        })

        return c.json(sessions);
    })
    .get("/:id", async (c) => {
        // // 模拟耗时
        // await new Promise(resolve => setTimeout(resolve, 5000));

        // // 模拟错误
        // throw new HTTPException(500, { message: "Internal Server Error" });

        const id = c.req.param("id");
        const session = await db.session.findUnique({
            where: {
                id,
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
            return c.json({ error: "Session not found" }, 404);
        }

        return c.json(session);
    })
    .post("/", createSessionValidator, async (c) => {
        // // 模拟耗时
        // await new Promise(resolve => setTimeout(resolve, 5000));

        // // 模拟错误
        // throw new HTTPException(500, { message: "Internal Server Error" });

        const { initialMessage, ...data } = c.req.valid('json')
        const session = await db.session.create({
            data: {
                ...data,
                userId: "mock-user",
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
        return c.json(session, 201);
    })
    ;

export default app;