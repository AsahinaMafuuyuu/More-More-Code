import { useMemo } from "react";
import type { SessionTreeCommandApi } from "../../../components/command-menu/types";
import type { SessionController } from "../../../app/session/session-controller";
import { projectSessionNavigationTree } from "../../../lib/session-navigation-projection";
import { projectDurableSessionMessages } from "../../../lib/durable-session-message";
import { normalizeModelRef } from "../../../lib/models";
import { usePromptConfig } from "../../../providers/prompt-config";

export function useSessionTreeCommandApi(
  controller: SessionController,
): SessionTreeCommandApi {
  const { mode, model, setMode, setModel } = usePromptConfig();

  return useMemo<SessionTreeCommandApi>(() => ({
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
}
