import { useEffect } from "react";
import type { SessionController } from "../../../app/session/session-controller";
import { ApprovalDialogContent } from "../../../components/dialogs";
import { useDialog } from "../../../providers/dialog";
import { useSessionUiSelector } from "../store/react-session-ui";
import { selectApproval } from "../store/session-ui-selectors";

export function ApprovalPresentation({ controller }: { controller: SessionController }) {
  const approval = useSessionUiSelector(selectApproval);
  const { open, close } = useDialog();

  useEffect(() => {
    if (!approval) return;
    const approvalId = approval.approvalId;
    open({
      title: "Tool approval required",
      children: (
        <ApprovalDialogContent
          request={approval}
          onResolve={(decision) => controller.resolveApproval(approvalId, decision)}
          onCancel={() => controller.cancelApproval(approvalId)}
        />
      ),
    });
    return () => close();
  }, [approval, close, controller, open]);

  return null;
}
