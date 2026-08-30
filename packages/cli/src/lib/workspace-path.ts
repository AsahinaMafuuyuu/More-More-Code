import { lstat, realpath } from "fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "path";

export type WorkspacePathResolution = {
    workspaceRoot: string;
    resolvedPath: string;
    resourcePath: string;
    scope: "workspace" | "outside-workspace";
};

/**
 * Resolve existing symlinks/junctions before classifying a Tool path. For a
 * create target, resolve the nearest existing ancestor and append only the
 * missing suffix. This is shared by policy classification and execution so
 * they cannot disagree about the workspace seam.
 */
export async function resolveWorkspacePath(
    workspaceRoot: string,
    path: string,
): Promise<WorkspacePathResolution> {
    const canonicalRoot = await realpath(resolve(workspaceRoot));
    const lexicalTarget = resolve(canonicalRoot, path);
    const canonicalTarget = await resolveFromNearestExistingAncestor(lexicalTarget);
    const relativePath = relative(canonicalRoot, canonicalTarget);
    const outsideWorkspace = relativePath === ".."
        || relativePath.startsWith(`..${sep}`)
        || isAbsolute(relativePath);

    return {
        workspaceRoot: canonicalRoot,
        resolvedPath: canonicalTarget,
        resourcePath: normalizePath(outsideWorkspace
            ? canonicalTarget
            : relativePath || "."),
        scope: outsideWorkspace ? "outside-workspace" : "workspace",
    };
}

async function resolveFromNearestExistingAncestor(target: string): Promise<string> {
    let existingAncestor = target;

    while (true) {
        try {
            await lstat(existingAncestor);
            break;
        } catch (error) {
            if (!isMissingPathError(error)) throw error;
            const parent = dirname(existingAncestor);
            if (parent === existingAncestor) throw error;
            existingAncestor = parent;
        }
    }

    // realpath failure for a present but dangling link must fail closed rather
    // than treating its lexical parent as authoritative.
    const canonicalAncestor = await realpath(existingAncestor);
    const missingSuffix = relative(existingAncestor, target);
    return resolve(canonicalAncestor, missingSuffix);
}

function isMissingPathError(error: unknown): boolean {
    return error instanceof Error
        && "code" in error
        && (error as NodeJS.ErrnoException).code === "ENOENT";
}

function normalizePath(path: string): string {
    return path.replace(/\\/g, "/");
}
