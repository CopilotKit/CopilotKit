import type { ReactNode } from "react";

export interface WhenAngularBackendProps {
  /**
   * Render when a non-built-in agent backend is selected. Set to `false` for
   * the standalone Angular quickstart's BuiltInAgent path.
   */
  selected?: boolean;
  /** Injected by DocsPageView from the backend segment in the URL. */
  currentFramework?: string | null;
  children?: ReactNode;
}

export function WhenAngularBackend({
  selected = true,
  currentFramework,
  children,
}: WhenAngularBackendProps) {
  const hasSelectedBackend = Boolean(
    currentFramework && currentFramework !== "built-in-agent",
  );

  return hasSelectedBackend === selected ? <>{children}</> : null;
}
