import dotenv from "dotenv" // 从环境变量中加载环境变量
import { PrismaPg } from "@prisma/adapter-pg"
import { PrismaClient } from "../generated/prisma/client.ts"

const databaseUrl = process.env.DATABASE_URL; // 从环境变量中获取数据库连接字符串

if (!databaseUrl) {
    throw new Error("DATABASE_URL is not defined in the environment variables.");
}

const adapter = new PrismaPg({ connectionString: databaseUrl });   // 创建适配器

export const db = new PrismaClient({ adapter });