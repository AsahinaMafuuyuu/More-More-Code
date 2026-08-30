import type { RuntimeSessionRecoveryReport } from "@more-more-code/harness";

export function formatRuntimeRecoveryNotice(
    report: RuntimeSessionRecoveryReport,
): string | null {
    if (report.incompleteRunIds.length === 0
        && report.pendingExternalOperations.length === 0) {
        return null;
    }

    return `Recovered ${report.incompleteRunIds.length} incomplete run(s) and ${report.pendingExternalOperations.length} pending external operation(s). Nothing was replayed.`;
}
