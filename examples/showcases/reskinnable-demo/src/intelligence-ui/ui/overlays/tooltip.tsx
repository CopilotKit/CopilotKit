import {
  cloneElement,
  type ReactElement,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';

import styles from './tooltip.module.css';

type TooltipChildProps = {
  readonly 'aria-describedby'?: string;
};

export type TooltipProps = {
  readonly content: ReactNode;
  readonly id?: string;
  readonly children: ReactElement<TooltipChildProps>;
  /**
   * Place below when the trigger sits at the top of a clipping scroller.
   * Place right for icon-only rails; it escapes scrollers that clip it.
   */
  readonly side?: 'bottom' | 'right' | 'top';
};

/**
 * Connects a trigger element to tooltip text shown on hover and focus.
 *
 * The text stays open while the pointer moves onto it, and Escape hides it
 * until the pointer leaves or focus moves away (WCAG 1.4.13).
 *
 * @param props Tooltip content and trigger element.
 * @returns A trigger wrapper and tooltip node.
 */
export function Tooltip({ content, id, children, side = 'top' }: TooltipProps) {
  const generatedId = useId();
  const tooltipId = id ?? generatedId;
  const describedBy = mergeIds(children.props['aria-describedby'], tooltipId);
  const rootRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLSpanElement>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    /** Hides a showing tooltip first, before Escape reaches a parent overlay. */
    const dismissOnEscape = (event: KeyboardEvent): void => {
      const root = rootRef.current;
      if (event.key !== 'Escape' || dismissed || !root) return;
      const showing =
        root.contains(document.activeElement) || root.matches(':hover');
      if (!showing) return;
      event.stopPropagation();
      setDismissed(true);
    };
    window.addEventListener('keydown', dismissOnEscape, true);
    return () => window.removeEventListener('keydown', dismissOnEscape, true);
  }, [dismissed]);

  /** Pins a right tooltip beside its trigger, since it is positioned against the viewport. */
  const placeBesideTrigger = (): void => {
    const tooltip = tooltipRef.current;
    const trigger = rootRef.current?.firstElementChild;
    if (side !== 'right' || !tooltip || !trigger) return;
    const rect = trigger.getBoundingClientRect();
    tooltip.style.setProperty('--cpki-tooltip-left', `${rect.right + 6}px`);
    tooltip.style.setProperty(
      '--cpki-tooltip-top',
      `${rect.top + rect.height / 2}px`,
    );
  };

  return (
    <span
      className={styles.root}
      data-dismissed={dismissed ? 'true' : undefined}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setDismissed(false);
        }
      }}
      onFocus={placeBesideTrigger}
      onPointerEnter={placeBesideTrigger}
      onPointerLeave={() => setDismissed(false)}
      ref={rootRef}
    >
      {cloneElement(children, { 'aria-describedby': describedBy })}
      <span
        className={styles.tooltip}
        data-side={side}
        id={tooltipId}
        ref={tooltipRef}
        role="tooltip"
      >
        {content}
      </span>
    </span>
  );
}

/**
 * Merges aria-describedby IDs without leaving duplicate whitespace.
 *
 * @param values Existing and generated ID values.
 * @returns A normalized IDREF list.
 */
function mergeIds(
  ...values: ReadonlyArray<string | false | null | undefined>
): string | undefined {
  const ids = values.filter((value): value is string => Boolean(value));

  return ids.length > 0 ? ids.join(' ') : undefined;
}
