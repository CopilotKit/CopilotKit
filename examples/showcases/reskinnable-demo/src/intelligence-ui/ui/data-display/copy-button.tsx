import { useState, type ReactNode } from 'react';

import styles from './data-display.module.css';

export type ClipboardWriter = (value: string) => Promise<void>;

export interface CopyButtonProps {
  readonly value: string;
  readonly label?: string;
  readonly copiedLabel?: string;
  readonly failedLabel?: string;
  readonly writeText?: ClipboardWriter;
}

type CopyState = 'idle' | 'copied' | 'failed';

/** Returns the best available clipboard writer for the current browser. */
function getDefaultClipboardWriter(): ClipboardWriter {
  return async (value: string): Promise<void> => {
    if (navigator.clipboard === undefined) {
      throw new Error('Clipboard API is unavailable.');
    }

    await navigator.clipboard.writeText(value);
  };
}

/** Renders a native button that copies text and announces the result. */
export function CopyButton({
  value,
  label = 'Copy',
  copiedLabel = 'Copied',
  failedLabel = 'Copy failed',
  writeText = getDefaultClipboardWriter(),
}: CopyButtonProps): ReactNode {
  const [copyState, setCopyState] = useState<CopyState>('idle');

  /** Copies the provided text through the configured clipboard writer. */
  async function handleCopy(): Promise<void> {
    try {
      await writeText(value);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  }

  const buttonLabel = copyState === 'copied' ? copiedLabel : label;
  const statusLabel = copyState === 'failed' ? failedLabel : buttonLabel;

  return (
    <button
      aria-live="polite"
      className={styles.copyButton}
      disabled={value.length === 0}
      onClick={handleCopy}
      type="button"
    >
      {statusLabel}
    </button>
  );
}
