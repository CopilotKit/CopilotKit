export type PendingResponse = {
  current: boolean;
};

type SubmitResponseOptions = {
  pending: PendingResponse;
  respond: (result: unknown) => Promise<void>;
  result: unknown;
  onPendingChange: (pending: boolean) => void;
  onError: (message: string, result: unknown) => void;
};

/**
 * Sends a human-in-the-loop response and reports its UI state.
 */
export async function submitResponse({
  pending,
  respond,
  result,
  onPendingChange,
  onError,
}: SubmitResponseOptions): Promise<void> {
  if (pending.current) {
    return;
  }

  pending.current = true;
  onPendingChange(true);
  try {
    await respond(result);
  } catch {
    onError("Could not send your response. Try again.", result);
  } finally {
    pending.current = false;
    onPendingChange(false);
  }
}
