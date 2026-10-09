import { type ReactNode, useState } from 'react';
import * as TabsPrimitive from '@radix-ui/react-tabs';

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

/** Keeps the item-based API while Radix owns tab focus and selection. */
export function Tabs({
  label,
  items,
  value,
  defaultValue,
  onValueChange,
  className,
}: TabsProps): ReactNode {
  const firstEnabledId =
    items.find((item) => !item.disabled)?.id ?? items[0]?.id;
  const [uncontrolledValue, setUncontrolledValue] = useState(
    defaultValue ?? firstEnabledId,
  );
  if (firstEnabledId === undefined) return null;
  const requestedValue = value ?? uncontrolledValue;
  const resolvedValue = items.some((item) => item.id === requestedValue)
    ? requestedValue
    : firstEnabledId;

  /**
   * Selects a tab once. Radix selects on mouse down and keyboard; a plain
   * click (assistive tech, scripted clicks) selects through the same path.
   *
   * @param next - The tab id to select.
   */
  const select = (next: string): void => {
    if (next === resolvedValue) return;
    if (value === undefined) setUncontrolledValue(next);
    onValueChange?.(next);
  };

  return (
    <TabsPrimitive.Root
      className={classNames(styles.root, className)}
      onValueChange={select}
      value={resolvedValue}
    >
      <TabsPrimitive.List
        aria-label={label}
        className={styles.tabList}
        data-slot="tabs-list"
      >
        {items.map((item) => (
          <TabsPrimitive.Trigger
            className={styles.tab}
            data-slot="tabs-trigger"
            disabled={item.disabled}
            key={item.id}
            onClick={() => select(item.id)}
            value={item.id}
          >
            {item.label}
          </TabsPrimitive.Trigger>
        ))}
      </TabsPrimitive.List>
      {items.map((item) => (
        <TabsPrimitive.Content
          className={styles.panel}
          data-slot="tabs-content"
          key={item.id}
          value={item.id}
        >
          {item.panel}
        </TabsPrimitive.Content>
      ))}
    </TabsPrimitive.Root>
  );
}
