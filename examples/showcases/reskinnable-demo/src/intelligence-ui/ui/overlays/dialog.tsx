import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useId,
  useRef,
} from 'react';
import { createPortal } from 'react-dom';

import {
  cycleFocus,
  getFocusableElements,
  useModalInertness,
  useRestoreFocus,
} from './focus-management';
import styles from './dialog.module.css';

export type DialogProps = {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly children: ReactNode;
  /** Scope product-specific presentation without replacing the modal's behavior. */
  readonly className?: string;
  readonly footer?: ReactNode;
  readonly closeLabel?: string;
  readonly dismissible?: boolean;
  readonly initialFocusRef?: RefObject<HTMLElement | null>;
  /** Restore focus when an async opener lost focus while it was disabled. */
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
  /**
   * Width preset. `md` (default) is the standard ~520px dialog; `lg` widens to
   * ~880px on roomy viewports (still capped to the viewport) for content like
   * code snippets that read better without wrapping.
   */
  readonly size?: 'md' | 'lg';
};

/**
 * Renders an accessible modal dialog with focus trapping and opener restoration.
 *
 * @param props Dialog state, labels, and content.
 * @returns A portal-mounted modal dialog when open.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  className,
  footer,
  closeLabel = 'Close dialog',
  dismissible = true,
  initialFocusRef,
  returnFocusRef,
  size = 'md',
}: DialogProps) {
  const titleId = useId();
  const descriptionId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  useRestoreFocus(open, returnFocusRef);
  useModalInertness(open, rootRef);

  useEffect(() => {
    if (!open || !dialogRef.current) {
      return;
    }

    const initialTarget =
      initialFocusRef?.current ??
      getFocusableElements(dialogRef.current).find(
        (element) => !element.hasAttribute('data-cpki-dialog-close'),
      ) ??
      dialogRef.current;

    initialTarget.focus();
  }, [initialFocusRef, open]);

  if (!open) {
    return null;
  }

  const closeDialog = () => {
    if (dismissible) {
      onOpenChange(false);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && dismissible) {
      event.stopPropagation();
      onOpenChange(false);
      return;
    }

    if (dialogRef.current) {
      cycleFocus(event, dialogRef.current);
    }
  };

  return createPortal(
    <div
      className={styles.backdrop}
      data-cpki-dialog-root="true"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          closeDialog();
        }
      }}
      ref={rootRef}
    >
      <div
        aria-describedby={description ? descriptionId : undefined}
        aria-labelledby={titleId}
        aria-modal="true"
        className={[styles.dialog, className].filter(Boolean).join(' ')}
        data-size={size}
        onKeyDown={handleKeyDown}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <div className={styles.header} data-cpki-dialog-header>
          <div>
            <h2 className={styles.title} id={titleId}>
              {title}
            </h2>
            {description ? (
              <p className={styles.description} id={descriptionId}>
                {description}
              </p>
            ) : null}
          </div>
          {dismissible ? (
            <button
              aria-label={closeLabel}
              className={styles.closeButton}
              data-cpki-dialog-close="true"
              onClick={() => onOpenChange(false)}
              type="button"
            >
              <svg
                aria-hidden="true"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              >
                <path d="m6 6 12 12M18 6 6 18" />
              </svg>
            </button>
          ) : null}
        </div>
        <div className={styles.body} data-cpki-dialog-body>
          {children}
        </div>
        {footer ? <div className={styles.footer}>{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
