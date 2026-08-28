import { readFileSync } from "node:fs";
import { createCliRenderer } from "@opentui/core";
import type { ScrollBoxRenderable } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { useEffect, useRef } from "react";
import type { AgentActivityView } from "../lib/agent-activity-projection";
import type { Message } from "../lib/chat-types";
import type { ToolUseView } from "../lib/tool-use-projection";
import { ActivityView } from "../components/activity-view";
import { ToolUse } from "../components/messages/tool-use";
import { DialogProvider, useDialog } from "../providers/dialog";
import { KeyboardLayerProvider } from "../providers/keyboard-layer";
import { ThemeProvider } from "../providers/theme";
import { TerminalDimensionsProvider } from "../providers/terminal-dimensions";
import { resolveTuiRenderProfile } from "../tui/render-profile";
import { assertSupportedBunRuntime } from "../tui/runtime-compatibility";
import { parseTuiSoakOptions, resolveTuiSoakPressure } from "./tui-soak-options";
import { createSessionUiCommitScheduler } from "../ui/session/runtime/session-ui-commit-scheduler";
import {
  createInitialSessionUiState,
  createSessionUiStore,
} from "../ui/session/store/session-ui-store";
import {
  SessionUiStoreProvider,
  useSessionUiSelector,
} from "../ui/session/store/react-session-ui";
import { SessionWorkspace } from "../ui/session/workspace/session-workspace";

const options = parseTuiSoakOptions(Bun.argv.slice(2));
const pressure = resolveTuiSoakPressure(options.workload);
const runtime = assertSupportedBunRuntime(Bun.version, Bun.revision);
const renderProfile = resolveTuiRenderProfile(options.renderProfile);
const opentuiVersion = readOpenTuiVersion();
const startedAt = Date.now();
const memoryAtStart = process.memoryUsage();
let peakRssBytes = memoryAtStart.rss;
let sourceUpdates = 0;
let storeCommits = 0;
let immediateCommits = 0;
let scrollOperations = 0;
let dialogOperations = 0;
let finalMarker = "baseline";
let workloadActive = true;

const initialActivity = createRunningActivity(startedAt);
const store = createSessionUiStore(createInitialSessionUiState({
  conversation: createConversation("baseline", {}),
  activity: initialActivity,
  status: {
    mode: "BUILD",
    modelLabel: "synthetic/native-soak",
    contextLabel: "Ctx synthetic",
    costLabel: "API n/a",
    cacheLabel: "Cache n/a",
  },
}));
const unsubscribe = store.subscribe(() => storeCommits += 1);
const scheduler = createSessionUiCommitScheduler({
  store,
  commitHz: renderProfile.projectionCommitHz,
});

const renderer = await createCliRenderer({
  targetFps: renderProfile.targetFps,
  maxFps: renderProfile.maxFps,
  exitOnCtrlC: false,
});
const root = createRoot(renderer);
root.render(
  <TerminalDimensionsProvider>
    <ThemeProvider>
      <KeyboardLayerProvider>
        <DialogProvider>
          <SessionUiStoreProvider store={store}>
            <SoakWorkspace />
          </SessionUiStoreProvider>
        </DialogProvider>
      </KeyboardLayerProvider>
    </ThemeProvider>
  </TerminalDimensionsProvider>,
);

const workloadTimers: Array<ReturnType<typeof setInterval>> = [];
const diagnosticTimers: Array<ReturnType<typeof setInterval>> = [];
diagnosticTimers.push(setInterval(() => {
  peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
}, 1_000));

startWorkload();

await Bun.sleep(options.durationSeconds * 1_000);
workloadActive = false;
for (const timer of workloadTimers) clearInterval(timer);
finalMarker = `final-${options.workload}`;
sourceUpdates += 1;
scheduler.enqueuePresentation({ conversation: createConversation(finalMarker, {}) });
scheduler.flush();
await renderer.idle();

const finalVisibleMarker = store.getSnapshot().conversation.messages[0]?.id ?? "missing";
const rendererFrameId = renderer.frameId;
const schedulerState = renderer.getSchedulerState();
const finalMemory = process.memoryUsage();
peakRssBytes = Math.max(peakRssBytes, finalMemory.rss);
const elapsedMs = Date.now() - startedAt;

