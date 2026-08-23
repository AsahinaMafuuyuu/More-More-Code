import {
    RulePermissionPolicy,
    type PermissionPolicy,
    type PermissionRule,
} from "@more-more-code/harness";
import type { ResolvedAgentConfig } from "./agent-config";

const LOCKED_TOOL_PERMISSION_RULES: readonly PermissionRule[] = [
    {
        effect: "deny",
        scopes: ["outside-workspace"],
        policy: "default",
        reason: "Tool resources outside the workspace are not allowed",
    },
];

/**
 * Build one effective policy from code defaults and resolved global/project
 * overrides, then append non-overridable containment rules. The final hard
 * rule keeps policy decisions aligned with native filesystem execution.
 */
export function createEffectivePermissionPolicy(
    config: ResolvedAgentConfig,
): PermissionPolicy {
    return new RulePermissionPolicy({
        defaultEffect: config.permissions.default,
        defaultPolicy: "default",
        rules: [
            ...config.permissions.rules,
            ...LOCKED_TOOL_PERMISSION_RULES,
        ],
    });
}
