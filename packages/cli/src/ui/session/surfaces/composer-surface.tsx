import { useMemo } from "react";
import InputBar from "../../../components/input-bar";
import type { SessionTreeCommandApi } from "../../../components/command-menu/types";
import type { SessionController } from "../../../app/session/session-controller";
import { projectSessionNavigationTree } from "../../../lib/session-navigation-projection";
import { projectDurableSessionMessages } from "../../../lib/durable-session-message";
import { normalizeModelRef } from "../../../lib/models";
import { usePromptConfig } from "../../../providers/prompt-config";
import { useToast } from "../../../providers/toast";
import { useSessionUiSelector } from "../store/react-session-ui";
import { selectComposerRuntime } from "../store/session-ui-selectors";
import { StatusSurface } from "./status-surface";

export function ComposerSurface({ controller }: { controller: SessionController }) {
  const runtime = useSessionUiSelector(selectComposerRuntime);
  const { mode, model, setMode, setModel } = usePromptConfig();
  const toast = useToast();

  const sessionTree = useMemo<SessionTreeCommandApi>(() => ({
    get rootEntryId() {
      return controller.getSnapshot().sessionTree.rootEntryId;
    },
    get activeEntryId() {
      return controller.getSnapshot().sessionTree.activeEntryId;
    },
    get parentEntryId() {
      const tree = controller.getSnapshot().sessionTree;
      return tree.entries.find((entry) => entry.id === tree.activeEntryId)?.parentId ?? null;
    },
    get entries() {
      const tree = controller.getSnapshot().sessionTree;
      const navigation = projectSessionNavigationTree(tree);
      return navigation.nodes.map((node) => ({
        id: node.id,
        parentId: node.parentId,
        type: node.type,
        depth: node.depth,
        createdAt: node.createdAt,
        messageCount: projectDurableSessionMessages(tree, node.navigationTargetEntryId).length,
        preview: node.preview,
        navigationTargetEntryId: node.navigationTargetEntryId,
        selectable: node.selectable,
        active: node.active,
      }));
    },
    inspectJump(entryId) {
      const intent = controller.inspectNavigation(entryId);
      return {
        action: intent.action,
        policy: intent.policy,
        sourceTipEntryId: intent.analysis.sourceTipEntryId,
        targetEntryId: intent.analysis.targetEntryId,
        commonAncestorEntryId: intent.analysis.commonAncestorEntryId,
        coveredEntryIds: [...intent.analysis.coveredEntryIds],
      };
    },
    async jump(entryId, decision) {
      const result = await controller.navigateToEntry({
        entryId,
        selection: { mode, model },
        ...(decision ? { decision } : {}),
      });
      if ("runtime" in result) {
        if (result.runtime.mode === "BUILD" || result.runtime.mode === "PLAN") {
          setMode(result.runtime.mode);
        }
        if (result.runtime.model) {
          try {
            setModel(normalizeModelRef(result.runtime.model, result.runtime.provider));
          } catch {
            // Legacy unknown model IDs cannot be restored without provider metadata.
          }
        }
      }
      return {
        status: result.status,
        ...((result.status === "carried" || result.status === "carry-failed")
          ? {
              fallbackUsed: result.reduction.fallbackUsed,
              ...(result.reduction.fallbackReason
                ? { fallbackReason: result.reduction.fallbackReason }
                : {}),
            }
          : {}),
      };
    },
  }), [controller, mode, model, setMode, setModel]);

  const reportError = (error: unknown) => {
    toast.show({
      variant: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  };

  const submit = (text: string) => {
    const operation = runtime.submitMode === "steer"
      ? controller.steer({ userText: text, mode, model })
      : controller.submit({ userText: text, mode, model });
    void operation.catch(reportError);
  };

  const followUp = (text: string) => {
    const operation = runtime.followUpAvailable
      ? controller.followUp({ userText: text, mode, model })
      : controller.submit({ userText: text, mode, model });
    void operation.catch(reportError);
  };

  return (
    <box flexShrink={0}>
      <InputBar
        onSubmit={submit}
        onFollowUp={followUp}
        disabled={runtime.disabled}
        sessionTree={sessionTree}
        onModeChange={(nextMode) => controller.changeMode(nextMode, model)}
        onModelChange={(nextModel) => controller.changeModel(nextModel, mode)}
        onCompact={() => controller.compact({ mode, model })}
        statusContent={<StatusSurface />}
      />
    </box>
  );
}
