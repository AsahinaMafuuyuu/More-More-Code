import { Children } from "react";
import type { Command } from "./types";
import { SUPPORTED_CHAT_MODELS } from "@more-more-code/shared";
import { ThemeDialogContent, AgentsDialogContent, SessionsDialogContent, ModelsDialogContent, SessionTreeDialogContent, SettingsDialogContent, BranchSummaryDecisionDialogContent, showNavigationResultToast } from "../dialogs";
import { performLogin } from "../../lib/oauth";
import { clearAuth } from "../../lib/auth";
import { openBillingPortal, openUpgradeCheckout } from "../../lib/upgrade";

async function requestSessionTreeJump(
    ctx: Parameters<NonNullable<Command["action"]>>[0],
    targetEntryId: string,
) {
    if (!ctx.sessionTree) {
        ctx.toast.show({ variant: "error", message: "Session tree is not available here" });
        return;
    }

    const intent = ctx.sessionTree.inspectJump(targetEntryId);
    if (intent.action === "ask") {
        ctx.dialog.open({
            title: "Carry Branch Knowledge",
            children: (
                <BranchSummaryDecisionDialogContent
                    tree={ctx.sessionTree}
                    targetEntryId={targetEntryId}
                />
            ),
        });
        return;
    }

    try {
        const result = await ctx.sessionTree.jump(targetEntryId);
        showNavigationResultToast(result, ctx.toast);
    } catch (error) {
        ctx.toast.show({
            variant: "error",
            message: error instanceof Error ? error.message : String(error),
        });
    }
}

