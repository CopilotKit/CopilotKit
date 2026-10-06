import { Fragment, type ReactNode } from 'react';

import styles from './data-display.module.css';

export interface DescriptionListItem {
  readonly term: ReactNode;
  readonly details: ReactNode;
}

export interface DescriptionListProps {
  readonly items: readonly DescriptionListItem[];
}

/** Renders key-value metadata with semantic description-list markup. */
export function DescriptionList({ items }: DescriptionListProps): ReactNode {
  return (
    <dl className={styles.descriptionList}>
      {items.map((item, index) => (
        <Fragment key={index}>
          <dt className={styles.descriptionTerm}>{item.term}</dt>
          <dd className={styles.descriptionDetails}>{item.details}</dd>
        </Fragment>
      ))}
    </dl>
  );
}
