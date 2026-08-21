export type PermissionDecision = "allow" | "deny" | "ask";

export interface Capability {
  name: string;
  scope?: string[];
}

export interface PermissionRequest {
  capability: string;
  resource?: string;
}

export interface PermissionPolicy {
  decide(request: PermissionRequest): PermissionDecision;
}

export interface SecurityEvent {
  action: string;
  decision: PermissionDecision;
  capability?: string;
}

export class DefaultPermissionPolicy implements PermissionPolicy {
  constructor(private readonly deniedCapabilities = new Set<string>()) {}

  decide(request: PermissionRequest): PermissionDecision {
    if (this.deniedCapabilities.has(request.capability)) return "deny";
    return "allow";
  }
}

export function canExecute(decision: PermissionDecision) {
  return decision === "allow";
}
