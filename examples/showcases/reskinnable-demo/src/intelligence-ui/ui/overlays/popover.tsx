import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';

import { classNames } from '../class-names';
import styles from './popover.module.css';

export type PopoverProps = {
  readonly triggerLabel: ReactNode;
  readonly label: string;
  readonly children: ReactNode;
  readonly open?: boolean;
  readonly defaultOpen?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly className?: string;
  readonly triggerClassName?: string;
};

/**
 * Renders a button-triggered non-modal popover with Escape and outside-pointer dismissal.
 *
 * @param props Popover trigger, state, and content.
 * @returns A trigger and positioned popover content.
 */
export function Popover({
  triggerLabel,
  label,
  children,
  open,
  defaultOpen = false,
  onOpenChange,
  className,
  triggerClassName,
}: PopoverProps) {
  const generatedId = useId();
  const contentId = `${generatedId}-content`;
  const isControlled = open !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const isOpen = isControlled ? open : uncontrolledOpen;
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const setOpen = useCallback(
    (nextOpen: boolean) => {
      if (!isControlled) {
        setUncontrolledOpen(nextOpen);
      }

      onOpenChange?.(nextOpen);

      if (!nextOpen) {
        triggerRef.current?.focus();
      }
    },
    [isControlled, onOpenChange],
  );

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;

      if (target instanceof Node && rootRef.current?.contains(target)) {
        return;
      }

      setOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown);

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [isOpen, setOpen]);

  return (
    <div className={classNames(styles.root, className)} ref={rootRef}>
      <button
        aria-controls={isOpen ? contentId : undefined}
        aria-expanded={isOpen ? 'true' : 'false'}
        aria-haspopup="dialog"
        className={classNames(styles.trigger, triggerClassName)}
        onClick={() => setOpen(!isOpen)}
        ref={triggerRef}
        type="button"
      >
        {triggerLabel}
      </button>
      {isOpen ? (
        <div
          aria-label={label}
          className={styles.content}
          id={contentId}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              setOpen(false);
            }
          }}
          role="dialog"
          tabIndex={-1}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
