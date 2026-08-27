import { useCallback } from "react";
import { useRenderer } from "@opentui/react";
import { useNavigate } from "react-router";
import { getAgentEnvironment } from "../../../lib/agent-environment";
import { shutdownCliEnvironment } from "../../../lib/cli-environment";
import { useDialog } from "../../../providers/dialog";
import { usePromptConfig } from "../../../providers/prompt-config";
import { useToast } from "../../../providers/toast";
import type { SessionController } from "../../../app/session/session-controller";
import {
  createSessionCommandRouter,
  resolveSessionCommandIntent,
  type SessionDialogIntent,
} from "../../../app/session/session-command-router";
import type { SessionTreeCommandApi } from "../../../components/command-menu/types";
import {
  AgentsDialogContent,
  BranchSummaryDecisionDialogContent,
  ModelsDialogContent,
  ProvidersDialogContent,
  SessionTreeDialogContent,
  SessionsDialogContent,
  SettingsDialogContent,
  ThemeDialogContent,
  showNavigationResultToast,
} from "../../../components/dialogs";
import type { ComposerIntent } from "../composer/composer-intent";
import { commitPromptModeChange, commitPromptModelChange } from "../composer/composer-actions";

export function useSessionCommandHandler(input: {
  controller?: SessionController;
  sessionTree?: SessionTreeCommandApi;
}) {
  const renderer = useRenderer();
  const navigate = useNavigate();
  const toast = useToast();
  const dialog = useDialog();
  const { mode, model, setMode, setModel } = usePromptConfig();

  const showError = useCallback((message: string) => {
    toast.show({ variant: "error", message });
  }, [toast]);

  const changeMode = useCallback(async (nextMode: typeof mode) => {
    await commitPromptModeChange({
      mode: nextMode,
      onModeChange: input.controller
        ? (value) => input.controller!.changeMode(value, model)
        : undefined,
      setMode,
    });
  }, [input.controller, model, setMode]);

  const changeModel = useCallback(async (nextModel: typeof model) => {
    await commitPromptModelChange({
      model: nextModel,
      onModelChange: input.controller
        ? (value) => input.controller!.changeModel(value, mode)
        : undefined,
      setModel,
    });
  }, [input.controller, mode, setModel]);

  const openSemanticDialog = useCallback((kind: SessionDialogIntent) => {
    switch (kind) {
      case "agents":
        dialog.open({
          title: "Select Agent",
          children: <AgentsDialogContent currentMode={mode} onSelecteMode={(value) => void changeMode(value)} />,
        });
        return;
      case "models":
        dialog.open({
          title: "Select Model",
          children: (
            <ModelsDialogContent
              models={getAgentEnvironment().providers.listModelRefs()}
              onSelectModel={changeModel}
            />
          ),
        });
        return;
      case "providers":
        dialog.open({ title: "Providers", children: <ProvidersDialogContent liveModel={model} /> });
        return;
      case "sessions":
        dialog.open({ title: "Sessions", children: <SessionsDialogContent /> });
        return;
      case "tree":
      case "jump":
        if (!input.sessionTree) {
          showError("Session tree is not available here");
          return;
        }
        dialog.open({
          title: kind === "tree" ? "Session Tree" : "Jump to Session Node",
          children: <SessionTreeDialogContent tree={input.sessionTree} />,
        });
        return;
      case "settings":
        dialog.open({ title: "MORE-MORE-CODE Settings", children: <SettingsDialogContent /> });
        return;
      case "theme":
        dialog.open({ title: "Select Theme", children: <ThemeDialogContent /> });
    }
  }, [changeMode, changeModel, dialog, input.sessionTree, mode, model, showError]);

  const navigateTree = useCallback(async (target: "parent" | "root") => {
    const tree = input.sessionTree;
    if (!tree) {
      showError("Session tree is not available here");
      return;
    }
    const targetEntryId = target === "root" ? tree.rootEntryId : tree.parentEntryId;
    if (!targetEntryId) {
      toast.show({ message: "Already at the root session node" });
      return;
    }
    const intent = tree.inspectJump(targetEntryId);
    if (intent.action === "ask") {
      dialog.open({
        title: "Carry Branch Knowledge",
        children: <BranchSummaryDecisionDialogContent tree={tree} targetEntryId={targetEntryId} />,
      });
      return;
    }
    try {
      const result = await tree.jump(targetEntryId);
      showNavigationResultToast(result, toast);
    } catch (error) {
      showError(error instanceof Error ? error.message : String(error));
    }
  }, [dialog, input.sessionTree, showError, toast]);

  const compact = useCallback(async () => {
    if (!input.controller) {
      showError("Context compaction is not available here");
      return;
    }
    try {
      const result = await input.controller.compact({ mode, model });
      const usage = `${result.inputTokensBefore} → ${result.inputTokensAfter} / ${result.inputBudgetTokens} tokens`;
      const pruning = result.toolResultPruning.prunedResults > 0
        ? `; pruned ${result.toolResultPruning.prunedResults} tool result(s)`
        : "";
      const fallback = result.fallbackUsed
        ? `; deterministic fallback (${result.fallbackReason ?? "unknown"})`
        : "";
      if (result.status === "noop") {
        const eligibility = result.eligibility;
        const reason = (() => {
          switch (result.reason) {
            case "insufficient-history":
              return `Manual compaction skipped: ${eligibility.compactableTokens} compactable tokens; requires at least ${eligibility.minCompactableTokens}`;
            case "recent-compaction":
              return `Manual compaction skipped: checkpoint is still recent (${eligibility.newTurnsSinceCheckpoint} new turn(s), ${eligibility.compactableTokens} compactable tokens; requires at least ${eligibility.minNewTurnsSinceCheckpoint} turn(s) and ${eligibility.minCompactableTokens} tokens)`;
            case "insufficient-gain":
              return `Manual compaction skipped: estimated savings ${eligibility.estimatedGainTokens} tokens (${Math.round(eligibility.estimatedGainRatio * 100)}%); requires at least ${eligibility.minEstimatedGainTokens} tokens and ${Math.round(eligibility.minEstimatedGainRatio * 100)}%`;
            case "compactor-unavailable":
              return "Manual compaction skipped: compactor did not produce a valid replacement checkpoint";
            default:
              return "Nothing safely compactable";
          }
        })();
        toast.show({ message: `${reason} (${result.reason ?? "no-op"}); ${usage}${pruning}${fallback}` });
        return;
      }
      toast.show({
        variant: "success",
        message: `Manual context compaction complete (trigger=manual); ${usage}${pruning}${fallback}`,
      });
    } catch (error) {
      showError(`Context compaction failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [input.controller, mode, model, showError, toast]);

  return useCallback((composerIntent: ComposerIntent) => {
    const router = createSessionCommandRouter({
      navigate,
      openDialog: openSemanticDialog,
      changeMode,
      compact,
      navigateTree,
      showError,
      shutdown: shutdownCliEnvironment,
      destroyRenderer: () => renderer.destroy(),
    });
    return router.execute(resolveSessionCommandIntent(composerIntent));
  }, [changeMode, compact, navigate, navigateTree, openSemanticDialog, renderer, showError]);
}
