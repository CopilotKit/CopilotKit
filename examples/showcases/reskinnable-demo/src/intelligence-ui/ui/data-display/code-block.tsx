import type { ReactNode } from 'react';

import { CopyButton, type ClipboardWriter } from './copy-button';
import styles from './data-display.module.css';

export interface CodeBlockProps {
  readonly code: string;
  readonly language?: string;
  readonly label?: ReactNode;
  readonly copyLabel?: string;
  readonly writeText?: ClipboardWriter;
}

/** Renders preformatted code with an optional copy control. */
export function CodeBlock({
  code,
  language,
  label,
  copyLabel,
  writeText,
}: CodeBlockProps): ReactNode {
  return (
    <div className={styles.codeBlock}>
      {label !== undefined || copyLabel !== undefined ? (
        <div className={styles.codeHeader}>
          {label !== undefined ? (
            <span className={styles.codeLabel}>{label}</span>
          ) : (
            <span />
          )}
          <CopyButton label={copyLabel} value={code} writeText={writeText} />
        </div>
      ) : null}
      <pre className={styles.pre} tabIndex={0}>
        <code
          className={
            language === undefined ? undefined : `language-${language}`
          }
        >
          {code}
        </code>
      </pre>
    </div>
  );
}
