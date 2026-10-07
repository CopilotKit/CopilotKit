/*
 * Stand-in for Intelligence learning/thread-import-entry.tsx (main @ b71006350).
 * Only rendered when the adapter provides `threadBinding`, which this demo's
 * adapter does not; it shows its children unchanged.
 */
import type { ReactNode } from 'react';

export function ThreadImportEntry(props: {
  readonly api: unknown;
  readonly projectId: number;
  readonly containerId: string;
  readonly onChoose: () => void;
  readonly children?: ReactNode;
}): React.JSX.Element {
  return <>{props.children}</>;
}
