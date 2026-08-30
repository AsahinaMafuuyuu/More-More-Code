import { Fragment } from "react";
import prettyMs from "pretty-ms";
import { TextAttributes } from "@opentui/core";
import { BotMessage, ErrorMessage, UserMessage } from "../../../components/messages";
import type { Message } from "../../../lib/chat-types";
import { projectConversationRounds, type ConversationRoundSummary } from "../../../lib/conversation-rounds";
import { useTheme } from "../../../providers/theme";
import { useSessionUiSelector } from "../store/react-session-ui";
import { selectConversation } from "../store/session-ui-selectors";

function getMessageText(message: Message) {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function ConversationMessage({
  message,
  toolUses,
}: {
  message: Message;
  toolUses: ReturnType<typeof selectConversation>["toolUses"];
}) {
  if (message.role === "user") {
    return (
      <UserMessage
        message={getMessageText(message)}
        mode={message.metadata?.mode ?? "BUILD"}
      />
    );
  }
  return (
    <BotMessage
      parts={message.parts}
      toolUses={toolUses}
    />
  );
}

function RoundSummary({ summary }: { summary: ConversationRoundSummary }) {
  const { colors } = useTheme();
  return (
    <box paddingX={3} paddingY={1} gap={1} width="100%">
      <box flexDirection="row" gap={2}>
        <text fg={summary.mode === "PLAN" ? colors.planMode : colors.primary}>◎</text>
        <box flexDirection="row" gap={1}>
          <text>{summary.mode === "PLAN" ? "Plan" : "Build"}</text>
          <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>&gt;</text>
          <text attributes={TextAttributes.DIM}>{summary.modelLabel}</text>
          {summary.durationMs !== undefined && (
            <>
              <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>&gt;</text>
              <text attributes={TextAttributes.DIM}>{prettyMs(summary.durationMs)}</text>
            </>
          )}
        </box>
      </box>
    </box>
  );
}

function HiddenHistoryMarker({ count }: { count: number }) {
  const { colors } = useTheme();
  return (
    <box width="100%" paddingX={3} paddingY={1}>
      <text attributes={TextAttributes.DIM} fg={colors.dimSeparator}>
        {`⋯ ${count.toLocaleString()} earlier messages remain in Session history and are not mounted in the live transcript`}
      </text>
    </box>
  );
}

export function ConversationSurface() {
  const conversation = useSessionUiSelector(selectConversation);
  const rounds = projectConversationRounds({
    messages: conversation.messages,
    toolUses: conversation.toolUses,
    currentRun: conversation.currentRun,
  });
  const errorMessage = conversation.errorMessage ?? conversation.runErrorMessage;
  return (
    <>
      {conversation.hiddenMessageCount > 0 && (
        <HiddenHistoryMarker count={conversation.hiddenMessageCount} />
      )}
      {rounds.map((round, roundIndex) => (
        <Fragment key={round.key}>
          {round.messages.map((message) => (
            <ConversationMessage
              key={message.id}
              message={message}
              toolUses={conversation.toolUses}
            />
          ))}
          {roundIndex === rounds.length - 1 && errorMessage && (
            <ErrorMessage message={errorMessage} />
          )}
          {round.summary && <RoundSummary summary={round.summary} />}
        </Fragment>
      ))}
      {rounds.length === 0 && errorMessage && <ErrorMessage message={errorMessage} />}
    </>
  );
}
