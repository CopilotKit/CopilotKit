import type { ComponentProps } from 'react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { motion } from 'motion/react';

import { classNames } from '../class-names';
import { useMotionPreference } from '../motion-preference';
import { useOverlayPortalContainer } from './portal-container';
import styles from './registry-popover.module.css';

/** Generated shadcn Popover root, backed by the direct Radix package. */
export function PopoverRoot(
  props: ComponentProps<typeof PopoverPrimitive.Root>,
): React.JSX.Element {
  return <PopoverPrimitive.Root data-slot="popover" {...props} />;
}

/** Trigger with `asChild` support for the app's existing button controls. */
export function PopoverTrigger(
  props: ComponentProps<typeof PopoverPrimitive.Trigger>,
): React.JSX.Element {
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" {...props} />;
}

/** Portal surface with a short Motion entrance. */
export function PopoverContent({
  align = 'center',
  children,
  className,
  portalContainer,
  sideOffset = 4,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Content> & {
  readonly portalContainer?: Element | DocumentFragment | null;
}): React.JSX.Element {
  const reducedMotion = useMotionPreference();
  const ownerContainer = useOverlayPortalContainer();
  return (
    <PopoverPrimitive.Portal container={portalContainer ?? ownerContainer}>
      <PopoverPrimitive.Content
        align={align}
        asChild
        sideOffset={sideOffset}
        {...props}
      >
        <motion.div
          animate={{ opacity: 1, y: 0 }}
          className={classNames(styles.content, className)}
          data-slot="popover-content"
          initial={{ opacity: 0, y: reducedMotion ? 0 : -2 }}
          transition={{ duration: reducedMotion ? 0 : 0.14, ease: 'easeOut' }}
        >
          {children}
        </motion.div>
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  );
}
