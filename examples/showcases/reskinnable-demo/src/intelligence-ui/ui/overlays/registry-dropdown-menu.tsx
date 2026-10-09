import type { ComponentProps } from 'react';
import * as DropdownPrimitive from '@radix-ui/react-dropdown-menu';
import { Circle } from 'lucide-react';
import { motion } from 'motion/react';

import { useMotionPreference } from '../motion-preference';
import { useOverlayPortalContainer } from './portal-container';

import { classNames } from '../class-names';
import styles from './registry-dropdown-menu.module.css';

/** Generated shadcn DropdownMenu root, adapted to the repository's Radix package. */
export function MenuRoot(
  props: ComponentProps<typeof DropdownPrimitive.Root>,
): React.JSX.Element {
  return <DropdownPrimitive.Root data-slot="dropdown-menu" {...props} />;
}

/** The trigger accepts `asChild` for native Button composition. */
export function MenuTrigger(
  props: ComponentProps<typeof DropdownPrimitive.Trigger>,
): React.JSX.Element {
  return (
    <DropdownPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />
  );
}

/** Portal-backed menu surface from the generated registry composition. */
export function MenuContent({
  children,
  className,
  landmarkLabel,
  sideOffset = 4,
  ...props
}: ComponentProps<typeof DropdownPrimitive.Content> & {
  /** Names a portal landmark when a menu lives outside the page's landmarks. */
  readonly landmarkLabel?: string;
}): React.JSX.Element {
  const reducedMotion = useMotionPreference();
  const portalContainer = useOverlayPortalContainer();
  const content = (
    <DropdownPrimitive.Content asChild sideOffset={sideOffset} {...props}>
      <motion.div
        animate={{ opacity: 1, y: 0 }}
        className={classNames(styles.content, className)}
        data-slot="dropdown-menu-content"
        initial={{ opacity: 0, y: reducedMotion ? 0 : -2 }}
        transition={{ duration: reducedMotion ? 0 : 0.14, ease: 'easeOut' }}
      >
        {children}
      </motion.div>
    </DropdownPrimitive.Content>
  );
  return (
    <DropdownPrimitive.Portal container={portalContainer}>
      {landmarkLabel ? (
        <section aria-label={landmarkLabel}>{content}</section>
      ) : (
        content
      )}
    </DropdownPrimitive.Portal>
  );
}

/** Native Radix radio group for one selected menu choice. */
export function MenuRadioGroup(
  props: ComponentProps<typeof DropdownPrimitive.RadioGroup>,
): React.JSX.Element {
  return (
    <DropdownPrimitive.RadioGroup
      data-slot="dropdown-menu-radio-group"
      {...props}
    />
  );
}

/** Generated shadcn menu action row. */
export function MenuItem({
  className,
  ...props
}: ComponentProps<typeof DropdownPrimitive.Item>): React.JSX.Element {
  return (
    <DropdownPrimitive.Item
      className={classNames(styles.item, className)}
      data-slot="dropdown-menu-item"
      {...props}
    />
  );
}

/** Generated shadcn label for a menu choice group. */
export function MenuLabel({
  className,
  ...props
}: ComponentProps<typeof DropdownPrimitive.Label>): React.JSX.Element {
  return (
    <DropdownPrimitive.Label
      className={classNames(styles.label, className)}
      data-slot="dropdown-menu-label"
      {...props}
    />
  );
}

/** Thin divider between unrelated menu actions. */
export function MenuSeparator({
  className,
  ...props
}: ComponentProps<typeof DropdownPrimitive.Separator>): React.JSX.Element {
  return (
    <DropdownPrimitive.Separator
      className={classNames(styles.separator, className)}
      data-slot="dropdown-menu-separator"
      {...props}
    />
  );
}

/** Generated shadcn radio row with a checked indicator. */
export function MenuRadioItem({
  children,
  className,
  ...props
}: ComponentProps<typeof DropdownPrimitive.RadioItem>): React.JSX.Element {
  return (
    <DropdownPrimitive.RadioItem
      className={classNames(styles.radioItem, className)}
      data-slot="dropdown-menu-radio-item"
      {...props}
    >
      <span aria-hidden="true" className={styles.indicator}>
        <DropdownPrimitive.ItemIndicator>
          <Circle size={8} fill="currentColor" />
        </DropdownPrimitive.ItemIndicator>
      </span>
      {children}
    </DropdownPrimitive.RadioItem>
  );
}
