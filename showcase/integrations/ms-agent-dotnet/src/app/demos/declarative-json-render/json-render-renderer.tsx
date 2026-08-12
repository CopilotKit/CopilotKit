"use client";

import { useMemo } from "react";
import {
  CopilotChatAssistantMessage,
  type CopilotChatAssistantMessageProps,
} from "@copilotkit/react-core/v2";
import { JSONUIProvider, Renderer } from "@json-render/react";
import { registry } from "./registry";
import type { JsonRenderSpec } from "./types";

const ALLOWED_TYPES = new Set(["MetricCard", "BarChart", "PieChart"]);

export function JsonRenderAssistantMessage(
  props: CopilotChatAssistantMessageProps,
) {
  const content =
    typeof props.message.content === "string" ? props.message.content : "";
  const spec = useMemo(() => parseSpec(content), [content]);

  // Stream not yet a valid spec (or plain prose) — render the default bubble.
  if (!spec) return <CopilotChatAssistantMessage {...props} />;

  return (
    <div
      data-testid="copilot-assistant-message"
      data-message-role="assistant"
      className="w-full"
    >
      <div data-testid="json-render-root" className="w-full">
        <JSONUIProvider registry={registry}>
          <Renderer
            spec={spec as unknown as Parameters<typeof Renderer>[0]["spec"]}
            registry={registry}
          />
        </JSONUIProvider>
      </div>
    </div>
  );
}

/** Parse a json-render spec out of the assistant content, tolerating code fences and prose. */
function parseSpec(raw: string): JsonRenderSpec | null {
  const jsonText = extractJsonObject(raw);
  if (!jsonText) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return null;
  }

  if (!isRecord(parsed)) return null;
  const { root, elements } = parsed as { root?: unknown; elements?: unknown };
  if (typeof root !== "string" || !isRecord(elements) || !(root in elements)) {
    return null;
  }

  for (const el of Object.values(elements)) {
    if (!isRecord(el)) return null;
    if (typeof el.type !== "string" || !ALLOWED_TYPES.has(el.type)) return null;
    if (el.props !== undefined && !isRecord(el.props)) return null;
  }

  return parsed as unknown as JsonRenderSpec;
}

/** Strip code fences, then return the first balanced {...} object as a string. */
function extractJsonObject(raw: string): string | null {
  if (!raw?.trim()) return null;
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const candidate = (fence ? fence[1] : raw).trim();
  const start = candidate.indexOf("{");
  if (start === -1) return null;

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
      if (ch === "\\") escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") depth++;
    else if (ch === "}" && --depth === 0) return candidate.slice(start, i + 1);
  }
  return null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
