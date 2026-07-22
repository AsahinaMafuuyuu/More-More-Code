import { resolve, relative, dirname } from "path";
import { readFile } from "fs/promises";
import { tool } from "ai";
import { z } from "zod";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export function createReadFileTool(cwd: string) {
    return tool({
        description:
            "Read the contents of a file in the project.\
             Returns the file's content as a string.\
             truncated if the file exceeds 10MB.",
        inputSchema: z.object({
            path: z.string().describe("Relative path to the file to read"),
        }),
        execute: async ({ path }) => {
            const resolved = resolve(cwd, path);
            const rel = relative(cwd, resolved); // 相对于项目根目录的路径

            // 检查路径是否在项目目录之外
            if (rel.startsWith("..") ||
                resolve(resolved) !== resolved && rel.startsWith("..")) {
                return { error: "Path is outside the project directory" };
            }

            // 确保路径在项目目录内
            if (!resolved.startsWith(cwd)) {
                return {
                    error: "Path is outside the project directory"
                }
            }
            try {
                const content = await readFile(resolved, "utf-8");
                if (content.length > MAX_FILE_SIZE) {
                    return {
                        content: content.slice(0, MAX_FILE_SIZE),
                        truncated: true,
                        totalLength: content.length
                    }
                }
                return {
                    content
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return {
                    error: `Failed to read file: ${message}`
                }
            }
        }
    });
}



inputSchema: {
    path: {
        type: "string",
        description: "Relative path to the file to read"
    }
}