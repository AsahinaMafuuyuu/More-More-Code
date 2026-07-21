// **glob** – Find files matching a pattern (e.g. "**/*.ts")
import { resolve, relative } from 'path';
import { tool } from "ai";
import z from "zod";
import { error } from 'console';


const MAX_RESULTS = 200;

export function createGlobTool(cwd: string) {
    return tool({
        description:
            "Find files matching a glob pattern. \
            Returns file paths relative to the project root.\
            Skips node_modules and hidden directories.",
        inputSchema: z.object({
            pattern: z
                .string()
                .describe("Glob pattern to match files (e.g. '**/*.ts')"),
            path: z
                .string()
                .describe("Relative directory to search in (defaults to project root)")
                .default("."),
        }),
        execute: async ({ pattern, path }) => {
            const resolved = resolve(cwd, path);

            if (!resolved.startsWith(cwd)) {
                return {
                    error: "Path is outside the project directory"
                }
            }

            // 使用 glob 库来查找匹配的文件
            try {
                const glob = new Bun.Glob(pattern)
                const files: string[] = []; // 匹配的文件列表

                let truncated = false; // 是否截断

                for await (const match of glob.scan({
                    cwd: resolved,
                    dot: false,
                    onlyFiles: true,
                })) {
                    // 跳过node_modules
                    //TODO:后期改进一下，可以读取 .gitignore 文件来忽略文件
                    if (match.includes("node_modules")) {
                        continue;
                    }

                    if (files.length >= MAX_RESULTS) {
                        truncated = true; // 表示已经截断了
                        break;
                    }

                    const absolutePath = resolve(resolved, match);
                    files.push(relative(cwd, absolutePath)); // 将绝对路径转换为相对于项目根目录的路径
                }

                files.sort(); // 按字母顺序排序

                return {
                    files,
                    ...(truncated ? {
                        truncated: true,
                    } : {})
                }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                return {
                    error: `Failed to execute glob search: ${message}`
                }
            }
        }
    })
}