"use client";

/**
 * Custom `messageView.assistantMessage` slot that renders the agent's
 * structured-JSON output through `@json-render/react`.
 *
 * The langgraph-python `byoc_json_render_agent` emits a single JSON object
 * shaped like `@json-render/react`'s flat spec format:
 *
 * ```json
 * {
 *   "root": "<id>",
 *   "elements": {
 *     "<id>": { "type": "MetricCard" | "BarChart" | "PieChart", "props": { ... } }
 *   }
 * }
 * ```
 *
 * While the agent streams, the content is often a partial/invalid JSON
 * string — we fall back to the default CopilotChatAssistantMessage which
 * shows the raw streaming text. Once the content parses AND every
 * referenced element type is in the catalog, we swap to the json-render
 * Renderer + our catalog-backed registry (see `registry.tsx`).
 *
 * Streaming-model decision (R2 in the spec): `@json-render/core`'s
 * SpecStream compiler consumes JSONL patches, but our agent emits a
 * single JSON object, not patches. We buffer until the content is valid
 * JSON, then render — losing progressive in-JSON rendering but gaining
 * correct behaviour against the agent's actual output shape.
 */

import React, { useMemo } from "react";
import { CopilotChatAssistantMessage } from "@copilotkit/react-core/v2";
import type { CopilotChatAssistantMessageProps } from "@copilotkit/react-core/v2";
import { JSONUIProvider, Renderer } from "@json-render/react";
import { registry } from "./registry";
import type { JsonRenderSpec } from "./types";

// Allowed component types per the catalog (see ./catalog.ts). Kept in sync
// manually rather than derived from the catalog object, because the agent
// output may contain stray tokens while streaming and we want a defensive
// allowlist here too.
const ALLOWED_TYPES = new Set(["MetricCard", "BarChart", "PieChart"]);

export function JsonRenderAssistantMessage(
  props: CopilotChatAssistantMessageProps,
) {
  const content =
    typeof props.message.content === "string" ? props.message.content : "";

  const parseResult = useMemo(() => parseSpec(content), [content]);

  // Still streaming or not valid spec yet — fall through to the default
  // assistant-message chrome (renders the raw text via Streamdown). This
  // keeps the bubble visually consistent during streaming, and if the
  // agent replied with plain text (e.g. an unprompted free-form answer)
  // we still render it sensibly.
  if (!parseResult.ok) {
    return <CopilotChatAssistantMessage {...props} />;
  }

  // Valid spec — render via json-render. `<Renderer />` alone does not
  // set up the StateProvider / VisibilityProvider / ActionProvider /
  // ValidationProvider contexts its `ElementRenderer` requires (it would
  // crash with `useVisibility must be used within a VisibilityProvider`).
  // `JSONUIProvider` wires all four in one; we don't use actions or
  // state here, so defaults are fine.
  // Re-attach `data-testid="copilot-assistant-message"` — the harness'
  // e2e-deep conversation runner uses that testid to count settled
  // responses, and the messageView slot override would otherwise drop
  // it. Same reasoning as byoc-hashbrown's renderer.
  return (
    <div
      data-testid="copilot-assistant-message"
      data-message-role="assistant"
      className="w-full"
    >
      <div data-testid="json-render-root" className="w-full">
        <JSONUIProvider registry={registry}>
          <Renderer
            spec={
              parseResult.spec as unknown as Parameters<
                typeof Renderer
              >[0]["spec"]
            }
            registry={registry}
          />
        </JSONUIProvider>
      </div>
    </div>
  );
}

interface ParseOk {
  ok: true;
  spec: JsonRenderSpec;
}

interface ParseFail {
  ok: false;
  reason: "empty" | "invalid-json" | "wrong-shape" | "unknown-type";
}

type ParseResult = ParseOk | ParseFail;

/**
 * Parse the assistant message content into a json-render spec.
 *
 * Tolerates:
 * - code-fenced JSON (```json ... ```)
 * - leading/trailing prose around the JSON object
 * - partial streams (returns `invalid-json` silently)
 */
function parseSpec(raw: string): ParseResult {
  if (!raw || !raw.trim()) return { ok: false, reason: "empty" };

  const jsonText = extractJsonObject(raw);
  if (!jsonText) return { ok: false, reason: "invalid-json" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return { ok: false, reason: "invalid-json" };
  }

  if (!isRecord(parsed)) return { ok: false, reason: "wrong-shape" };
  const root = (parsed as { root?: unknown }).root;
  const elements = (parsed as { elements?: unknown }).elements;
  if (typeof root !== "string" || !isRecord(elements)) {
    return { ok: false, reason: "wrong-shape" };
  }
  if (!(root in (elements as Record<string, unknown>))) {
    return { ok: false, reason: "wrong-shape" };
  }

  for (const [, el] of Object.entries(elements as Record<string, unknown>)) {
    if (!isRecord(el)) return { ok: false, reason: "wrong-shape" };
    const type = (el as { type?: unknown }).type;
    if (typeof type !== "string" || !ALLOWED_TYPES.has(type)) {
      return { ok: false, reason: "unknown-type" };
    }
    const elProps = (el as { props?: unknown }).props;
    if (elProps !== undefined && !isRecord(elProps)) {
      return { ok: false, reason: "wrong-shape" };
    }
  }

  return { ok: true, spec: parsed as unknown as JsonRenderSpec };
}

/** Strip code fences and find the first balanced JSON object. */
function extractJsonObject(raw: string): string | null {
  const fenceMatch = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const candidate = (fenceMatch ? fenceMatch[1] : raw).trim();
  if (!candidate) return null;

  const start = candidate.indexOf("{");
  if (start === -1) return null;

  // Walk balanced braces, respecting strings and escapes.
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (inString) {
      if (ch === "\\") {
        escape = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return candidate.slice(start, i + 1);
    }
  }
  return null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
