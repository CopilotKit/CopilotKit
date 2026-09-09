/**
 * Tiny event bus for cross-component issue actions.
 *
 * The inline issue cards rendered in chat call `requestFocusIssue(id)` to
 * scroll to and highlight the matching card on the board.
 */

type Listener = (issueId: string) => void;

const listeners = new Set<Listener>();

export function onFocusIssue(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function requestFocusIssue(issueId: string): void {
  for (const fn of listeners) fn(issueId);
}
