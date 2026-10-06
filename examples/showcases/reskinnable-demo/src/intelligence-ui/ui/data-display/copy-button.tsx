import { useSyncExternalStore, type ReactNode } from 'react';

import { Check, Copy } from 'lucide-react';
import { classNames } from '../class-names';
import { Button } from '../primitives';
import styles from './data-display.module.css';
import {
  useCopyToClipboard,
  type ClipboardWriter,
  type CopyToClipboardStatus,
} from './use-copy-to-clipboard';

export type { ClipboardWriter };

export interface CopyButtonProps {
  readonly value: string;
  readonly label?: string;
  readonly copiedLabel?: string;
  readonly failedLabel?: string;
  /** `icon` / `icon-sm` render the glyph only and name the button with `label`. */
  readonly size?: 'icon' | 'icon-sm' | 'md' | 'sm';
  readonly variant?: 'ghost' | 'outline';
  readonly writeText?: ClipboardWriter;
  /**
   * Layout-only class for the button, such as placement in a code block's
   * corner. Never use it to change the button's colours, borders, or type.
   */
  readonly className?: string;
}

const designAttribute = 'data-cpki-design';

/**
 * Watches the document root's design boundary.
 *
 * @param notify - Called when the root `data-cpki-design` attribute changes.
 * @returns A function that stops watching.
 */
function subscribeToDesign(notify: () => void): () => void {
  const observer = new MutationObserver(notify);
  observer.observe(document.documentElement, {
    attributeFilter: [designAttribute],
    attributes: true,
  });
  return () => {
    observer.disconnect();
  };
}

/**
 * Reads whether the document root opts into the Intelligence workspace design.
 *
 * @returns True when the root carries `data-cpki-design="workspace"`.
 */
function readWorkspaceDesign(): boolean {
  return document.documentElement.getAttribute(designAttribute) === 'workspace';
}

/**
 * Reports whether the workspace design is active. Intelligence sets the root
 * attribute before its first paint and Storybook sets it per story; Ops never
 * sets it, and server rendering assumes the base design.
 *
 * @returns True inside the workspace design.
 */
function useWorkspaceDesign(): boolean {
  return useSyncExternalStore(
    subscribeToDesign,
    readWorkspaceDesign,
    () => false,
  );
}

/**
 * Resolves the text for a copy outcome; an unavailable clipboard reads as a
 * failed copy.
 *
 * @param status - The copy outcome.
 * @param labels - The idle, copied, and failed labels.
 * @returns The label for that outcome.
 */
function labelFor(
  status: CopyToClipboardStatus,
  labels: {
    readonly copied: string;
    readonly failed: string;
    readonly idle: string;
  },
): string {
  switch (status) {
    case 'copied':
      return labels.copied;
    case 'failed':
    case 'unavailable':
      return labels.failed;
    case 'idle':
      return labels.idle;
  }
}

/**
 * Renders a native button that copies text and announces the result.
 *
 * Inside the workspace design it is the shared Button with a glyph. Outside it
 * (Ops) a text-size CopyButton is the original plain `<button>` with only the
 * `.copyButton` class, so page rules cascade over it exactly as before the
 * workspace design existed. Icon-only sizes are workspace controls and render
 * the shared Button everywhere.
 *
 * The announcement lives in a visually hidden `role="status"` region rather
 * than an `aria-live` attribute on the button: Radix modals keep `[aria-live]`
 * nodes (and their ancestors) exposed, which would leak the page behind a
 * dialog to assistive technology.
 *
 * @param props - The value, labels, size, variant, and optional writer.
 * @returns The copy button and its status region.
 */
export function CopyButton({
  value,
  label = 'Copy',
  copiedLabel = 'Copied',
  failedLabel = 'Copy failed',
  size = 'md',
  variant = 'outline',
  writeText,
  className,
}: CopyButtonProps): ReactNode {
  const isWorkspace = useWorkspaceDesign();
  const { announcedStatus, copy, status } = useCopyToClipboard({
    resetKey: value,
    writeText,
  });
  const labels = { copied: copiedLabel, failed: failedLabel, idle: label };
  const statusLabel = labelFor(status, labels);
  const iconOnly = size === 'icon' || size === 'icon-sm';
  const sharedProps = {
    'data-copy-state': status === 'unavailable' ? 'failed' : status,
    disabled: value.length === 0,
    onClick: (): void => {
      copy(value);
    },
    type: 'button',
  } as const;
  const announcement = (
    <span className={styles.visuallyHidden} role="status">
      {announcedStatus === 'idle' ? '' : labelFor(announcedStatus, labels)}
    </span>
  );

  if (!isWorkspace && !iconOnly) {
    return (
      <>
        <button
          {...sharedProps}
          className={classNames(styles.copyButton, className)}
        >
          {statusLabel}
        </button>
        {announcement}
      </>
    );
  }

  return (
    <>
      <Button
        {...sharedProps}
        aria-label={iconOnly ? statusLabel : undefined}
        className={className}
        size={size}
        variant={variant}
      >
        {status === 'copied' ? (
          <Check size={14} aria-hidden="true" />
        ) : (
          <Copy size={14} aria-hidden="true" />
        )}
        {iconOnly ? null : statusLabel}
      </Button>
      {announcement}
    </>
  );
}
