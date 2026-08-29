import { z } from "zod";

export const Mode = {
    BUILD: "BUILD",
    PLAN: "PLAN",
} as const;

export const modeSchema = z.enum([Mode.BUILD, Mode.PLAN]);

export type ModeType = (typeof Mode)[keyof typeof Mode];

export const toolInputSchemas = {
    readFile: z.object({
        path: z.string()
            .describe("Relative path to the file to read."),
    }),
    listDirectory: z.object({
        path: z.string()
            .describe("Relative path to the directory to list."),
    }),
    glob: z.object({
        pattern: z.string()
            .describe("Glob pattern to match files."),
        path: z.string()
            .describe("Directory to search from.")
            .default("."),
    }),
    grep: z.object({
        pattern: z.string()
            .describe("Regex pattern to search for."),
        path: z.string()
            .describe("Directory to search from.")
            .default("."),
        includes: z.string()
            .optional()
            .describe("Optional glob for files to include."),
    }),
    loadSkill: z.object({
        name: z.string()
            .describe("Name of an available skill to load on demand."),
    }),
    writeFile: z.object({
        path: z.string()
            .describe("Relative path to the file to write."),
        content: z.string()
            .describe("Content to write to the file."),
    }),
    editFile: z.object({
        path: z.string()
            .describe("Relative path to the file to edit."),
        oldString: z.string()
            .describe("Exact text to replace; must be unique in the file."),
        newString: z.string()
            .describe("Replacement text to insert in place of the old string."),
    }),
    bash: z.object({
        command: z.string()
            .describe("Bash command to execute."),
        description: z.string()
            .optional()
            .describe("Short optional description of the command."),
        timeout: z.number()
            .optional()
            .describe("Optional timeout in milliseconds for the command."),
    }),
} as const;

export const readOnlyToolContracts = {
    readFile: {
        description: "Read a file from the current project directory.",
        inputSchema: toolInputSchemas.readFile,
        outputSchema: z.unknown(),
    },

    listDirectory: {
        description: "List entries in a directory under the current project directory.",
        inputSchema: toolInputSchemas.listDirectory,
        outputSchema: z.unknown(),
    },
    glob: {
        description: "Find files matching a glob pattern under the current project directory.",
        inputSchema: toolInputSchemas.glob,
        outputSchema: z.unknown(),
    },

    grep: {
        description:
            "Search file contents with a regular expression under the current project directory.",
        inputSchema: toolInputSchemas.grep,
        outputSchema: z.unknown(),
    },
    loadSkill: {
        description: "Load the full instructions for an available agent skill by name when that workflow is relevant.",
        inputSchema: toolInputSchemas.loadSkill,
        outputSchema: z.unknown(),
    },
} as const;

export const buildToolContracts = {
    ...readOnlyToolContracts,
    writeFile: {
        description: "Create or overwrite a file under the current project directory.",
        inputSchema: toolInputSchemas.writeFile,
        outputSchema: z.unknown(),
    },

    editFile: {
        description: "Replace exact text in a file under the current project directory.",
        inputSchema: toolInputSchemas.editFile,
        outputSchema: z.unknown(),
    },
    bash: {
        description: "Execute a bash command in the current project directory.",
        inputSchema: toolInputSchemas.bash,
        outputSchema: z.unknown(),
    }
} as const;

export type ToolContracts = typeof buildToolContracts;

export function getToolContracts(mode: ModeType) {
    return mode === Mode.BUILD ?
        buildToolContracts
        : readOnlyToolContracts;
}
