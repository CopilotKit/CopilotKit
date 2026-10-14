"use client";

import {
  buildCatalogContextValue,
  A2UI_SCHEMA_CONTEXT_DESCRIPTION,
  extractCatalogComponentSchemas,
} from "@copilotkit/a2ui-renderer";
import {
  A2UI_DEFAULT_GENERATION_GUIDELINES,
  A2UI_DEFAULT_DESIGN_GUIDELINES,
  A2UI_MARKDOWN_GENERATION_GUIDELINES,
  A2UI_MARKDOWN_GENERATION_GUIDELINES_DESCRIPTION,
} from "@copilotkit/shared";
import { useCopilotKit } from "../providers/CopilotKitProvider";
import { useLayoutEffect, useMemo } from "react";

/**
 * Renders agent context describing the available A2UI catalog and custom components.
 * Only mount this component when A2UI is enabled.
 *
 * The entries are scoped to the agents the runtime applies A2UI to
 * (`copilotkit.a2uiAgents`, #5369), so agents outside that list don't receive
 * the catalog/schema/guidelines payload on their runs.
 *
 * When `includeSchema` is true, the full component schemas (JSON Schema) are also
 * sent as context using the same description key as the A2UI middleware, so the
 * middleware can optionally overwrite it with a server-side schema.
 *
 * `mode` selects the generation guideline: "tool" (default) describes the
 * `render_a2ui` tool; "markdown" describes emitting operations inside ```a2ui
 * fences in the assistant's markdown reply.
 */
export function A2UICatalogContext({
  catalog,
  includeSchema,
  mode = "tool",
}: {
  catalog?: any;
  includeSchema?: boolean;
  mode?: "tool" | "markdown";
}) {
  const { copilotkit } = useCopilotKit();

  const capabilitiesValue = useMemo(
    () => buildCatalogContextValue(catalog),
    [catalog],
  );

  // When includeSchema is true, send full component schemas in the same format
  // as the A2UI middleware so it can overwrite with a server-side schema if needed.
  const schemaValue = useMemo(
    () =>
      includeSchema !== false
        ? JSON.stringify(extractCatalogComponentSchemas(catalog))
        : null,
    [catalog, includeSchema],
  );

  // The agents list is read fresh inside the effect; this key only exists to
  // re-register the entries if the runtime's scoping changes on a reconnect.
  const a2uiAgentsKey = copilotkit?.a2uiAgents?.join(",");

  useLayoutEffect(() => {
    if (!copilotkit) return;
    const agentIds = copilotkit.a2uiAgents;
    const scope = agentIds ? { agentIds } : {};
    const ids: string[] = [];
    ids.push(
      copilotkit.addContext({
        description:
          "A2UI catalog capabilities: available catalog IDs and custom component definitions the client can render.",
        value: capabilitiesValue,
        ...scope,
      }),
    );
    if (schemaValue) {
      ids.push(
        copilotkit.addContext({
          description: A2UI_SCHEMA_CONTEXT_DESCRIPTION,
          value: schemaValue,
          ...scope,
        }),
      );
    }
    // Tool mode ties the guidelines to the schema (the middleware can replace
    // the whole bundle server-side). Markdown mode has no server side: the
    // fence guideline is the only thing that makes the agent emit surfaces,
    // so it is sent regardless of `includeSchema`.
    if (schemaValue || mode === "markdown") {
      ids.push(
        copilotkit.addContext({
          description:
            mode === "markdown"
              ? A2UI_MARKDOWN_GENERATION_GUIDELINES_DESCRIPTION
              : "A2UI generation guidelines — protocol rules, tool arguments, path rules, data model format, and form/two-way-binding instructions.",
          value:
            mode === "markdown"
              ? A2UI_MARKDOWN_GENERATION_GUIDELINES
              : A2UI_DEFAULT_GENERATION_GUIDELINES,
          ...scope,
        }),
      );
      ids.push(
        copilotkit.addContext({
          description:
            "A2UI design guidelines — visual design rules, component hierarchy tips, and action handler patterns.",
          value: A2UI_DEFAULT_DESIGN_GUIDELINES,
          ...scope,
        }),
      );
    }
    return () => {
      for (const id of ids) copilotkit.removeContext(id);
    };
  }, [copilotkit, capabilitiesValue, schemaValue, a2uiAgentsKey, mode]);

  return null;
}
