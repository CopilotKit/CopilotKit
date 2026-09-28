import type { CopilotKitCore } from "@copilotkit/core";
import { fetchInspectorIntelligence } from "./intelligence-transport.js";

const PERMISSIONS = [
  "analytics.numbers",
  "analytics.topics",
  "learning.insights_skills",
  "governance.record",
  "conversations.text",
] as const;
type Permission = (typeof PERMISSIONS)[number];
export interface IntelligenceAccess {
  readonly agents: readonly string[];
  readonly permissions: Partial<Record<Permission, "*" | readonly string[]>>;
}

/** Validates display scope from the runtime; every data request still resolves access server-side. */
export function parseIntelligenceAccess(
  value: unknown,
): IntelligenceAccess | null {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !isRecord(value.grant) ||
    !isRecord(value.grant.permissions) ||
    !Array.isArray(value.agents) ||
    !value.agents.every(isAgent)
  )
    return null;
  const permissions: IntelligenceAccess["permissions"] = {};
  for (const permission of PERMISSIONS) {
    const grant = value.grant.permissions[permission];
    if (grant === undefined) continue;
    if (!isRecord(grant)) return null;
    const agents = grant.agents;
    if (
      agents !== "*" &&
      (!Array.isArray(agents) ||
        agents.length === 0 ||
        agents.length > 100 ||
        !agents.every(isAgent))
    )
      return null;
    permissions[permission] = agents;
  }
  if (!Object.keys(permissions).length) return null;
  const scopes = Object.values(permissions);
  const agents = scopes.includes("*")
    ? value.agents
    : [...new Set(scopes.flatMap((scope) => (scope === "*" ? [] : scope)))];
  return { agents, permissions };
}

/** Checks a visible section against the selected agent without widening its grant. */
export function intelligenceSections(
  access: IntelligenceAccess | null,
  agent?: string,
): readonly ("analytics" | "governance" | "memories")[] {
  if (!access) return [];
  const has = (permission: Permission) => {
    const scope = access.permissions[permission];
    return (
      scope === "*" || (agent !== undefined && scope?.includes(agent) === true)
    );
  };
  return [
    ...(has("analytics.numbers") || has("analytics.topics")
      ? ["analytics" as const]
      : []),
    ...(has("governance.record") ? ["governance" as const] : []),
    // The embedded Learning lists currently require a project-wide grant.
    ...(access.permissions["learning.insights_skills"] === "*"
      ? ["memories" as const]
      : []),
  ];
}

/** Refreshes a production shell's grant on identity changes and focus, cancelling stale reads. */
export function observeIntelligenceAccess(
  core: CopilotKitCore,
  onChange: (access: IntelligenceAccess | null) => void,
): () => void {
  let active = true;
  let pending: AbortController | undefined;
  const refresh = (clear = true) => {
    pending?.abort();
    const controller = new AbortController();
    pending = controller;
    if (clear) onChange(null);
    if (!core.runtimeUrl) return;
    const timeout = setTimeout(() => {
      controller.abort();
      if (active && pending === controller) onChange(null);
    }, 30000);
    fetchInspectorIntelligence(
      {
        runtimeUrl: core.runtimeUrl,
        runtimeTransport: core.runtimeTransport,
        fetch: core.ɵruntimeFetch,
        headers: core.headers,
        credentials: core.credentials,
      },
      { method: "GET", path: "/context" },
      controller.signal,
    )
      .then((result) => {
        if (active && !controller.signal.aborted)
          onChange(
            result.status === 200 ? parseIntelligenceAccess(result.body) : null,
          );
      })
      .catch(() => {
        if (active && !controller.signal.aborted) onChange(null);
      })
      .finally(() => clearTimeout(timeout));
  };
  const subscription = core.subscribe({
    onHeadersChanged: () => refresh(),
    onRuntimeConnectionStatusChanged: () => refresh(),
  });
  const onFocus = () => refresh(false);
  window.addEventListener("focus", onFocus);
  refresh();
  return () => {
    active = false;
    pending?.abort();
    subscription.unsubscribe();
    window.removeEventListener("focus", onFocus);
  };
}

/** Narrows untrusted response objects without casting their fields. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Matches the product API's nonblank agent identifier bound. */
function isAgent(value: unknown): value is string {
  return (
    typeof value === "string" && value.trim().length > 0 && value.length <= 256
  );
}
