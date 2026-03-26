"use client";

import { buildCatalogContextValue } from "@copilotkit/a2ui-renderer";
import { useAgentContext } from "../hooks/use-agent-context";

/**
 * Renders agent context describing available A2UI catalogs and custom components.
 * Only mount this component when A2UI is enabled.
 */
export function A2UICatalogContext({ catalogs }: { catalogs?: any[] }) {
  const contextValue = buildCatalogContextValue(catalogs ?? []);

  useAgentContext({
    description:
      "A2UI catalog capabilities: available catalog IDs and custom component definitions the client can render.",
    value: contextValue,
  });

  return null;
}
