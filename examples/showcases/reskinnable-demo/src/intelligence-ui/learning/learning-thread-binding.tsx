/*
 * Stand-in for Intelligence learning/learning-thread-binding.tsx (main @ b71006350).
 * Only rendered when the adapter provides `threadBinding`, which this demo's
 * adapter does not.
 */
export function LearningThreadBinding(props: {
  readonly api: unknown;
  readonly projectId: number;
  readonly containerId: string;
  readonly containerName: string;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onChanged?: () => void;
  readonly storageKey: string;
}): null {
  void props;
  return null;
}
