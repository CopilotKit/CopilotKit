export interface VisibleRealThreadCandidate {
  readonly id: string;
  readonly updatedAt?: string | null;
  readonly createdAt?: string | null;
}

export interface SelectVisibleRealThreadInput {
  readonly threads: readonly VisibleRealThreadCandidate[];
  readonly selectedThreadId: string | null;
}

function parsedTimestamp(value: string | null | undefined): number | null {
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function compareNewestDate(
  left: string | null | undefined,
  right: string | null | undefined,
): number {
  const leftTimestamp = parsedTimestamp(left);
  const rightTimestamp = parsedTimestamp(right);

  if (leftTimestamp === null) return rightTimestamp === null ? 0 : 1;
  if (rightTimestamp === null) return -1;
  if (leftTimestamp === rightTimestamp) return 0;
  return leftTimestamp > rightTimestamp ? -1 : 1;
}

function compareVisibleThreads(
  left: VisibleRealThreadCandidate,
  right: VisibleRealThreadCandidate,
): number {
  const updatedOrder = compareNewestDate(left.updatedAt, right.updatedAt);
  if (updatedOrder !== 0) return updatedOrder;

  const createdOrder = compareNewestDate(left.createdAt, right.createdAt);
  if (createdOrder !== 0) return createdOrder;

  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
}

/**
 * Keeps a visible explicit real-Thread selection or returns the deterministic
 * newest visible real Thread without mutating the candidate list.
 */
export function selectVisibleRealThreadId(
  input: SelectVisibleRealThreadInput,
): string | null {
  if (
    input.selectedThreadId !== null &&
    input.threads.some((thread) => thread.id === input.selectedThreadId)
  ) {
    return input.selectedThreadId;
  }

  return [...input.threads].sort(compareVisibleThreads)[0]?.id ?? null;
}
