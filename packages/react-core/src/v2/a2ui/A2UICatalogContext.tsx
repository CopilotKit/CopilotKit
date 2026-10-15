"use client";

import {
  buildCatalogContextValue,
  buildCompactCatalogSchema,
  A2UI_SCHEMA_CONTEXT_DESCRIPTION,
  extractCatalogComponentSchemas,
} from "@copilotkit/a2ui-renderer";
import {
  A2UI_DEFAULT_GENERATION_GUIDELINES,
  A2UI_DEFAULT_DESIGN_GUIDELINES,
  A2UI_MARKDOWN_SCHEMA_CONTEXT_DESCRIPTION,
  A2UI_MARKDOWN_GENERATION_GUIDELINES,
  A2UI_MARKDOWN_GENERATION_GUIDELINES_DESCRIPTION,
  COPILOTKIT_FORWARDED_PROPS_KEY,
  COPILOTKIT_UI_ENVELOPE_FORMAT,
} from "@copilotkit/shared";
import type { CopilotKitUIEnvelope } from "@copilotkit/shared";
import { useCopilotKit } from "../providers/CopilotKitProvider";
import { useLayoutEffect, useMemo } from "react";

/**
 * Tells the agent about the A2UI catalog.
 *
 * Tool mode registers four context entries (catalog capabilities, the full
 * JSON Schema under the A2UI middleware's description key so the middleware
 * can overwrite it server-side, the tool guideline and the design guideline),
 * scoped to the agents the runtime applies A2UI to (`copilotkit.a2uiAgents`,
 * #5369).
 *
 * Markdown mode has no server side. It registers two context entries, the
 * compact schema (`buildCompactCatalogSchema`, under its own key so agent
 * adapters keep it in the prompt) and the fence guideline, unless
 * `sendContext` is false; and it always forwards the structured
 * `copilotkit.ui` envelope as a scoped run property so a backend can build
 * its own prompt from `catalog` and `instructions`.
 */
export function A2UICatalogContext({
  catalog,
  includeSchema,
  includeCatalog,
  sendContext,
  agentIds,
  mode = "tool",
}: {
  catalog?: any;
  includeSchema?: boolean;
  includeCatalog?: boolean;
  sendContext?: boolean;
  agentIds?: string[];
  mode?: "tool" | "markdown";
}) {
  const { copilotkit } = useCopilotKit();
  const markdown = mode === "markdown";
  const contextOn = !markdown || sendContext !== false;

  const capabilitiesValue = useMemo(
    () => (markdown ? null : buildCatalogContextValue(catalog)),
    [catalog, markdown],
  );

  const schemaValue = useMemo(() => {
    if (includeSchema === false || !contextOn) return null;
    return JSON.stringify(
      markdown
        ? buildCompactCatalogSchema(catalog)
        : extractCatalogComponentSchemas(catalog),
    );
  }, [catalog, includeSchema, markdown, contextOn]);

  const envelope = useMemo<CopilotKitUIEnvelope | null>(() => {
    if (!markdown) return null;
    const inline = extractCatalogComponentSchemas(catalog);
    return {
      method: "a2ui",
      version: "v0.9",
      format: COPILOTKIT_UI_ENVELOPE_FORMAT,
      mode: "markdown",
      catalog:
        includeCatalog === false
          ? { id: inline.catalogId }
          : { id: inline.catalogId, components: inline.components },
      instructions: A2UI_MARKDOWN_GENERATION_GUIDELINES,
      contextSent: contextOn,
    };
  }, [catalog, markdown, includeCatalog, contextOn]);

  // The runtime's list is read fresh inside the effect; these keys only exist
  // to re-register when the scoping changes.
  const a2uiAgentsKey = copilotkit?.a2uiAgents?.join(",");
  const agentIdsKey = agentIds?.join(",");

  useLayoutEffect(() => {
    if (!copilotkit) return;
    const scopedTo = agentIds ?? copilotkit.a2uiAgents;
    const scope = scopedTo ? { agentIds: scopedTo } : {};
    const ids: string[] = [];
    if (capabilitiesValue) {
      ids.push(
        copilotkit.addContext({
          description:
            "A2UI catalog capabilities: available catalog IDs and custom component definitions the client can render.",
          value: capabilitiesValue,
          ...scope,
        }),
      );
    }
    if (schemaValue) {
      ids.push(
        copilotkit.addContext({
          // Markdown mode must not reuse the tool-mode key: LangGraph/Strands
          // adapters match it exactly and divert the entry out of the prompt
          // into `state["ag-ui"]["a2ui_schema"]` for the render_a2ui tool.
          description: markdown
            ? A2UI_MARKDOWN_SCHEMA_CONTEXT_DESCRIPTION
            : A2UI_SCHEMA_CONTEXT_DESCRIPTION,
          value: schemaValue,
          ...scope,
        }),
      );
    }
    // Tool mode ties the guidelines to the schema (the middleware can replace
    // the whole bundle server-side). In markdown mode the fence guideline is
    // the only thing that makes the agent emit surfaces, so it goes whenever
    // context goes, regardless of `includeSchema`.
    if (schemaValue || (markdown && contextOn)) {
      ids.push(
        copilotkit.addContext({
          description: markdown
            ? A2UI_MARKDOWN_GENERATION_GUIDELINES_DESCRIPTION
            : "A2UI generation guidelines — protocol rules, tool arguments, path rules, data model format, and form/two-way-binding instructions.",
          value: markdown
            ? A2UI_MARKDOWN_GENERATION_GUIDELINES
            : A2UI_DEFAULT_GENERATION_GUIDELINES,
          ...scope,
        }),
      );
      // Markdown mode carries its own visual-style rules; the tool-mode design
      // guideline assumes the render_a2ui tool and the basic catalog.
      if (!markdown) {
        ids.push(
          copilotkit.addContext({
            description:
              "A2UI design guidelines — visual design rules, component hierarchy tips, and action handler patterns.",
            value: A2UI_DEFAULT_DESIGN_GUIDELINES,
            ...scope,
          }),
        );
      }
    }
    const propertiesId = envelope
      ? copilotkit.addScopedProperties({
          properties: { [COPILOTKIT_FORWARDED_PROPS_KEY]: { ui: envelope } },
          ...scope,
        })
      : null;
    return () => {
      for (const id of ids) copilotkit.removeContext(id);
      if (propertiesId) copilotkit.removeScopedProperties(propertiesId);
    };
  }, [
    copilotkit,
    capabilitiesValue,
    schemaValue,
    envelope,
    a2uiAgentsKey,
    agentIdsKey,
    markdown,
    contextOn,
  ]);

  return null;
}
