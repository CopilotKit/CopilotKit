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
 * `<WhenFrameworkSupports feature="shared-state-streaming">` renders its
 * children unless the reader's framework lists the feature in its showcase
 * manifest's `not_supported_features`; `not` flips it, for the note a
 * framework without the feature reads instead. The showcase decides, the same
 * way a page's `snippet_cell` decides whether the page exists for a framework.
 */
export function WhenFrameworkSupports({
  scope,
  feature,
  not = false,
  framework,
  defaultFramework,
  children,
}: {
  scope: DocsScope;
  feature: string;
  not?: boolean;
  framework?: string;
  defaultFramework?: string;
  children?: ReactNode;
}) {
  const slug = framework ?? scope.framework ?? defaultFramework;
  const supported = !slug || frameworkSupports(slug, feature);
  return supported !== not ? <>{children}</> : null;
}

/**
 * Whether a framework's showcase supports a feature: false only when its
 * manifest lists the feature in `not_supported_features` (which covers
 * quarantined features too). Frameworks without a showcase package support
 * everything their docs describe.
 */
export function frameworkSupports(slug: string, feature: string): boolean {
  return !getIntegration(slug)?.not_supported_features?.includes(feature);
}

/**
 * A frontend quickstart's two paths (Vue, Angular, React Native):
 * `selected` (the default) renders when the URL names an agent backend,
 * `selected={false}` on the standalone built-in agent path.
 */
export function WhenAgentBackend({
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
  return hasAgentBackend(framework) === selected ? <>{children}</> : null;
}

/** The URL names an agent backend, not the standalone built-in agent. */
export function hasAgentBackend(framework: string | null | undefined) {
  return Boolean(framework && framework !== ROOT_FRAMEWORK);
}

/**
 * `<WhenFramework is="langgraph-python,langgraph-fastapi">` renders its
 * children only when the URL's framework (else `currentFramework`) is one of
 * the comma-separated slugs. The frontend quickstarts pick each framework's
 * backend steps with it (`src/content/snippets/agent-backends`).
 */
export function WhenFramework({
  scope,
  is,
  currentFramework,
  children,
}: {
  scope: DocsScope;
  is: string;
  currentFramework?: string | null;
  children?: ReactNode;
}) {
  return frameworkIs(scope.framework ?? currentFramework, is) ? (
    <>{children}</>
  ) : null;
}

/** Whether `framework` is one of `<WhenFramework is>`'s comma-separated slugs. */
export function frameworkIs(
  framework: string | null | undefined,
  is: string,
): boolean {
  return Boolean(
    framework &&
    is
      .split(",")
      .map((s) => s.trim())
      .includes(framework),
  );
}
