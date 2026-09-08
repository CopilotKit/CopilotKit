/**
 * Dynamic A2UI tool — an LLM-designed dashboard.
 *
 * A secondary Anthropic call designs a v0.9 A2UI surface via a structured
 * `render_a2ui` tool call; the result is wrapped as `a2ui_operations` for the
 * frontend. The handler runs in this process (not the CLI subprocess), so it is
 * free to make its own Anthropic request.
 */

import { tool } from "@anthropic-ai/claude-agent-sdk";
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";

import {
  createSurface,
  render,
  updateComponents,
  updateDataModel,
} from "./a2ui";
import { resolveModel } from "./model";
import { CATALOG_ID } from "./a2ui_fixed_schema";

// Structured-output schema handed to the secondary LLM to force one design call.
const RENDER_A2UI_TOOL: Anthropic.Tool = {
  name: "render_a2ui",
  description:
    "Render a dynamic A2UI v0.9 surface. Provide a components array (flat v0.9 " +
    "format; the root component must have id 'root') and an optional initial " +
    "data model.",
  input_schema: {
    type: "object",
    properties: {
      surfaceId: { type: "string", description: "Unique surface id." },
      catalogId: {
        type: "string",
        description: `Catalog id (use '${CATALOG_ID}').`,
      },
      components: {
        type: "array",
        items: { type: "object" },
        description: "A2UI v0.9 component array (flat format).",
      },
      data: {
        type: "object",
        description: "Optional initial data model for the surface.",
      },
    },
    required: ["surfaceId", "catalogId", "components"],
  },
};

export const generateA2ui = tool(
  "generate_a2ui",
  "Generate a dynamic A2UI dashboard (metrics, charts, tables, cards) based " +
    "on the conversation. A secondary LLM designs the UI; it renders automatically.",
  {
    context: z
      .string()
      .describe(
        "A description of the dashboard/UI to build (what to show, which " +
          "metrics, layout hints).",
      ),
  },
  async (args) => {
    // Construct the client per call so it picks up ANTHROPIC_API_KEY /
    // ANTHROPIC_BASE_URL after the environment is loaded.
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    let response;
    try {
      response = await client.messages.create({
        model: resolveModel(),
        max_tokens: 4096,
        system: args.context || "Generate a useful dashboard UI.",
        messages: [
          {
            role: "user",
            content:
              "Generate a dynamic A2UI dashboard based on the conversation.",
          },
        ],
        tools: [RENDER_A2UI_TOOL],
        tool_choice: { type: "tool", name: "render_a2ui" },
      });
    } catch {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              error: "Failed to generate A2UI dashboard",
            }),
          },
        ],
      };
    }

    for (const block of response.content) {
      if (block.type === "tool_use" && block.name === "render_a2ui") {
        const spec = block.input as {
          surfaceId?: string;
          catalogId?: string;
          components?: unknown[];
          data?: Record<string, unknown>;
        };
        const surfaceId = spec.surfaceId || "dynamic-surface";
        const ops = [
          createSurface(surfaceId, spec.catalogId || CATALOG_ID),
          updateComponents(surfaceId, spec.components ?? []),
        ];
        if (spec.data && Object.keys(spec.data).length > 0) {
          ops.push(updateDataModel(surfaceId, spec.data));
        }
        return { content: [{ type: "text" as const, text: render(ops) }] };
      }
    }
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify({ error: "LLM did not call render_a2ui" }),
        },
      ],
    };
  },
);
