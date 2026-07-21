// **grep** – Search file contents with regex
import { resolve, relative } from 'path';
import { tool } from "ai";
import z from "zod";

const MAX_MATCHES = 50;

export function createGrepTool(cwd: string) {
    return tool({
        description:
            "Search file contents using a regex pattern. \
            Returns matching lines with file paths and line numbers. \
            Skips hidden directories, node_modules, and binary files.",
        inputSchema: z.object({
            pattern: z
                .string()
                .describe("Regex pattern to search for"),
            path: z
                .string()
                .describe("Relative directory to search in (defaults to project root)")
                .default("."),
            include: z
                .string()
                .describe("Glob pattern to filter files (e.g. '**/*.ts', '**/*.js')")
        }),
        execute: async ({ pattern, path, include }) => {
            const resolved = resolve(cwd, path);

            if (!resolved.startsWith(cwd)) {
                return {
                    error: "Path is outside the project directory"
                }
            }

            // 使用 Bun 的 grep 功能来搜索文件内容
            try {
                const args = [
                    "-rn", // 显示行号
                    "--color=never", // 禁用颜色输出
                    "--exclude-dir=node_modules", // 排除 node_modules 目录
                    "--exclude-dir=.git", // 排除 .git 目录
                    "-E", // 使用扩展正则表达式
                ]

                if (include) {
                    args.push(`--include=${include}`); // 添加文件过滤模式
                }

                args.push(pattern, resolved); // 添加搜索模式和路径

                const proc = Bun.spawn(["grep", ...args], {
                    stdout: "pipe",
                    stderr: "pipe",
                    cwd,
                });

                const stdout = await new Response(proc.stdout).text();
                const stderr = await new Response(proc.stderr).text();

                await proc.exited; // 等待进程结束

                if (proc.exitCode !== 0 && proc.exitCode !== 1) {
                    // grep 返回 1 表示没有匹配项
                    return {
                        error: `grep failed with exit code ${proc.exitCode}: ${stderr}`
                    }
                }

                if (!stdout.trim()) {
                    return {
                        matches: [],
                        message: "No matches found"
                    }
                }

                const lines = stdout.trim().split("\n"); // 按行分割输出
                const matches: { file: string, line: number, content: string }[] = [];
                let truncated = false; // 是否截断

                for (const line of lines) {
                    if (matches.length >= MAX_MATCHES) {
                        truncated = true;
                        break;
                    }

                    // grep output format: /absolute/path:linenum:content
                    const match = line.match(/^(.*?):(\d+):(.*)$/);
                    if (match) {
                        matches.push({
                            file: relative(cwd, match[1]!), // 转换为相对路径
                            line: parseInt(match[2]!, 10), // 行号
                            content: match[3]! // 匹配内容
                        })
                    }
                }

                return {
                    matches,
                    ...(truncated ? { truncated: true, totalMatches: lines.length } : {})
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