import { open, readFile, readdir } from "fs/promises";
import { join } from "path";
import type { AgentConfigBundle, ConfigScope } from "./agent-config";

export type SkillScope = "agents" | ConfigScope;

export type SkillDescriptor = {
    name: string;
    description: string;
    scope: SkillScope;
    path: string;
};

export type LoadedSkill = SkillDescriptor & {
    content: string;
};

function stripYamlValue(value: string) {
    const trimmed = value.trim();
    if (
        (trimmed.startsWith('"') && trimmed.endsWith('"'))
        || (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ) {
        return trimmed.slice(1, -1);
    }
    return trimmed;
}

function parseSkillMetadata(content: string, fallbackName: string) {
    const normalized = content.replace(/\r\n/g, "\n");
    if (!normalized.startsWith("---\n")) {
        return { name: fallbackName, description: "" };
    }

    const end = normalized.indexOf("\n---\n", 4);
    if (end < 0) return { name: fallbackName, description: "" };

    const frontmatter = normalized.slice(4, end);
    let name = fallbackName;
    let description = "";

    for (const line of frontmatter.split("\n")) {
        const separator = line.indexOf(":");
        if (separator < 0) continue;
        const key = line.slice(0, separator).trim();
        const value = stripYamlValue(line.slice(separator + 1));
        if (key === "name" && value) name = value;
        if (key === "description") description = value;
    }

    return { name, description };
}

async function readSkillMetadataPrefix(path: string, maxBytes = 16_384) {
    const file = await open(path, "r");
    try {
        const buffer = Buffer.alloc(maxBytes);
        const { bytesRead } = await file.read(buffer, 0, maxBytes, 0);
        return buffer.subarray(0, bytesRead).toString("utf-8");
    } finally {
        await file.close();
    }
}

async function discoverSkillDirectory(
    root: string,
    scope: SkillScope,
): Promise<SkillDescriptor[]> {
    let entries;
    try {
        entries = await readdir(root, { withFileTypes: true });
    } catch (error) {
        const code = error instanceof Error && "code" in error
            ? String((error as NodeJS.ErrnoException).code)
            : null;
        if (code === "ENOENT") return [];
        throw error;
    }

    const skills: SkillDescriptor[] = [];
    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const path = join(root, entry.name, "SKILL.md");
        try {
            const metadataPrefix = await readSkillMetadataPrefix(path);
            const metadata = parseSkillMetadata(metadataPrefix, entry.name);
            skills.push({
                ...metadata,
                scope,
                path,
            });
        } catch (error) {
            const code = error instanceof Error && "code" in error
                ? String((error as NodeJS.ErrnoException).code)
                : null;
            if (code !== "ENOENT") throw error;
        }
    }
    return skills;
}

function configuredDirectories(config: AgentConfigBundle, scope: ConfigScope) {
    const scoped = scope === "global" ? config.global : config.project;
    return scoped.skills?.directories ?? ["skills"];
}

export class SkillRegistry {
    private readonly descriptors = new Map<string, SkillDescriptor>();

    constructor(descriptors: readonly SkillDescriptor[]) {
        for (const descriptor of descriptors) {
            this.descriptors.set(descriptor.name, descriptor);
        }
    }

    list() {
        return [...this.descriptors.values()].sort((a, b) => a.name.localeCompare(b.name));
    }

    get(name: string) {
        return this.descriptors.get(name) ?? null;
    }

    async load(name: string): Promise<LoadedSkill> {
        const descriptor = this.descriptors.get(name);
        if (!descriptor) {
            throw new Error(`Unknown skill: ${name}`);
        }
        const content = await readFile(descriptor.path, "utf-8");
        return { ...descriptor, content };
    }
}

export async function createSkillRegistry(config: AgentConfigBundle) {
    if (!config.resolved.skills.enabled) return new SkillRegistry([]);

    const discovered: SkillDescriptor[] = [];

    // Compatibility source shared with Codex/other agent tooling. It is discovered
    // first so MORE-MORE-CODE's own global/project skills can intentionally override it.
    discovered.push(...await discoverSkillDirectory(config.paths.agentsSkillsDir, "agents"));

    for (const scope of ["global", "project"] as const) {
        const baseDir = scope === "global" ? config.paths.globalDir : config.paths.projectDir;
        for (const directory of configuredDirectories(config, scope)) {
            discovered.push(...await discoverSkillDirectory(join(baseDir, directory), scope));
        }
    }

    // Precedence: ~/.agents/skills < ~/.more-more-code/skills < project/.more-more-code/skills.
    return new SkillRegistry(discovered);
}

export function renderSkillCatalog(skills: readonly SkillDescriptor[]) {
    if (skills.length === 0) return "No skills are currently available.";
    return skills
        .map((skill) => `- ${skill.name}: ${skill.description || "No description"} [${skill.scope}]`)
        .join("\n");
}
