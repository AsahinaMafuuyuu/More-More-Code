import { useEffect, useRef } from "react";
import type { ApprovalDecision, ApprovalRequest, PermissionRequest } from "@more-more-code/harness";
import { DialogSearchList } from "../dialog-search-list";

const APPROVAL_ACTIONS: Array<{
  id: ApprovalDecision;
  label: string;
  description: string;
}> = [
  {
    id: "allow",
    label: "Allow once",
    description: "Approve only this Tool Call; permission config is unchanged",
  },
  {
    id: "deny",
    label: "Deny",
    description: "Block this Tool Call without changing permission config",
  },
];

export function ApprovalDialogContent({
  request,
  onResolve,
  onCancel,
}: {
  request: ApprovalRequest;
  onResolve: (decision: ApprovalDecision) => void;
  onCancel: () => void;
}) {
  const settledRef = useRef(false);

  useEffect(() => {
    return () => {
      if (!settledRef.current) onCancel();
    };
  }, [onCancel]);

  return (
    <box flexDirection="column" gap={1}>
      <text>{`Tool: ${request.toolName}`}</text>
      <text>{`Tool call: ${request.toolCallId.slice(0, 12)} · approval: ${request.approvalId.slice(0, 12)}`}</text>
      <box flexDirection="column" gap={1}>
        {request.requirements.map((requirement, index) => (
          <text key={`${requirement.capability}-${index}`}>
            {formatApprovalRequirement(requirement)}
          </text>
        ))}
      </box>
      <DialogSearchList
        items={APPROVAL_ACTIONS}
        getKey={(item) => item.id}
        filterFn={(item, query) => `${item.label} ${item.description}`.toLowerCase().includes(query.toLowerCase())}
        onSelect={(item) => {
          settledRef.current = true;
          onResolve(item.id);
        }}
        renderItem={(item, selected) => (
          <box flexDirection="column">
            <text fg={selected ? "black" : undefined}>{item.label}</text>
            <text>{item.description}</text>
          </box>
        )}
        placeholder="Allow this operation once?"
      />
      <text>Esc or closing this dialog cancels the pending approval.</text>
    </box>
  );
}

export function formatApprovalRequirement(requirement: PermissionRequest): string {
  const resource = requirement.resource;
  if (!resource) return requirement.capability;
  return `${requirement.capability} · ${resource.kind}/${resource.scope}: ${truncate(resource.value, 120)}`;
}

function truncate(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}
