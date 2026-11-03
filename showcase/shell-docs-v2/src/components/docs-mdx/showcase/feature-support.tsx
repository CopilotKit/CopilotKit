// <FeatureIntegrations feature="..." /> and <FeatureMatrix />: which deployed
// integrations support a showcase feature. Ports of the inline components in
// shell-docs' mdx-registry.tsx.

import Link from "next/link";
import { Check, Minus } from "lucide-react";
import { getRegistry } from "../data";
import type { DocsScope } from "../scope";
import { frameworkPageHref } from "./paths";

export function FeatureIntegrations({
  scope,
  feature,
}: {
  scope: DocsScope;
  feature?: string;
}) {
  if (!feature) return null;
  const supporting = getRegistry().integrations.filter(
    (i) => i.deployed && i.features?.includes(feature),
  );
  if (!supporting.length) {
    // A visible hint in development, nothing in production (as shell-docs).
    return process.env.NODE_ENV === "production" ? null : (
      <p className="my-6 rounded-xl border border-dashed px-3 py-2 font-mono text-xs text-muted-foreground">
        No deployed integrations support feature &quot;{feature}&quot;.
      </p>
    );
  }
  return (
    <div className="not-prose my-6 flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">Supported by</p>
      <ul className="flex flex-wrap gap-2">
        {supporting.map((i) => (
          <li key={i.slug}>
            <Link
              href={frameworkPageHref(i.slug, "", scope)}
              className="inline-flex h-8 items-center rounded-full border bg-card px-3 text-sm font-medium text-muted-foreground transition-colors hover:border-edge-action hover:text-foreground"
            >
              {i.name}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

const MATRIX_COLUMNS = [
  { id: "agentic-chat", label: "Chat UI" },
  { id: "gen-ui-tool-based", label: "Tool-based gen UI" },
  { id: "tool-rendering", label: "Tool rendering" },
  { id: "gen-ui-agent", label: "Agentic gen UI" },
  { id: "hitl-in-chat", label: "Human-in-the-loop" },
  { id: "frontend-tools", label: "Frontend tools" },
  { id: "shared-state-read-write", label: "Shared state" },
  { id: "shared-state-streaming", label: "State streaming" },
  { id: "subagents", label: "Sub-agents" },
  { id: "declarative-gen-ui", label: "Declarative gen UI" },
  { id: "agentic-chat-reasoning", label: "Reasoning" },
  { id: "mcp-apps", label: "MCP apps" },
];

export function FeatureMatrix({ scope }: { scope: DocsScope }) {
  const integrations = getRegistry().integrations.filter((i) => i.deployed);
  return (
    <div className="my-6 overflow-x-auto">
      <table>
        <thead>
          <tr>
            <th className="whitespace-nowrap">Framework</th>
            {MATRIX_COLUMNS.map((col) => (
              <th key={col.id} className="text-center whitespace-nowrap">
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {integrations.map((integration) => {
            const features = new Set(integration.features ?? []);
            return (
              <tr key={integration.slug}>
                <td className="whitespace-nowrap">
                  <Link href={frameworkPageHref(integration.slug, "", scope)}>
                    {integration.name}
                  </Link>
                </td>
                {MATRIX_COLUMNS.map((col) => (
                  <td key={col.id} className="text-center">
                    {features.has(col.id) ? (
                      <Check
                        role="img"
                        aria-label="Supported"
                        className="inline size-4 text-brand-mint-deep"
                      />
                    ) : (
                      <Minus
                        role="img"
                        aria-label="Not supported"
                        className="inline size-4 text-muted-foreground"
                      />
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
