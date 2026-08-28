export const MINIMUM_BUN_VERSION = "1.4.0" as const;
export const VALIDATED_BUN_FAMILY = "1.4.x" as const;

export type ParsedRuntimeVersion = Readonly<{
  major: number;
  minor: number;
  patch: number;
}>;

export type BunRuntimeStatus =
  | "unsupported"
  | "validated-family"
  | "newer-unvalidated";

export type BunRuntimeCompatibility = Readonly<{
  version: string;
  revision?: string;
  parsed: ParsedRuntimeVersion;
  status: BunRuntimeStatus;
  minimumVersion: typeof MINIMUM_BUN_VERSION;
  validatedFamily: typeof VALIDATED_BUN_FAMILY;
}>;

export function parseBunVersion(version: string): ParsedRuntimeVersion {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  if (!match) {
    throw new Error(
      `Expected a valid Bun version in major.minor.patch form, received ${JSON.stringify(version)}.`,
    );
  }

  return Object.freeze({
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  });
}

export function classifyBunRuntime(
  version: string,
  revision?: string,
): BunRuntimeCompatibility {
  const parsed = parseBunVersion(version);
  const status = compareVersions(parsed, { major: 1, minor: 4, patch: 0 }) < 0
    ? "unsupported"
    : parsed.major === 1 && parsed.minor === 4
      ? "validated-family"
      : "newer-unvalidated";

  return Object.freeze({
    version,
    ...(revision ? { revision } : {}),
    parsed,
    status,
    minimumVersion: MINIMUM_BUN_VERSION,
    validatedFamily: VALIDATED_BUN_FAMILY,
  });
}

function compareVersions(left: ParsedRuntimeVersion, right: ParsedRuntimeVersion): number {
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  return left.patch - right.patch;
}
