import { readdir } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { MentionCandidate } from "./mention-model";

export const MAX_FALLBACK_MENTION_CANDIDATES = 32;
const IGNORE_DIRECTORIES = new Set(["node_modules"]);

function isWithinRoot(root: string, target: string) {
  const relativePath = relative(root, target);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

export async function searchMentionCandidates(
  query: string,
  workspaceRoot = process.cwd(),
): Promise<MentionCandidate[]> {
  const normalized = query.startsWith("./") ? query.slice(2) : query;
  if (normalized.startsWith("/") || isAbsolute(normalized)) return [];

  const trailingSlash = normalized.endsWith("/");
  const lastSlash = trailingSlash ? normalized.length - 1 : normalized.lastIndexOf("/");
  const directoryPart = trailingSlash
    ? normalized.slice(0, -1)
    : lastSlash === -1 ? "" : normalized.slice(0, lastSlash);
  const namePrefix = trailingSlash
    ? ""
    : lastSlash === -1 ? normalized : normalized.slice(lastSlash + 1);
  const directory = resolve(workspaceRoot, directoryPart || ".");
  if (!isWithinRoot(workspaceRoot, directory)) return [];

  try {
    const entries = await readdir(directory, { withFileTypes: true });
    const prefix = namePrefix.toLowerCase();
    const showHidden = namePrefix.startsWith(".");
    const direct = entries
      .filter((entry) => showHidden || !entry.name.startsWith("."))
      .filter((entry) => prefix === "" || entry.name.toLowerCase().startsWith(prefix))
      .sort((a, b) => a.isDirectory() === b.isDirectory()
        ? a.name.localeCompare(b.name)
        : a.isDirectory() ? -1 : 1)
      .map((entry): MentionCandidate => {
        const candidatePath = directoryPart ? `${directoryPart}/${entry.name}` : entry.name;
        return entry.isDirectory()
          ? { path: `${candidatePath}/`, kind: "directory" }
          : { path: candidatePath, kind: "file" };
      });

    if (direct.length > 0 || directoryPart !== "" || namePrefix === "") return direct;

    const fallback: MentionCandidate[] = [];
    const visit = async (absoluteDirectory: string, relativeDirectory: string): Promise<void> => {
      for (const entry of await readdir(absoluteDirectory, { withFileTypes: true })) {
        if (!showHidden && entry.name.startsWith(".")) continue;
        if (entry.isDirectory() && IGNORE_DIRECTORIES.has(entry.name)) continue;
        const candidatePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
        const kind = entry.isDirectory() ? "directory" as const : "file" as const;
        if (entry.name.toLowerCase().startsWith(prefix)) {
          fallback.push({ path: kind === "directory" ? `${candidatePath}/` : candidatePath, kind });
          if (fallback.length >= MAX_FALLBACK_MENTION_CANDIDATES) return;
        }
        if (entry.isDirectory()) {
          await visit(resolve(absoluteDirectory, entry.name), candidatePath);
          if (fallback.length >= MAX_FALLBACK_MENTION_CANDIDATES) return;
        }
      }
    };
    await visit(workspaceRoot, "");
    return fallback.sort((a, b) => a.path.localeCompare(b.path));
  } catch {
    return [];
  }
}
