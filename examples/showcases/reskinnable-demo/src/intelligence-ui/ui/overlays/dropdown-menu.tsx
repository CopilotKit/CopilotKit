import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';

import { classNames } from '../class-names';
import styles from './dropdown-menu.module.css';

export interface DropdownMenuItem {
  readonly id: string;
  readonly label: ReactNode;
  readonly onSelect?: () => void;
  readonly disabled?: boolean;
  readonly destructive?: boolean;
}

export interface DropdownMenuProps {
  readonly triggerLabel: ReactNode;
  readonly label: string;
  readonly items: readonly DropdownMenuItem[];
  readonly open?: boolean;
  readonly defaultOpen?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  readonly className?: string;
  readonly triggerClassName?: string;
}

/** Returns the next menu item index for a roving keyboard move. */
function getNextIndex(
  currentIndex: number,
  itemCount: number,
  direction: 1 | -1,
): number {
  if (itemCount === 0) {
    return -1;
  }

  return (currentIndex + direction + itemCount) % itemCount;
}

/**
 * Renders a button-triggered action menu with roving keyboard focus.
 *
 * @param props Menu trigger, items, and optional controlled open state.
 * @returns A menu trigger and menu surface when open.
 */
export function DropdownMenu({
  triggerLabel,
  label,
  items,
  open,
  defaultOpen = false,
  onOpenChange,
  className,
  triggerClassName,
}: DropdownMenuProps): ReactNode {
  const generatedId = useId();
  const menuId = `${generatedId}-menu`;
  const isControlled = open !== undefined;
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const [activeIndex, setActiveIndex] = useState(0);
  const isOpen = isControlled ? open : uncontrolledOpen;
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const setOpen = useCallback(
    (nextOpen: boolean, nextActiveIndex = 0) => {
      if (!isControlled) {
        setUncontrolledOpen(nextOpen);
      }

      setActiveIndex(nextActiveIndex);
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

    itemRefs.current[activeIndex]?.focus();
    return undefined;
  }, [activeIndex, isOpen]);

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

  const selectItem = (item: DropdownMenuItem) => {
    if (item.disabled) {
      return;
    }

    item.onSelect?.();
    setOpen(false);
  };

  const handleTriggerKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true, 0);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true, Math.max(items.length - 1, 0));
    }
  };

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      setOpen(false);
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      setActiveIndex(0);
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      setActiveIndex(Math.max(items.length - 1, 0));
      return;
    }

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((currentIndex) =>
        getNextIndex(
          currentIndex,
          items.length,
          event.key === 'ArrowDown' ? 1 : -1,
        ),
      );
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      const activeItem = items[activeIndex];

      if (activeItem !== undefined) {
        selectItem(activeItem);
      }
    }
  };

  return (
    <div className={classNames(styles.root, className)} ref={rootRef}>
      <button
        aria-controls={isOpen ? menuId : undefined}
        aria-expanded={isOpen ? 'true' : 'false'}
        aria-haspopup="menu"
        className={classNames(styles.trigger, triggerClassName)}
        onClick={() => setOpen(!isOpen)}
        onKeyDown={handleTriggerKeyDown}
        ref={triggerRef}
        type="button"
      >
        {triggerLabel}
      </button>
      {isOpen ? (
        <div
          aria-label={label}
          className={styles.menu}
          id={menuId}
          onKeyDown={handleMenuKeyDown}
          role="menu"
        >
          {items.map((item, index) => (
            <button
              aria-disabled={item.disabled ? 'true' : undefined}
              className={styles.item}
              data-destructive={item.destructive ? 'true' : undefined}
              key={item.id}
              onClick={() => selectItem(item)}
              ref={(element) => {
                itemRefs.current[index] = element;
              }}
              role="menuitem"
              tabIndex={activeIndex === index ? 0 : -1}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
