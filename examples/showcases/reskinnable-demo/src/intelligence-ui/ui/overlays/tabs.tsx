import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';

import { classNames } from '../class-names';
import styles from './tabs.module.css';

export interface TabItem {
  readonly id: string;
  readonly label: ReactNode;
  readonly panel: ReactNode;
  readonly disabled?: boolean;
}

export interface TabsProps {
  readonly label: string;
  readonly items: readonly TabItem[];
  readonly value?: string;
  readonly defaultValue?: string;
  readonly onValueChange?: (value: string) => void;
  readonly className?: string;
}

/** Returns the first enabled tab id from a tab collection. */
function getFirstEnabledTabId(items: readonly TabItem[]): string {
  return items.find((item) => !item.disabled)?.id ?? items[0]?.id ?? '';
}

/** Returns the index of a tab id, falling back to the first enabled tab. */
function getActiveIndex(items: readonly TabItem[], activeId: string): number {
  const activeIndex = items.findIndex((item) => item.id === activeId);

  if (activeIndex >= 0) {
    return activeIndex;
  }

  const firstEnabledIndex = items.findIndex((item) => !item.disabled);
  return Math.max(firstEnabledIndex, 0);
}

/** Returns the next enabled tab index for keyboard navigation. */
function getNextEnabledIndex(
  items: readonly TabItem[],
  currentIndex: number,
  direction: 1 | -1,
): number {
  if (items.length === 0) {
    return -1;
  }

  for (let offset = 1; offset <= items.length; offset += 1) {
    const nextIndex =
      (currentIndex + offset * direction + items.length) % items.length;

    if (!items[nextIndex]?.disabled) {
      return nextIndex;
    }
  }

  return currentIndex;
}

/**
 * Renders an accessible tab set with automatic keyboard activation.
 *
 * @param props Tab labels, panels, and optional controlled state.
 * @returns A tablist with the selected tab panel.
 */
export function Tabs({
  label,
  items,
  value,
  defaultValue,
  onValueChange,
  className,
}: TabsProps): ReactNode {
  const generatedId = useId();
  const fallbackValue = useMemo(() => getFirstEnabledTabId(items), [items]);
  const isControlled = value !== undefined;
  const [uncontrolledValue, setUncontrolledValue] = useState(
    defaultValue ?? fallbackValue,
  );
  const activeId = isControlled ? value : uncontrolledValue;
  const activeIndex = getActiveIndex(items, activeId);
  const activeItem = items[activeIndex];
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const setActiveId = useCallback(
    (nextId: string) => {
      if (!isControlled) {
        setUncontrolledValue(nextId);
      }

      onValueChange?.(nextId);
    },
    [isControlled, onValueChange],
  );

  const focusAndActivate = (nextIndex: number) => {
    const nextItem = items[nextIndex];

    if (nextItem === undefined || nextItem.disabled) {
      return;
    }

    setActiveId(nextItem.id);
    tabRefs.current[nextIndex]?.focus();
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      focusAndActivate(getNextEnabledIndex(items, activeIndex, 1));
      return;
    }

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      focusAndActivate(getNextEnabledIndex(items, activeIndex, -1));
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      focusAndActivate(getNextEnabledIndex(items, -1, 1));
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      focusAndActivate(getNextEnabledIndex(items, 0, -1));
    }
  };

  if (activeItem === undefined) {
    return null;
  }

  return (
    <div className={classNames(styles.root, className)}>
      <div aria-label={label} className={styles.tabList} role="tablist">
        {items.map((item, index) => {
          const tabId = `${generatedId}-${item.id}-tab`;
          const panelId = `${generatedId}-${item.id}-panel`;
          const isSelected = item.id === activeItem.id;

          return (
            <button
              aria-controls={panelId}
              aria-disabled={item.disabled ? 'true' : undefined}
              aria-selected={isSelected ? 'true' : 'false'}
              className={styles.tab}
              id={tabId}
              key={item.id}
              onClick={() => {
                if (!item.disabled) {
                  setActiveId(item.id);
                }
              }}
              onKeyDown={handleTabKeyDown}
              ref={(element) => {
                tabRefs.current[index] = element;
              }}
              role="tab"
              tabIndex={isSelected ? 0 : -1}
              type="button"
            >
              {item.label}
            </button>
          );
        })}
      </div>
      <div
        aria-labelledby={`${generatedId}-${activeItem.id}-tab`}
        className={styles.panel}
        id={`${generatedId}-${activeItem.id}-panel`}
        role="tabpanel"
        tabIndex={0}
      >
        {activeItem.panel}
      </div>
    </div>
  );
}
