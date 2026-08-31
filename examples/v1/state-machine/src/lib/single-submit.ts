export type PendingSubmission = {
  current: boolean;
};

type SubmitOnceOptions = {
  pending: PendingSubmission;
  action: () => Promise<void> | void;
  onPendingChange: (pending: boolean) => void;
};

/**
 * Runs a user response once and unlocks it only when the response fails.
 */
export async function submitOnce({
  pending,
  action,
  onPendingChange,
}: SubmitOnceOptions): Promise<void> {
  if (pending.current) {
    return;
  }

  pending.current = true;
  onPendingChange(true);
  try {
    await action();
  } catch (error) {
    pending.current = false;
    onPendingChange(false);
    throw error;
  }
}