for (const timer of diagnosticTimers) clearInterval(timer);
scheduler.dispose();
unsubscribe();
root.unmount();
await renderer.idle();
renderer.destroy();
store.destroy();

const maxExpectedPresentationCommits = options.workload === "idle"
  ? Number.POSITIVE_INFINITY
  : Math.ceil(options.durationSeconds * renderProfile.projectionCommitHz) + (immediateCommits * 2) + 16;
const finalStateCorrect = finalVisibleMarker === finalMarker;
const commitBudgetCorrect = storeCommits <= maxExpectedPresentationCommits;
const sourceUpdatesPerSecond = sourceUpdates / options.durationSeconds;
const presentationCommits = Math.max(0, storeCommits - immediateCommits);
const coalescedUpdates = Math.max(0, sourceUpdates - presentationCommits);
const coalescingRatio = sourceUpdates > 0 ? coalescedUpdates / sourceUpdates : 1;
const stressVolumeCorrect = sourceUpdatesPerSecond >= pressure.minSourceUpdatesPerSecond
  && coalescingRatio >= pressure.minCoalescingRatio;
const interactionPressureCorrect = immediateCommits / options.durationSeconds >= pressure.minImmediateCommitsPerSecond
  && scrollOperations / options.durationSeconds >= pressure.minScrollOperationsPerSecond
  && dialogOperations / options.durationSeconds >= pressure.minDialogOperationsPerSecond;
const passed = finalStateCorrect
  && commitBudgetCorrect
  && stressVolumeCorrect
  && interactionPressureCorrect;

console.log(JSON.stringify({
  result: passed ? "pass" : "fail",
  classification: passed ? null : "application-error",
  workload: options.workload,
  durationSeconds: options.durationSeconds,
  elapsedMs,
  renderProfile: renderProfile.name,
  bunVersion: runtime.version,
  bunRevision: runtime.revision ?? null,
  opentuiVersion,
  sourceUpdates,
  storeCommits,
  immediateCommits,
  sourceUpdatesPerSecond,
  coalescedUpdates,
  coalescingRatio,
  scrollOperations,
  dialogOperations,
  finalStateCorrect,
  commitBudgetCorrect,
  stressVolumeCorrect,
  interactionPressureCorrect,
  rendererFrameId,
  rendererScheduler: schedulerState,
  rssStartBytes: memoryAtStart.rss,
  rssFinalBytes: finalMemory.rss,
  rssPeakBytes: peakRssBytes,
  heapUsedFinalBytes: finalMemory.heapUsed,
}));

if (!passed) process.exitCode = 1;

function startWorkload() {
  if (options.workload === "idle") return;

  if (options.workload === "stream") {
    let index = 0;
    workloadTimers.push(setInterval(() => {
      index += 1;
      sourceUpdates += 1;
      scheduler.enqueuePresentation({
        conversation: createConversation(`stream-${index}`, {}),
        status: {
          ...store.getSnapshot().status,
          contextLabel: `Ctx ${index}`,
        },
      });
    }, pressure.sourceIntervalMs ?? 1));
    return;
  }

  let index = 0;
  workloadTimers.push(setInterval(() => {
    index += 1;
    sourceUpdates += 1;
    const tool = createToolUse(index);
    scheduler.enqueuePresentation({
      conversation: createConversation(`churn-${index}`, {
        [tool.toolCallId]: tool,
      }),
      status: {
        ...store.getSnapshot().status,
        contextLabel: `Churn ${index}`,
      },
    });
  }, pressure.sourceIntervalMs ?? 2));
  workloadTimers.push(setInterval(() => {
    immediateCommits += 1;
    const active = immediateCommits % 2 === 1;
    scheduler.commitImmediate({
      composerRuntime: {
        disabled: active,
        runActive: active,
        canInterrupt: active,
        submitMode: active ? "steer" : "submit",
        followUpAvailable: active,
      },
    });
  }, pressure.immediateIntervalMs ?? 25));
}

