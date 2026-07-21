import { resolve, relative } from 'path';
import { readFile, writeFile } from 'fs/promises'

import { tool } from "ai";
import z from "zod";
import { error } from 'console';

/**
 * 由于编辑文件的任务时间可能比较长，因此的话这些常数可以省去
 */
// const MAX_OUTPUT = 20_000;
// const DEFAULT_TIMEOUT = 30_000

export function createEditFileTool(cwd: string) {
    return tool({
        description:
            "Make a targeted edit to a file by replacing an exact string match. \
            The oldString must appear exactly once in the file (for safety). \
            Use this for surgical edits instead of rewriting entire files.",
        inputSchema: z.object({
            path: z.string().describe("Relative path to the file to edit"),
            oldString: z
                .string()
                .describe("The exact text to find and replace (must be unique in the file)"),
            newString: z
                .string()
                .describe("The text to replace it with")
        }),
        execute: async ({ path, oldString, newString }) => {
            const resolved = resolve(cwd, path);

            if (!resolved.startsWith(cwd)) {
                return {
                    error: "Path is outside the project directory"
                }
            }

            // 读取文件，并且当中查找 oldString 的出现次数，如果出现次数不为 1，则返回错误

            try {
                const content = await readFile(resolved, "utf-8")

                const occurrence = content.split(oldString).length - 1

                if (occurrence === 0) {
                    return {
                        error: "oldString not found in file"
                    }
                }

                if (occurrence > 1) {
                    return {
                        error: `oldString is ambiguous - found ${occurrence} 
                        matches. Provide more surrounding context to make it unique.`
                    }
                }

                const updated = content.replace(oldString, newString);

                await writeFile(resolved, updated, "utf-8") // 写入文件

                return {
                    success: true as const,
                    path: relative(cwd, resolved),
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return {
                    error: `Failed to edit file: ${message}`
                }
            }
        }
    })
}