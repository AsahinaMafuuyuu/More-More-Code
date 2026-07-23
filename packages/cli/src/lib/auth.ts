/**
 * 
 * 用于进行身份验证的工具函数，包括获取、保存和清除身份验证数据。
 */
import {
    existsSync,
    mkdirSync,
    readFileSync,
    writeFileSync,
    unlinkSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

type AuthData = {
    token: string;
};

const AUTH_DIR = join(homedir(), ".more-more-code");
const AUTH_FILE = join(AUTH_DIR, "auth.json");

// 从配置文件中获取身份验证数据，如果不存在或无效，则返回 null
export function getAuth(): AuthData | null {
    try {
        const data = readFileSync(AUTH_FILE, "utf-8");
        const parsed = JSON.parse(data) as Partial<AuthData>;
        return typeof parsed.token === "string"
            ? { token: parsed.token }
            : null;
    } catch (error) {
        return null;
    }
}

// 保存身份验证数据到配置文件中，如果目录不存在，则创建目录，并设置适当的权限
export function saveAuth(data: AuthData) {
    if (!existsSync(AUTH_DIR)) {
        mkdirSync(AUTH_DIR, {mode: 0o700}); // 创建目录并设置权限为 700
    }
    // 写入文件并设置权限为 600
    writeFileSync(AUTH_FILE, JSON.stringify(data), {mode: 0o600}); 
}

// 清除身份验证数据，从配置文件中删除身份验证信息
export function clearAuth() {
    try {
        unlinkSync(AUTH_FILE); // 删除文件
    } catch (error) {
        // Ignore errors
    }
}