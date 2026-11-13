export type PendingResponse = {
  current: boolean;
};

type SubmitResponseOptions = {
  pending: PendingResponse;
  respond: (result: unknown) => Promise<void>;
  result: unknown;
  onPendingChange: (pending: boolean) => void;
};

/**
 * Resolves a local human-in-the-loop response once per mounted control.
 */
export async function submitResponse({
  pending,
  respond,
  result,
  onPendingChange,
}: SubmitResponseOptions): Promise<void> {
  if (pending.current) {
    return;
  }

  pending.current = true;
  onPendingChange(true);
  await respond(result);
}
