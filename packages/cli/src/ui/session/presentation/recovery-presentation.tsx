import { useEffect, useRef } from "react";
import { useToast } from "../../../providers/toast";
import { useSessionUiSelector } from "../store/react-session-ui";
import { selectRecovery } from "../store/session-ui-selectors";

export function RecoveryPresentation() {
  const recovery = useSessionUiSelector(selectRecovery);
  const toast = useToast();
  const reportedKey = useRef<string | null>(null);

  useEffect(() => {
    if (!recovery || reportedKey.current === recovery.key) return;
    reportedKey.current = recovery.key;
    toast.show({ variant: "info", duration: 8000, message: recovery.message });
  }, [recovery, toast]);

  return null;
}
