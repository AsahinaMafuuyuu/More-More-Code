// Local Session route + workspace composition. Runtime/UI subscriptions live
// below this screen so one changing projection does not invalidate the route root.
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { z } from "zod";
import type { ModelRef, ModeType } from "@more-more-code/shared";
import type { LocalSessionSnapshot } from "@more-more-code/session-store";
import { getLocalSessionAuthority } from "../lib/session-environment";
import type { Message } from "../lib/chat-types";
import { useToast } from "../providers/toast";
import { SessionController } from "../app/session/session-controller";
import {
  createInitialSessionUiState,
  createSessionUiStore,
} from "../ui/session/store/session-ui-store";
import { SessionUiStoreProvider } from "../ui/session/store/react-session-ui";
import { SessionRuntimeBridge } from "../ui/session/runtime/session-runtime-bridge";
import { ConversationSurface } from "../ui/session/surfaces/conversation-surface";
import { ComposerSurface } from "../ui/session/surfaces/composer-surface";
import { InteractionHintsSurface } from "../ui/session/surfaces/interaction-hints-surface";
import { StatusSurface } from "../ui/session/surfaces/status-surface";
import { SessionWorkspace } from "../ui/session/workspace/session-workspace";
import { InspectorSurface } from "../ui/session/workspace/inspector-surface";
import { SessionLoadingWorkspace } from "../ui/session/workspace/session-loading-workspace";
import { ApprovalPresentation } from "../ui/session/presentation/approval-presentation";
import { RecoveryPresentation } from "../ui/session/presentation/recovery-presentation";
import { SessionRuntimeInteraction } from "../ui/session/interaction/session-runtime-interaction";

type SessionData = LocalSessionSnapshot<Message>;

const sessionLocationSchema = z.object({
  snapshot: z.custom<SessionData>((value) => Boolean(
    value
    && typeof value === "object"
    && "session" in value
    && "state" in value
  )),
  initialPrompt: z.object({
    message: z.string(),
    mode: z.custom<ModeType>(),
    model: z.object({
      providerId: z.string().min(1),
      modelId: z.string().min(1),
    }).strict(),
  }),
});

function SessionChat({
  session,
  initialPrompt,
}: {
  session: SessionData;
  initialPrompt?: {
    message: string;
    mode: ModeType;
    model: ModelRef;
  };
}) {
  const toast = useToast();
  const controller = useMemo(() => new SessionController({
    sessionId: session.session.id,
    persistedSessionState: session.state,
  }), [session.session.id, session.state]);
  const store = useMemo(
    () => createSessionUiStore(createInitialSessionUiState()),
    [session.session.id],
  );
  const submittedInitialPrompt = useRef(false);

  useEffect(() => {
    if (!initialPrompt || submittedInitialPrompt.current) return;
    submittedInitialPrompt.current = true;
    void controller.submit({
      userText: initialPrompt.message,
      mode: initialPrompt.mode,
      model: initialPrompt.model,
    }).catch((error) => {
      toast.show({
        variant: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    });
  }, [controller, initialPrompt, toast]);

  return (
    <SessionUiStoreProvider store={store}>
      <SessionRuntimeBridge controller={controller} store={store} />
      <ApprovalPresentation controller={controller} />
      <RecoveryPresentation />
      <SessionRuntimeInteraction controller={controller} />
      <SessionWorkspace
        conversation={<ConversationSurface />}
        composer={<ComposerSurface controller={controller} />}
        status={<StatusSurface />}
        hints={<InteractionHintsSurface />}
        inspector={<InspectorSurface />}
      />
    </SessionUiStoreProvider>
  );
}

export function Session() {
  const { id } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();

  const prefetched = useMemo(() => {
    const parsed = sessionLocationSchema.safeParse(location.state);
    return parsed.success ? parsed.data : null;
  }, [location.state]);
  const [session, setSession] = useState<SessionData | null>(prefetched?.snapshot ?? null);

  useEffect(() => {
    if (prefetched?.snapshot) return;
    setSession(null);
    if (!id) return;
    let ignore = false;

    void getLocalSessionAuthority().open(id).then((resolvedSession) => {
      if (ignore) return;
      if (!resolvedSession) throw new Error(`Local session ${id} was not found`);
      setSession(resolvedSession);
    }).catch((error) => {
      if (ignore) return;
      toast.show({
        variant: "error",
        message: error instanceof Error
          ? `Unable to open local session: ${error.message}`
          : "Unable to open local session",
      });
      navigate("/", { replace: true });
    });

    return () => {
      ignore = true;
    };
  }, [id, navigate, prefetched, toast]);

  if (!session) {
    return <SessionLoadingWorkspace />;
  }

  return (
    <SessionChat
      key={session.session.id}
      session={session}
      initialPrompt={prefetched?.initialPrompt}
    />
  );
}
