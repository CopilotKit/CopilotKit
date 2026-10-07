/* eslint-disable react-hooks/set-state-in-effect -- copied verbatim from the Intelligence web app, whose lint config does not enable the React Compiler rules. */
import { useCallback, useEffect, useRef, useState } from 'react';

/** Writes text to the clipboard; rejects or throws when the write fails. */
export type ClipboardWriter = (value: string) => Promise<void>;

/**
 * Outcome of the latest copy. `unavailable` means the browser exposes no
 * Clipboard API, so nothing was attempted; `failed` means a write was
 * attempted and threw or rejected.
 */
export type CopyToClipboardStatus =
  | 'copied'
  | 'failed'
  | 'idle'
  | 'unavailable';

/** How long a successful copy is confirmed before the control returns to idle. */
export const COPY_CONFIRMATION_MS = 2_000;

/** Options for {@link useCopyToClipboard}. */
export interface UseCopyToClipboardOptions {
  /**
   * The status returns to idle whenever this changes. Pass the value the
   * control copies (or the record that owns it) so a result never describes a
   * different value; a copy still in flight when it changes is discarded.
   */
  readonly resetKey?: string | null;
  /** Clipboard writer; defaults to `navigator.clipboard.writeText`. */
  readonly writeText?: ClipboardWriter;
}

/** State and controls returned by {@link useCopyToClipboard}. */
export interface CopyToClipboard {
  /** Outcome of the latest copy, for visible feedback. */
  readonly status: CopyToClipboardStatus;
  /**
   * The status to render in a visually hidden `role="status"` region. It is
   * cleared when each copy starts and set again on a later task, so an
   * identical repeated result is a fresh change that assistive technology
   * reads again. Use a `role="status"` node rather than an `aria-live`
   * attribute: Radix modals keep `[aria-live]` nodes exposed behind a dialog.
   */
  readonly announcedStatus: CopyToClipboardStatus;
  /** Writes `text` to the clipboard and reports the outcome. */
  readonly copy: (text: string) => void;
  /** Returns to idle and discards any copy still in flight. */
  readonly reset: () => void;
}

interface CopyState {
  readonly announcedStatus: CopyToClipboardStatus;
  readonly status: CopyToClipboardStatus;
}

const IDLE: CopyState = { announcedStatus: 'idle', status: 'idle' };

/**
 * Starts a clipboard write with the given writer, or with the browser
 * Clipboard API when none is supplied.
 *
 * @param text - Text to copy.
 * @param writeText - Optional injected writer.
 * @returns The pending write, or `undefined` when no Clipboard API exists.
 */
function startWrite(
  text: string,
  writeText: ClipboardWriter | undefined,
): Promise<void> | undefined {
  if (writeText !== undefined) {
    return writeText(text);
  }
  return navigator.clipboard?.writeText(text);
}

/**
 * Owns one copy-to-clipboard control's result.
 *
 * A confirmed copy returns to idle after {@link COPY_CONFIRMATION_MS}. A
 * failure stays until the next copy, {@link CopyToClipboard.reset}, or a
 * `resetKey` change, because its message tells the operator what to do
 * instead. Each copy takes a token, so a write that settles after a newer
 * copy, a reset, a `resetKey` change, or unmount is ignored.
 *
 * @param options - Reset key and optional clipboard writer.
 * @returns The copy status, its announcement, and `copy`/`reset` handlers.
 */
export function useCopyToClipboard(
  options: UseCopyToClipboardOptions = {},
): CopyToClipboard {
  const { resetKey, writeText } = options;
  const [state, setState] = useState<CopyState>(IDLE);
  const tokenRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimer = useCallback((): void => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const reset = useCallback((): void => {
    tokenRef.current += 1;
    clearTimer();
    setState(IDLE);
  }, [clearTimer]);

  useEffect(() => {
    setState(IDLE);
    return () => {
      tokenRef.current += 1;
      clearTimer();
    };
  }, [resetKey, clearTimer]);

  const copy = useCallback(
    (text: string): void => {
      tokenRef.current += 1;
      const token = tokenRef.current;
      clearTimer();
      setState((current) =>
        current.announcedStatus === 'idle'
          ? current
          : { announcedStatus: 'idle', status: current.status },
      );

      /**
       * Records the outcome on a later task, so the cleared announcement
       * commits first, when this copy is still the latest one.
       *
       * @param status - The outcome of this copy.
       */
      const settle = (status: CopyToClipboardStatus): void => {
        if (tokenRef.current !== token) {
          return;
        }
        clearTimer();
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          if (tokenRef.current !== token) {
            return;
          }
          setState({ announcedStatus: status, status });
          if (status === 'copied') {
            timerRef.current = setTimeout(() => {
              timerRef.current = null;
              if (tokenRef.current === token) {
                setState(IDLE);
              }
            }, COPY_CONFIRMATION_MS);
          }
        }, 0);
      };

      let request: Promise<void> | undefined;
      try {
        request = startWrite(text, writeText);
      } catch (error: unknown) {
        console.error('Clipboard copy failed', error);
        settle('failed');
        return;
      }
      if (request === undefined) {
        settle('unavailable');
        return;
      }
      request.then(
        () => {
          settle('copied');
        },
        (error: unknown) => {
          console.error('Clipboard copy failed', error);
          settle('failed');
        },
      );
    },
    [clearTimer, writeText],
  );

  return {
    announcedStatus: state.announcedStatus,
    copy,
    reset,
    status: state.status,
  };
}
