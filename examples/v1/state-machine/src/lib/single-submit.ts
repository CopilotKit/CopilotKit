export type PendingSubmission = {
  current: boolean;
};

type SubmitOnceOptions = {
  pending: PendingSubmission;
  action: () => Promise<void> | void;
  onPendingChange: (pending: boolean) => void;
};

/**
 * Resolves a local human-in-the-loop response once per mounted control.
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
  await action();
}
