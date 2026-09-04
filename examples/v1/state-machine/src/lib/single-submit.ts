export type PendingSubmission = {
  current: boolean;
};

export type SubmissionFailure = {
  message: string;
  retry: () => Promise<void> | void;
};

type SubmitOnceOptions = {
  pending: PendingSubmission;
  action: () => Promise<void> | void;
  onPendingChange: (pending: boolean) => void;
  onError: (failure: SubmissionFailure) => void;
};

/**
 * Runs a user response once and unlocks it only when the response fails.
 */
export async function submitOnce({
  pending,
  action,
  onPendingChange,
  onError,
}: SubmitOnceOptions): Promise<void> {
  if (pending.current) {
    return;
  }

  pending.current = true;
  onPendingChange(true);
  try {
    await action();
  } catch {
    pending.current = false;
    onPendingChange(false);
    onError({
      message: "Could not send your response. Try again.",
      retry: action,
    });
  }
}
