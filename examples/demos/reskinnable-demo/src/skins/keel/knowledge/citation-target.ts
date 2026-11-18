"use client";

/**
 * Cross-component signal for "scroll the policy reader to this section, now."
 *
 * WHY THIS EXISTS. The reader deep-links as `/keel/knowledge/<docId>#<sectionId>`.
 * Reading the fragment on mount / on `hashchange` covers a first landing, an
 * in-page table-of-contents anchor, and back/forward — but it silently fails for
 * the COMMON case where a SECOND citation targets another section of the SAME
 * document already open, because two App-Router facts compound:
 *   1. `router.push()` to a URL that differs ONLY in its hash fragment does NOT
 *      emit a `hashchange` event, so a `hashchange` listener never sees it.
 *   2. `getDoc(docId)` returns a STABLE object for a given id, so an effect keyed
 *      on the resolved doc does not re-run either — nothing prompts a re-read.
 * So an in-app citation click must SIGNAL its target explicitly rather than hope
 * the URL is observed. Producers call {@link requestSection}; the reader
 * subscribes.
 *
 * SINGLE-USE. The target is consumed the moment the reader applies it (see
 * {@link consumeSectionTarget}), so it cannot outlive its navigation. This is
 * what stops a stale target from being replayed on a LATER, hash-less remount:
 * open POL-114 §minimum-necessary from a citation (applied → cleared), leave,
 * then re-open POL-114 from the Knowledge list with no fragment — the store is
 * empty, so the reader lands at the top instead of re-highlighting the old spot.
 * A repeat click on the very same section still re-fires, because it writes a
 * fresh (non-null) target that the reader consumes anew. Deep-link/paste and
 * back/forward keep working via the reader's own hash read; this store only
 * carries in-app navigations.
 *
 * Client-only, but React-free and JSX-free, so it stays a plain `.ts` module.
 */
export interface SectionTarget {
  docId: string;
  sectionId: string;
}

let current: SectionTarget | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

/** Ask the open reader to land on `docId#sectionId`. Safe to repeat. */
export function requestSection(docId: string, sectionId: string): void {
  current = { docId, sectionId };
  notify();
}

/**
 * Clear the current target once a reader has applied it. Making the signal
 * single-use is what prevents it from being replayed on a later remount (the
 * reader's applied-guard is component-local and resets on remount, but the
 * store is a module singleton — clearing it is the only state that survives).
 * Notifies subscribers so `useSyncExternalStore` snapshots stay consistent.
 */
export function consumeSectionTarget(): void {
  if (current === null) return;
  current = null;
  notify();
}

/** Subscribe to target changes; returns an unsubscribe. For `useSyncExternalStore`. */
export function subscribeSectionTarget(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/** The current target, or `null`. Stable reference between requests (snapshot-safe). */
export function getSectionTarget(): SectionTarget | null {
  return current;
}