export const COMMANDS: Command[] = [
    {
        name: "new",
        description: "Start a new conversation",
        value: "/new",
        action: (ctx) => {
            ctx.navigate("/")
        }
    },
    {
        name: 'agents',
        description: "Switch agents",
        value: "/agents",
        action: (ctx) => {
            ctx.dialog.open({
                title: "Select Agent",
                children: <AgentsDialogContent 
                currentMode={ctx.mode}
                onSelecteMode={ctx.setMode}
                />
            })
        }
    },
    {
        name: 'models',
        description: "Select AI model for generation",
        value: "/models",
        action: (ctx) => {
            ctx.dialog.open({
                title: "Select Model",
                children: <ModelsDialogContent 
                models={SUPPORTED_CHAT_MODELS.map((model) => model.id)}
                onSelectModel={ctx.setModel}
                />
            })
        }
    },
    {
        name: 'sessions',
        description: "Browse past sessions",
        value: "/sessions",
        action: (ctx) => {
            ctx.dialog.open({
                title: "Sessions",
                children: <SessionsDialogContent />
            })
        }
    },
    {
        name: 'tree',
        description: "Browse the current session tree and jump to any node",
        value: "/tree",
        action: (ctx) => {
            if (!ctx.sessionTree) {
                ctx.toast.show({ variant: "error", message: "Session tree is not available here" });
                return;
            }
            ctx.dialog.open({
                title: "Session Tree",
                children: <SessionTreeDialogContent tree={ctx.sessionTree} />,
            });
        },
    },
    {
        name: 'jump',
        description: "Jump to any node in the current session tree",
        value: "/jump",
        action: (ctx) => {
            if (!ctx.sessionTree) {
                ctx.toast.show({ variant: "error", message: "Session tree is not available here" });
                return;
            }
            ctx.dialog.open({
                title: "Jump to Session Node",
                children: <SessionTreeDialogContent tree={ctx.sessionTree} />,
            });
        },
    },
    {
        name: 'parent',
        description: "Jump to the parent of the active session node",
        value: "/parent",
        action: async (ctx) => {
            if (!ctx.sessionTree) {
                ctx.toast.show({ variant: "error", message: "Session tree is not available here" });
                return;
            }
            if (!ctx.sessionTree.parentEntryId) {
                ctx.toast.show({ message: "Already at the root session node" });
                return;
            }
            await requestSessionTreeJump(ctx, ctx.sessionTree.parentEntryId);
        },
    },
    {
        name: 'root',
        description: "Jump to the root of the current session tree",
        value: "/root",
        action: async (ctx) => {
            if (!ctx.sessionTree) {
                ctx.toast.show({ variant: "error", message: "Session tree is not available here" });
                return;
            }
            await requestSessionTreeJump(ctx, ctx.sessionTree.rootEntryId);
        },
    },
    {
        name: 'compact',
        description: "Compact older context on the active session branch",
        value: "/compact",
        action: async (ctx) => {
            if (!ctx.compact) {
                ctx.toast.show({ variant: "error", message: "Context compaction is not available here" });
                return;
            }

            try {
                const result = await ctx.compact();
                const usage = `${result.inputTokensBefore} → ${result.inputTokensAfter} / ${result.inputBudgetTokens} tokens`;
                const pruning = result.toolResultPruning.prunedResults > 0
                    ? `; pruned ${result.toolResultPruning.prunedResults} tool result(s)`
                    : "";
                const fallback = result.fallbackUsed
                    ? `; deterministic fallback (${result.fallbackReason ?? "unknown"})`
                    : "";

                if (result.status === "noop") {
                    const eligibility = result.eligibility;
                    const reasonMessage = (() => {
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
                    ctx.toast.show({
                        message: `${reasonMessage} (${result.reason ?? "no-op"}); ${usage}${pruning}${fallback}`,
                    });
                    return;
                }

                ctx.toast.show({
                    variant: "success",
                    message: `Manual context compaction complete (trigger=manual); ${usage}${pruning}${fallback}`,
                });
            } catch (error) {
                ctx.toast.show({
                    variant: "error",
                    message: `Context compaction failed: ${error instanceof Error ? error.message : String(error)}`,
                });
            }
        },
    },
    {
        name: 'settings',
        description: "Inspect and configure global/project agent settings",
        value: "/settings",
        action: (ctx) => {
            ctx.dialog.open({
                title: "MORE-MORE-CODE Settings",
                children: <SettingsDialogContent />,
            });
        },
    },
    {
        name: 'theme',
        description: "Change the theme of the interface",
        value: "/theme",
        action: (ctx) => {
            ctx.dialog.open({
                title: "Select Theme",
                children: <ThemeDialogContent />
            })
        }

    },
    {
        name: 'login',
        description: "Log in to your account",
        value: "/login",
        action: async (ctx) => {
            ctx.toast.show({
                message: "Opening browser to sign in...",
            })

            try {
                await performLogin();
                ctx.toast.show({
                    message: "Successfully signed in!",
                    variant: "success",
                })
            } catch (error) {
                const message = error instanceof Error 
                ? error.message 
                : String(error);
                ctx.toast.show({
                    message: `Login failed: ${message}`,
                    variant: "error",
                })
            }
        }
    },
    {
        name: 'logout',
        description: "Log out of your account",
        value: "/logout",
        action: (ctx) => {
            clearAuth(); // 清除身份验证数据
            ctx.toast.show({
                message: "Signed out...",
                variant: "success", // 显示成功消息
            })
        }
    },
    {
        name: 'upgrade',
        description: "Buy more credits or upgrade your plan",
        value: "/upgrade",
        action: async (ctx) => {
            ctx.toast.show({
                message: "Opening credits checkout...",
            })

            try {
                await openUpgradeCheckout();
                ctx.toast.show({
                    message: "Opened checkout in browser.",
                    variant: "success",
                })
            } catch (error) {
                const message = error instanceof Error 
                ? error.message 
                : String(error);
                ctx.toast.show({
                    message: `Failed to open checkout: ${message}`,
                    variant: "error",
                })
            }
        }
    },
    {
        name: 'usage',
        description: "Open billing portal in your browser",
        value: "/usage",
        action: async (ctx) => {
            ctx.toast.show({
                message: "Opening billing portal...",
            })

            try {
                await openBillingPortal();
                ctx.toast.show({
                    message: "Opened billing portal in browser.",
                    variant: "success",
                })
            } catch (error) {
                const message = error instanceof Error 
                ? error.message 
                : String(error);
                ctx.toast.show({
                    message: `Failed to open billing portal: ${message}`,
                    variant: "error",
                })
            }
        }
    },
    {
        name: "exit",
        description: "Exit the program",
        value: "/exit",
        action: (ctx) => {
            ctx.exit()
        }
    },
]
