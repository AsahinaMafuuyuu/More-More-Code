import type { ModeType } from "@more-more-code/shared";
import type { AgentEnvironment } from "./agent-environment";
import { renderSkillCatalog } from "./skill-registry";

export const SYSTEM_PROMPT_VERSION = "2";

function corePrompt(mode: ModeType) {
    const modeInstructions = mode === "PLAN"
        ? `## Current mode: PLAN
- Analyze the repository and produce a concrete implementation direction.
- Use read-only native tools, including loadSkill when a listed workflow is relevant.
- Do not modify project files or run commands whose purpose is mutation.`
        : `## Current mode: BUILD
- Implement the requested change in the workspace.
- Read before editing, keep changes scoped, and run focused tests/typechecks/builds when appropriate.
- If a tool or command fails, diagnose the actual failure instead of repeatedly retrying the same action.`;

    return `You are MORE-MORE-CODE, a coding agent operating directly inside the user's current workspace.

Work toward the user's requested outcome, not merely an explanation. Inspect relevant code before making assumptions, use tools when evidence is needed, preserve unrelated user changes, and verify meaningful edits before claiming completion. Never invent tool results or say an action succeeded unless it actually did.

Keep the implementation focused. Prefer existing project conventions over introducing parallel abstractions. When a task exposes an architectural decision, make the boundary explicit instead of hiding it inside unrelated code.

${modeInstructions}

## Tools and skills
Tools are executable capabilities; skills are reusable workflows and instructions. Native tools are available by default according to the current mode. MCP servers may extend the tool set when an MCP runtime exposes them; do not assume a configured MCP server has usable tools unless those tools are actually present.

Only skill metadata is preloaded. When a listed skill clearly applies, call the native \`loadSkill\` tool with its name before following that workflow. Do not treat a skill as an executable tool.`;
}

export function getPromptPrefixSources(environment: AgentEnvironment) {
    const globalInstructions = environment.instructions
        .filter((instruction) => instruction.scope === "global")
        .map((instruction) => instruction.content)
        .join("\n\n");
    const projectInstructions = environment.instructions
        .filter((instruction) => instruction.scope === "project")
        .map((instruction) => instruction.content)
        .join("\n\n");
    const skillCatalog = renderSkillCatalog(environment.skills.list());

    return { globalInstructions, projectInstructions, skillCatalog };
}

export function buildSystemPrompt({
    mode,
    environment,
}: {
    mode: ModeType;
    environment: AgentEnvironment;
}) {
    const { globalInstructions, projectInstructions, skillCatalog } = getPromptPrefixSources(environment);
    const parts: string[] = [corePrompt(mode)];

    if (globalInstructions) {
        parts.push(`## Global instructions\n${globalInstructions}`);
    }
    if (projectInstructions) {
        parts.push(`## Project instructions\n${projectInstructions}`);
    }

    parts.push(`## Available skills\n${skillCatalog}`);
    return parts.join("\n\n");
}
