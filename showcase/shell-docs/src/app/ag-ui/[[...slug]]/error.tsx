"use client";

import { ErrorBoundaryCard } from "@/components/error-boundary-card";

export default function AgUiError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorBoundaryCard scope="ag-ui" error={error} reset={reset} />;
}
