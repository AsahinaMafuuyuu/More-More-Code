import { TextAttributes } from "@opentui/core";
import { useState } from "react";
import { join } from "path";
import open from "open";
import { MAX_TOOL_BATCH_CONCURRENCY } from "@more-more-code/harness";
import { DialogSearchList } from "../dialog-search-list";
import {
    getAgentEnvironment,
    persistAgentEnvironmentToolExecution,
    reloadAgentEnvironment,
    type AgentEnvironment,
} from "../../lib/agent-environment";
import { ProcessSandbox } from "../../lib/process-sandbox";
import { useToast } from "../../providers/toast";

const ACTIONS = [
    { id: "tool-execution", label: "Configure tool execution" },
    { id: "global-config", label: "Open global config" },
    { id: "project-config", label: "Open project config" },
    { id: "global-instructions", label: "Open global instructions" },
    { id: "project-instructions", label: "Open project instructions" },
    { id: "agents-skills", label: "Open ~/.agents skills" },
    { id: "reload", label: "Reload configuration" },
] as const;

type SettingsAction = (typeof ACTIONS)[number];

type ToolExecutionAction =
    | { id: "back"; label: string; kind: "back" }
    | { id: "mode-serial" | "mode-parallel"; label: string; kind: "mode"; value: "serial" | "parallel" }
    | { id: `concurrency-${number}`; label: string; kind: "concurrency"; value: number };

function toolExecutionActions(environment: AgentEnvironment): ToolExecutionAction[] {
    const current = environment.config.resolved.tools.execution;
    const concurrency = Array.from({ length: MAX_TOOL_BATCH_CONCURRENCY }, (_, index) => index + 1);
    return [
        { id: "back", label: "← Back to settings", kind: "back" },
        {
            id: "mode-serial",
            label: `Mode: serial${current.mode === "serial" ? " · current" : ""}`,
            kind: "mode",
            value: "serial",
        },
        {
            id: "mode-parallel",
            label: `Mode: parallel${current.mode === "parallel" ? " · current" : ""}`,
            kind: "mode",
            value: "parallel",
        },
        ...concurrency.map((value): ToolExecutionAction => ({
            id: `concurrency-${value}`,
            label: `Max concurrency: ${value}${current.maxConcurrency === value ? " · current" : ""}`,
            kind: "concurrency",
            value,
        })),
    ];
}

function SettingsSummary({ environment }: { environment: AgentEnvironment }) {
    const native = environment.tools.listSources().find((source) => source.kind === "native");
    const mcp = environment.tools.listSources().filter((source) => source.kind === "mcp");
    const sandbox = new ProcessSandbox(environment.config.resolved.sandbox).getStatus();

    return (
        <box flexDirection="column" gap={1}>
            <box flexDirection="column">
                <text attributes={TextAttributes.BOLD}>Global</text>
                <text attributes={TextAttributes.DIM}>{environment.config.paths.globalDir}</text>
            </box>
            <box flexDirection="column">
                <text attributes={TextAttributes.BOLD}>Project</text>
                <text attributes={TextAttributes.DIM}>{environment.config.paths.projectDir}</text>
            </box>
            <box flexDirection="column">
                <text attributes={TextAttributes.BOLD}>Compatible skills</text>
                <text attributes={TextAttributes.DIM}>{environment.config.paths.agentsSkillsDir}</text>
            </box>
            <text>
                instructions {environment.instructions.length} · skills {environment.skills.list().length} · native tools {native?.tools.length ?? 0} · mcp servers {mcp.length}
            </text>
            <text>
                branch summary on jump: {environment.config.resolved.session.branchSummaryOnJump}
            </text>
            <text>
                tool execution: {environment.config.resolved.tools.execution.mode}
                {environment.config.resolved.tools.execution.mode === "parallel"
                    ? ` · max concurrency ${environment.config.resolved.tools.execution.maxConcurrency}`
                    : ""}
            </text>
            <text>
                process sandbox: {sandbox.mode} · provider {sandbox.provider} · network {sandbox.network} · env {sandbox.environment}
            </text>
            {sandbox.reason ? (
                <text attributes={TextAttributes.DIM}>sandbox note: {sandbox.reason}</text>
            ) : null}
            <text attributes={TextAttributes.DIM}>
                Project config overrides global config. Edit the files, then reload here.
            </text>
        </box>
    );
}

export function SettingsDialogContent() {
    const toast = useToast();
    const [environment, setEnvironment] = useState(() => getAgentEnvironment());
    const [page, setPage] = useState<"root" | "tool-execution">("root");

    const execute = async (action: SettingsAction) => {
        try {
            if (action.id === "tool-execution") {
                setPage("tool-execution");
                return;
            }
            if (action.id === "reload") {
                const next = await reloadAgentEnvironment();
                setEnvironment(next);
                toast.show({ variant: "success", message: "MORE-MORE-CODE settings reloaded" });
                return;
            }

            const { config } = environment;
            const paths = config.paths;
            const globalInstructionsPath = join(
                paths.globalDir,
                config.global.instructions?.file ?? "AGENTS.md",
            );
            const projectInstructionsPath = join(
                paths.projectDir,
                config.project.instructions?.file ?? "AGENTS.md",
            );
            const path = action.id === "global-config"
                ? paths.globalConfigPath
                : action.id === "project-config"
                    ? paths.projectConfigPath
                    : action.id === "global-instructions"
                        ? globalInstructionsPath
                        : action.id === "project-instructions"
                            ? projectInstructionsPath
                            : paths.agentsSkillsDir;
            await open(path);
            toast.show({ message: `Opened ${path}` });
        } catch (error) {
            toast.show({
                variant: "error",
                message: error instanceof Error ? error.message : String(error),
            });
        }
    };

    const executeToolExecution = async (action: ToolExecutionAction) => {
        if (action.kind === "back") {
            setPage("root");
            return;
        }
        try {
            const next = await persistAgentEnvironmentToolExecution(
                action.kind === "mode"
                    ? { mode: action.value }
                    : { maxConcurrency: action.value },
                "project",
            );
            setEnvironment(next);
            toast.show({
                variant: "success",
                message: action.kind === "mode"
                    ? `Tool execution mode set to ${action.value}`
                    : `Tool max concurrency set to ${action.value}`,
            });
        } catch (error) {
            toast.show({
                variant: "error",
                message: error instanceof Error ? error.message : String(error),
            });
        }
    };

    return (
        <box flexDirection="column" gap={1}>
            <SettingsSummary environment={environment} />
            {page === "root" ? (
                <DialogSearchList
                    items={[...ACTIONS]}
                    getKey={(item) => item.id}
                    filterFn={(item, query) => item.label.toLowerCase().includes(query.toLowerCase())}
                    onSelect={(item) => void execute(item)}
                    renderItem={(item, selected) => (
                        <text fg={selected ? "black" : undefined}>{item.label}</text>
                    )}
                    placeholder="Settings action"
                />
            ) : (
                <DialogSearchList
                    items={toolExecutionActions(environment)}
                    getKey={(item) => item.id}
                    filterFn={(item, query) => item.label.toLowerCase().includes(query.toLowerCase())}
                    onSelect={(item) => void executeToolExecution(item)}
                    renderItem={(item, selected) => (
                        <text fg={selected ? "black" : undefined}>{item.label}</text>
                    )}
                    placeholder="Tool execution setting"
                />
            )}
        </box>
    );
}
