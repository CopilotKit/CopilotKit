// Server-side gates on the reader's framework. Non-matching branches never
// reach the client. Ports of shell-docs' when-framework-has.tsx and
// when-angular-backend.tsx.

import type { ReactNode } from "react";
import { ROOT_FRAMEWORK, getIntegration } from "../data";
import type { DocsScope } from "../scope";

/** Manifest fields `<WhenFrameworkHas>` can gate on (see `Integration`). */
type SupportedFlag =
  | "a2ui_pattern"
  | "a2ui_agent_form"
  | "interrupt_pattern"
  | "thread_persistence_pattern"
  | "agent_config_pattern"
  | "auth_pattern"
  | "voice_backend_pattern";

/**
 * `<WhenFrameworkHas flag="a2ui_pattern" equals="schema-loading">` renders
 * its children only when the framework's manifest sets `flag` to `equals`;
 * `absent` renders them only when the flag is unset, a fallback branch for
 * frameworks without the feature. The framework is the explicit prop, else
 * the URL's, else the page's `snippet_framework`.
 */
export function WhenFrameworkHas({
  scope,
  flag,
  equals,
  absent,
  framework,
  defaultFramework,
  children,
}: {
  scope: DocsScope;
  flag: SupportedFlag;
  equals?: string;
  absent?: boolean;
  framework?: string;
  defaultFramework?: string;
  children?: ReactNode;
}) {
  const slug = framework ?? scope.framework ?? defaultFramework;
  return frameworkHas(slug, flag, { equals, absent }) ? <>{children}</> : null;
}

/** Whether `<WhenFrameworkHas>` shows its children for framework `slug`. */
export function frameworkHas(
  slug: string | null | undefined,
  flag: string,
  { equals, absent }: { equals?: string; absent?: boolean },
): boolean {
  const integration = slug ? getIntegration(slug) : undefined;
  if (!integration) return false;
  const value = (integration as unknown as Record<string, unknown>)[flag];
  if (absent) return value == null;
  return value != null && equals !== undefined && value === equals;
}

/**
 * The Angular quickstart's two paths: `selected` (the default) renders when
 * the URL names an agent backend, `selected={false}` on the standalone
 * built-in agent path.
 */
export function WhenAngularBackend({
  scope,
  selected = true,
  currentFramework,
  children,
}: {
  scope: DocsScope;
  selected?: boolean;
  currentFramework?: string | null;
  children?: ReactNode;
}) {
  const framework = scope.framework ?? currentFramework;
  return hasAngularBackend(framework) === selected ? <>{children}</> : null;
}

/** The URL names an agent backend, not the standalone built-in agent. */
export function hasAngularBackend(framework: string | null | undefined) {
  return Boolean(framework && framework !== ROOT_FRAMEWORK);
}