function SoakWorkspace() {
  const conversation = useSessionUiSelector((state) => state.conversation);
  const activity = useSessionUiSelector((state) => state.activity);
  const status = useSessionUiSelector((state) => state.status);
  const composerRuntime = useSessionUiSelector((state) => state.composerRuntime);
  const conversationScrollRef = useRef<ScrollBoxRenderable | null>(null);

  useEffect(() => {
    if (options.workload !== "churn") return;
    let down = true;
    const scrollTimer = setInterval(() => {
      if (!workloadActive) return;
      scrollOperations += 1;
      conversationScrollRef.current?.scrollTo(down ? 24 : 0);
      down = !down;
    }, pressure.scrollIntervalMs ?? 10);
    return () => clearInterval(scrollTimer);
  }, []);

  return (
    <>
      <SessionWorkspace
        conversation={(
          <box width="100%" flexDirection="column">
            <text>native renderer soak · {conversation.messages[0]?.id ?? "empty"}</text>
            {options.workload === "churn"
              ? Array.from({ length: 48 }, (_, index) => (
                  <text key={`scroll-line-${index}`}>synthetic scroll row {index + 1}</text>
                ))
              : null}
            {Object.values(conversation.toolUses).map((view) => (
              <ToolUse key={view.toolCallId} view={view} />
            ))}
          </box>
        )}
        activity={activity ? <ActivityView activity={activity} /> : undefined}
        composer={<text>composer · {composerRuntime.runActive ? "running" : "idle"}</text>}
        status={<text>{status.modelLabel} · {status.contextLabel} · {status.costLabel}</text>}
        hints={<text>synthetic workload · no model/provider/tool execution</text>}
        conversationScrollRef={conversationScrollRef}
      />
      <SoakDialogChurn />
    </>
  );
}

function SoakDialogChurn() {
  const dialog = useDialog();

  useEffect(() => {
    if (options.workload !== "churn") return;
    let visible = false;
    const dialogTimer = setInterval(() => {
      if (!workloadActive) return;
      dialogOperations += 1;
      if (visible) {
        dialog.close();
      } else {
        dialog.open({
          title: "Synthetic native soak",
          children: <text>dialog lifecycle churn</text>,
        });
      }
      visible = !visible;
    }, pressure.dialogIntervalMs ?? 40);
    return () => clearInterval(dialogTimer);
  }, [dialog.open, dialog.close]);

  return null;
}

function createConversation(
  marker: string,
  toolUses: Readonly<Record<string, ToolUseView>>,
) {
  const message = {
    id: marker,
    role: "assistant",
    parts: [{ type: "text", text: marker }],
  } as unknown as Message;
  return {
    messages: [message],
    toolUses,
    errorMessage: null,
    runErrorMessage: null,
  };
}

function createToolUse(index: number): ToolUseView {
  const status = index % 5 === 0 ? "completed" : "running";
  return {
    toolCallId: `soak-tool-${index}`,
    toolName: index % 2 === 0 ? "bash" : "readFile",
    status,
    input: index % 2 === 0
      ? { command: `synthetic-command-${index}` }
      : { path: `synthetic/file-${index}.ts` },
    ...(status === "completed" ? { output: `synthetic-result-${index}` } : {}),
    durationMs: index * 10,
    source: "native",
  };
}

function createRunningActivity(now: number): AgentActivityView {
  return {
    runId: "synthetic-soak-run",
    status: "running",
    startedAt: now,
    elapsedMs: 0,
    activeStepId: "synthetic-model-step",
    turns: [{
      id: "synthetic-turn",
      index: 0,
      cause: "initial",
      status: "running",
      startedAt: now,
      elapsedMs: 0,
      active: true,
      steps: [{
        id: "synthetic-model-step",
        index: 0,
        kind: "model",
        label: "Synthetic model presentation",
        status: "running",
        startedAt: now,
        elapsedMs: 0,
        active: true,
      }],
    }],
  };
}

function readOpenTuiVersion(): string {
  const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
    dependencies?: Record<string, string>;
  };
  return manifest.dependencies?.["@opentui/core"] ?? "unknown";
}
