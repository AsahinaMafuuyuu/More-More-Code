export type PermissionEffect = "allow" | "deny" | "ask";

export type PermissionPolicySource = "default" | "configured";

export type PermissionResourceKind = "path" | "command" | "resource";

export type PermissionScope =
  | "workspace"
  | "outside-workspace"
  | "agent-config"
  | "external";

export interface Capability {
  name: string;
  scopes?: PermissionScope[];
}

/**
 * Resource values are available only during policy evaluation. Callers must
 * not copy them into durable Runtime Events because they may contain paths,
 * commands, or other user-authored input.
 */
export interface PermissionResource {
  kind: PermissionResourceKind;
  value: string;
  scope: PermissionScope;
  caseSensitive?: boolean;
}

export interface PermissionRequest {
  capability: string;
  resource?: PermissionResource;
}

export interface PermissionDecision {
  effect: PermissionEffect;
  policy: PermissionPolicySource;
  reason?: string;
}

export interface PermissionPolicy {
  decide(
    request: PermissionRequest,
  ): PermissionDecision | Promise<PermissionDecision>;
}

export interface PermissionRule {
  effect: PermissionEffect;
  capabilities?: readonly string[];
  commands?: readonly string[];
  paths?: readonly string[];
  resources?: readonly string[];
  scopes?: readonly PermissionScope[];
  policy?: PermissionPolicySource;
  reason?: string;
}

export interface RulePermissionPolicyOptions {
  defaultEffect?: PermissionEffect;
  defaultPolicy?: PermissionPolicySource;
  rules?: readonly PermissionRule[];
}

export interface SecurityEvent {
  action: string;
  decision: PermissionEffect;
  capability?: string;
}

/**
 * Deterministic capability policy. Rules are evaluated in declaration order
 * and the last matching rule wins, so persisted global/project overrides can
 * be appended after code defaults without duplicating the evaluation logic in
 * Tool Runtime.
 */
export class RulePermissionPolicy implements PermissionPolicy {
  private readonly defaultEffect: PermissionEffect;
  private readonly defaultPolicy: PermissionPolicySource;
  private readonly rules: readonly PermissionRule[];

  constructor(options: RulePermissionPolicyOptions = {}) {
    this.defaultEffect = options.defaultEffect ?? "allow";
    this.defaultPolicy = options.defaultPolicy ?? "default";
    this.rules = options.rules ? [...options.rules] : [];
  }

  decide(request: PermissionRequest): PermissionDecision {
    let decision: PermissionDecision = {
      effect: this.defaultEffect,
      policy: this.defaultPolicy,
    };

    for (const rule of this.rules) {
      if (!matchesPermissionRule(rule, request)) continue;
      decision = {
        effect: rule.effect,
        policy: rule.policy ?? "default",
        ...(rule.reason ? { reason: rule.reason } : {}),
      };
    }

    return decision;
  }
}

/** Compatibility adapter for callers that only need a deny set. */
export class DefaultPermissionPolicy implements PermissionPolicy {
  constructor(private readonly deniedCapabilities = new Set<string>()) {}

  decide(request: PermissionRequest): PermissionDecision {
    return {
      effect: this.deniedCapabilities.has(request.capability) ? "deny" : "allow",
      policy: "default",
    };
  }
}

export function canExecute(
  decision: PermissionEffect | PermissionDecision,
): boolean {
  return (typeof decision === "string" ? decision : decision.effect) === "allow";
}

export function isPermissionDecision(value: unknown): value is PermissionDecision {
  if (!isRecord(value)) return false;
  return (value.effect === "allow" || value.effect === "deny" || value.effect === "ask")
    && (value.policy === "default" || value.policy === "configured")
    && (value.reason === undefined || typeof value.reason === "string");
}

export function matchesPermissionRule(
  rule: PermissionRule,
  request: PermissionRequest,
): boolean {
  if (!matchesPatterns(rule.capabilities, request.capability)) return false;
  if (rule.scopes && (!request.resource || !rule.scopes.includes(request.resource.scope))) {
    return false;
  }

  if (rule.commands) {
    if (request.resource?.kind !== "command"
      || !matchesPatterns(rule.commands, request.resource.value)) {
      return false;
    }
  }
  if (rule.paths) {
    if (request.resource?.kind !== "path"
      || !matchesPathPatterns(
        rule.paths,
        normalizePath(request.resource.value),
        request.resource.caseSensitive ?? true,
      )) {
      return false;
    }
  }
  if (rule.resources) {
    if (request.resource?.kind !== "resource"
      || !matchesPatterns(rule.resources, request.resource.value)) {
      return false;
    }
  }

  return true;
}

function matchesPatterns(patterns: readonly string[] | undefined, value: string): boolean {
  if (!patterns) return true;
  return patterns.some((pattern) => globToRegExp(pattern).test(value));
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const expression = escaped
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${expression}$`);
}

function matchesPathPatterns(
  patterns: readonly string[],
  value: string,
  caseSensitive: boolean,
): boolean {
  return patterns.some((pattern) => pathGlobToRegExp(pattern, caseSensitive).test(value));
}

function pathGlobToRegExp(pattern: string, caseSensitive: boolean): RegExp {
  const normalized = normalizePath(pattern);
  let expression = "";

  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index]!;
    if (character === "*") {
      if (normalized[index + 1] === "*") {
        index += 1;
        if (normalized[index + 1] === "/") {
          index += 1;
          expression += "(?:.*/)?";
        } else {
          expression += ".*";
        }
      } else {
        expression += "[^/]*";
      }
      continue;
    }
    if (character === "?") {
      expression += "[^/]";
      continue;
    }
    expression += character.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }

  return new RegExp(`^${expression}$`, caseSensitive ? "" : "i");
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
