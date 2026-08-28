export type TuiRenderProfileName = "normal" | "safe";

export type TuiRenderProfile = Readonly<{
  name: TuiRenderProfileName;
  targetFps: number;
  maxFps: number;
  projectionCommitHz: number;
  activityElapsedMs: number | null;
  animateBusyIndicator: false;
}>;

export const TUI_RENDER_PROFILE_ENV = "MORE_MORE_CODE_TUI_PROFILE" as const;

const NORMAL_PROFILE: TuiRenderProfile = Object.freeze({
  name: "normal",
  targetFps: 30,
  maxFps: 30,
  projectionCommitHz: 20,
  activityElapsedMs: 1000,
  animateBusyIndicator: false,
});

const SAFE_PROFILE: TuiRenderProfile = Object.freeze({
  name: "safe",
  targetFps: 15,
  maxFps: 15,
  projectionCommitHz: 10,
  activityElapsedMs: null,
  animateBusyIndicator: false,
});

export function resolveTuiRenderProfile(name: string = "normal"): TuiRenderProfile {
  if (name === "normal") return NORMAL_PROFILE;
  if (name === "safe") return SAFE_PROFILE;
  throw new Error(`Unknown TUI render profile ${JSON.stringify(name)}. Expected "normal" or "safe".`);
}

export function resolveTuiRenderProfileFromEnvironment(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): TuiRenderProfile {
  return resolveTuiRenderProfile(environment[TUI_RENDER_PROFILE_ENV] ?? "normal");
}
