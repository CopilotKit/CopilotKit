"use client";

import { ErrorBoundaryCard } from "@/components/error-boundary-card";

export default function DocsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <ErrorBoundaryCard scope="docs" error={error} reset={reset} />;
}
