import type { Mode } from "@more-more-code/database";
import { createReadFileTool } from "./read-file";
import { createWriteFileTool } from "./write-file";
import { createListDirectoryTool } from "./list-directory";
import { createGlobTool } from "./glob";
import { createGrepTool } from "./grep";
import { createEditFileTool } from "./edit-file";
import { createBashTool } from "./bash";

export function createTools(cwd: string, mode: Mode) {
    const readOnlyTools = {
        readFile: createReadFileTool(cwd),
        listDirectory: createListDirectoryTool(cwd),
        glob: createGlobTool(cwd),
        grep: createGrepTool(cwd),
    }

    if (mode === "PLAN") {
        return readOnlyTools;
    }

    return {
        readFile: createReadFileTool(cwd),
        listDirectory: createListDirectoryTool(cwd),
        glob: createGlobTool(cwd),
        grep: createGrepTool(cwd),
        writeFile: createWriteFileTool(cwd),
        editFile: createEditFileTool(cwd),
        bash: createBashTool(cwd),
    }
}
