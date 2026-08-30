import { isToolUIPart } from "./chat-types";
import type { AgentRunStatus } from "@more-more-code/harness";
import type { ModeType, ModelRef } from "@more-more-code/shared";
import type { Message } from "./chat-types";
import type { ToolUseView } from "./tool-use-projection";

export type ConversationRunView = Readonly<{
  inputMessageId?: string;
  status: AgentRunStatus;
  durationMs?: number;
}>;

export type ConversationRoundSummary = Readonly<{
  mode: ModeType;
  modelLabel: string;
  durationMs?: number;
}>;

export type ConversationRound = Readonly<{
  key: string;
  messages: readonly Message[];
  summary: ConversationRoundSummary | null;
}>;

type MutableRound = {
  key: string;
  userMessageId?: string;
  messages: Message[];
};

export function projectConversationRounds(input: {
  messages: readonly Message[];
  toolUses: Readonly<Record<string, ToolUseView>>;
  currentRun?: ConversationRunView | null;
}): ConversationRound[] {
  const grouped: MutableRound[] = [];

  for (const message of input.messages) {
    if (message.role === "user") {
      grouped.push({
        key: `round:${message.id}`,
        userMessageId: message.id,
        messages: [message],
      });
      continue;
    }

    let current = grouped[grouped.length - 1];
    if (!current) {
      current = {
        key: `round:orphan:${message.id}`,
        messages: [],
      };
      grouped.push(current);
    }
    current.messages.push(message);
  }

  return grouped.map((round, index) => {
    const currentRunMatches = Boolean(
      input.currentRun
      && (
        input.currentRun.inputMessageId
          ? input.currentRun.inputMessageId === round.userMessageId
          : index === grouped.length - 1
      )
    );
    const assistantMessages = round.messages.filter((message) => message.role === "assistant");
    const terminalCurrentRun = currentRunMatches && input.currentRun?.status !== "running";
    const settled = !currentRunMatches || terminalCurrentRun;

    if (!settled || (assistantMessages.length === 0 && !terminalCurrentRun)) {
      return { key: round.key, messages: round.messages, summary: null };
    }

    const metadataSource = [...assistantMessages].reverse().find((message) => (
      message.metadata?.mode || message.metadata?.model
    )) ?? round.messages.find((message) => message.role === "user");

    return {
      key: round.key,
      messages: round.messages,
      summary: {
        mode: metadataSource?.metadata?.mode ?? "BUILD",
        modelLabel: formatModelLabel(metadataSource?.metadata?.model),
        durationMs: currentRunMatches && input.currentRun?.durationMs !== undefined
          ? input.currentRun.durationMs
          : sumRoundDuration(assistantMessages, input.toolUses),
      },
    };
  });
}

function sumRoundDuration(
  assistantMessages: readonly Message[],
  toolUses: Readonly<Record<string, ToolUseView>>,
): number | undefined {
  let total = 0;
  let observed = false;
  const toolCallIds = new Set<string>();

  for (const message of assistantMessages) {
    const modelDuration = message.metadata?.durationMs;
    if (typeof modelDuration === "number" && Number.isFinite(modelDuration) && modelDuration >= 0) {
      total += modelDuration;
      observed = true;
    }

    for (const part of message.parts) {
      if (!isToolUIPart(part)) continue;
      toolCallIds.add(part.toolCallId);
    }
  }

  for (const toolCallId of toolCallIds) {
    const duration = toolUses[toolCallId]?.durationMs;
    if (typeof duration !== "number" || !Number.isFinite(duration) || duration < 0) continue;
    total += duration;
    observed = true;
  }

  return observed ? total : undefined;
}

function formatModelLabel(model: ModelRef | string | undefined): string {
  if (typeof model === "string") return model;
  return model ? `${model.providerId}/${model.modelId}` : "unknown";
}
