import { readFile } from "fs/promises";
import { join } from "path";
import type { AgentConfigBundle, ConfigScope } from "./agent-config";

export type ResolvedInstruction = {
    scope: ConfigScope;
    path: string;
    content: string;
};

async function readInstruction(scope: ConfigScope, path: string): Promise<ResolvedInstruction | null> {
    try {
        const content = (await readFile(path, "utf-8")).trim();
        if (!content) return null;
        return { scope, path, content };
    } catch (error) {
        const code = error instanceof Error && "code" in error
            ? String((error as NodeJS.ErrnoException).code)
            : null;
        if (code === "ENOENT") return null;
        throw error;
    }
}

export async function resolveInstructionChain(
    config: AgentConfigBundle,
): Promise<ResolvedInstruction[]> {
    const globalFile = config.global.instructions?.file ?? "AGENTS.md";
    const projectFile = config.project.instructions?.file ?? "AGENTS.md";

    const [globalInstruction, projectInstruction] = await Promise.all([
        readInstruction("global", join(config.paths.globalDir, globalFile)),
        readInstruction("project", join(config.paths.projectDir, projectFile)),
    ]);

    return [globalInstruction, projectInstruction].filter(
        (entry): entry is ResolvedInstruction => entry !== null,
    );
}

export function renderInstructionChain(instructions: readonly ResolvedInstruction[]) {
    if (instructions.length === 0) return "";

    return instructions
        .map((instruction) => {
            const title = instruction.scope === "global"
                ? "Global instructions"
                : "Project instructions";
            return `### ${title}\nSource: ${instruction.path}\n\n${instruction.content}`;
        })
        .join("\n\n");
}
