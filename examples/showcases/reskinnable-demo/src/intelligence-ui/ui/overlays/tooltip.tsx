import { cloneElement, type ReactElement, type ReactNode, useId } from 'react';

import styles from './tooltip.module.css';

type TooltipChildProps = {
  readonly 'aria-describedby'?: string;
};

export type TooltipProps = {
  readonly content: ReactNode;
  readonly id?: string;
  readonly children: ReactElement<TooltipChildProps>;
};

/**
 * Connects a trigger element to non-interactive tooltip text.
 *
 * @param props Tooltip content and trigger element.
 * @returns A trigger wrapper and tooltip node.
 */
export function Tooltip({ content, id, children }: TooltipProps) {
  const generatedId = useId();
  const tooltipId = id ?? generatedId;
  const describedBy = mergeIds(children.props['aria-describedby'], tooltipId);

  return (
    <span className={styles.root}>
      {cloneElement(children, { 'aria-describedby': describedBy })}
      <span className={styles.tooltip} id={tooltipId} role="tooltip">
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
