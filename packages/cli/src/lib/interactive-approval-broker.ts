import type {
  ApprovalBroker,
  ApprovalDecision,
  ApprovalRequest,
  ApprovalRequestOptions,
  ApprovalResolution,
} from "@more-more-code/harness";
import { ApprovalCancelledError } from "@more-more-code/harness";

type PendingApproval = {
  request: ApprovalRequest;
  resolve: (resolution: ApprovalResolution) => void;
  reject: (error: Error) => void;
  signal: AbortSignal;
  onAbort: () => void;
};

export type ApprovalSubscriber = (pending: readonly ApprovalRequest[]) => void;

export class InteractiveApprovalBroker implements ApprovalBroker {
  private readonly pending = new Map<string, PendingApproval>();
  private readonly subscribers = new Set<ApprovalSubscriber>();

  getPending(): ApprovalRequest[] {
    return [...this.pending.values()].map(({ request }) => structuredClone(request));
  }

  subscribe(subscriber: ApprovalSubscriber): () => void {
    this.subscribers.add(subscriber);
    subscriber(this.getPending());
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  request(
    request: ApprovalRequest,
    options: ApprovalRequestOptions,
  ): Promise<ApprovalResolution> {
    if (this.pending.has(request.approvalId)) {
      return Promise.reject(new Error(`Duplicate approval id ${request.approvalId}`));
    }
    if (options.signal.aborted) {
      return Promise.reject(toAbortError(options.signal.reason));
    }

    return new Promise<ApprovalResolution>((resolve, reject) => {
      const onAbort = () => {
        const pending = this.pending.get(request.approvalId);
        if (!pending) return;
        this.pending.delete(request.approvalId);
        options.signal.removeEventListener("abort", onAbort);
        reject(toAbortError(options.signal.reason));
        this.notify();
      };
      this.pending.set(request.approvalId, {
        request: structuredClone(request),
        resolve,
        reject,
        signal: options.signal,
        onAbort,
      });
      options.signal.addEventListener("abort", onAbort, { once: true });
      this.notify();
    });
  }

  resolve(approvalId: string, decision: ApprovalDecision): boolean {
    const pending = this.pending.get(approvalId);
    if (!pending) return false;

    this.pending.delete(approvalId);
    pending.signal.removeEventListener("abort", pending.onAbort);
    pending.resolve({ decision });
    this.notify();
    return true;
  }

  cancel(approvalId: string, reason = "Approval was cancelled"): boolean {
    const pending = this.pending.get(approvalId);
    if (!pending) return false;

    this.pending.delete(approvalId);
    pending.signal.removeEventListener("abort", pending.onAbort);
    pending.reject(new ApprovalCancelledError(reason));
    this.notify();
    return true;
  }

  cancelAll(reason: Error = new ApprovalCancelledError("Approval broker closed")): void {
    const pending = [...this.pending.values()];
    if (pending.length === 0) return;

    this.pending.clear();
    for (const transaction of pending) {
      transaction.signal.removeEventListener("abort", transaction.onAbort);
      transaction.reject(reason);
    }
    this.notify();
  }

  private notify(): void {
    const snapshot = this.getPending();
    for (const subscriber of this.subscribers) {
      subscriber(snapshot);
    }
  }
}

function toAbortError(reason: unknown): Error {
  return reason instanceof Error ? reason : new Error("Approval was cancelled");
}
