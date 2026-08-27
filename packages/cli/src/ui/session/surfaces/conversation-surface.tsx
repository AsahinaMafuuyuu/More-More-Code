import { BotMessage, ErrorMessage, UserMessage } from "../../../components/messages";
import type { Message } from "../../../lib/chat-types";
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
      model={typeof message.metadata?.model === "string"
        ? message.metadata.model
        : message.metadata?.model
          ? `${message.metadata.model.providerId}/${message.metadata.model.modelId}`
          : "unknown"}
      mode={message.metadata?.mode ?? "BUILD"}
      durationMs={message.metadata?.durationMs}
      streaming={false}
      toolUses={toolUses}
    />
  );
}

export function ConversationSurface() {
  const conversation = useSessionUiSelector(selectConversation);
  return (
    <>
      {conversation.messages.map((message) => (
        <ConversationMessage
          key={message.id}
          message={message}
          toolUses={conversation.toolUses}
        />
      ))}
      {conversation.errorMessage && <ErrorMessage message={conversation.errorMessage} />}
      {!conversation.errorMessage && conversation.runErrorMessage && (
        <ErrorMessage message={conversation.runErrorMessage} />
      )}
    </>
  );
}
