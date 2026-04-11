"use client";

import {
  buildCatalogContextValue,
  A2UI_SCHEMA_CONTEXT_DESCRIPTION,
  extractCatalogComponentSchemas,
} from "@copilotkit/a2ui-renderer";
import {
  A2UI_DEFAULT_GENERATION_GUIDELINES,
  A2UI_DEFAULT_DESIGN_GUIDELINES,
} from "@copilotkit/shared";
import { useAgentContext } from "../hooks/use-agent-context";
import { useCopilotKit } from "../providers/CopilotKitProvider";
import { useLayoutEffect, useMemo } from "react";

/**
 * Renders agent context describing the available A2UI catalog and custom components.
 * Only mount this component when A2UI is enabled.
 *
 * When `includeSchema` is true, the full component schemas (JSON Schema) are also
 * sent as context using the same description key as the A2UI middleware, so the
 * middleware can optionally overwrite it with a server-side schema.
 */
export function A2UICatalogContext({
  catalog,
  includeSchema,
}: {
  catalog?: any;
  includeSchema?: boolean;
}) {
  const contextValue = buildCatalogContextValue(catalog);

  useAgentContext({
    description:
      "A2UI catalog capabilities: available catalog IDs and custom component definitions the client can render.",
    value: contextValue,
  });

  // When includeSchema is true, send full component schemas in the same format
  // as the A2UI middleware so it can overwrite with a server-side schema if needed.
  const { copilotkit } = useCopilotKit();
  const schemaValue = useMemo(
    () =>
      includeSchema !== false
        ? JSON.stringify(extractCatalogComponentSchemas(catalog))
        : null,
    [catalog, includeSchema],
  );

  useLayoutEffect(() => {
    if (!copilotkit || !schemaValue) return;
    const ids: string[] = [];
    ids.push(
      copilotkit.addContext({
        description: A2UI_SCHEMA_CONTEXT_DESCRIPTION,
        value: schemaValue,
      }),
    );
    ids.push(
      copilotkit.addContext({
        description:
          "A2UI generation guidelines — protocol rules, tool arguments, path rules, data model format, and form/two-way-binding instructions.",
        value: A2UI_DEFAULT_GENERATION_GUIDELINES,
      }),
    );
    ids.push(
      copilotkit.addContext({
        description:
          "A2UI design guidelines — visual design rules, component hierarchy tips, and action handler patterns.",
        value: A2UI_DEFAULT_DESIGN_GUIDELINES,
      }),
    );
    return () => {
      for (const id of ids) copilotkit.removeContext(id);
    };
  }, [copilotkit, schemaValue]);

  return null;
}
