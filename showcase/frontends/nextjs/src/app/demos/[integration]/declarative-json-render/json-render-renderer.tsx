"use client";

import { useMemo } from "react";
import { CopilotChatAssistantMessage } from "@copilotkit/react-core/v2";
import type { CopilotChatAssistantMessageProps } from "@copilotkit/react-core/v2";
import type { Spec } from "@json-render/core";
import { JSONUIProvider, Renderer } from "@json-render/react";
import { registry } from "./registry";

const ALLOWED_TYPES = new Set(["MetricCard", "BarChart", "PieChart"]);

export function JsonRenderAssistantMessage(
  props: CopilotChatAssistantMessageProps,
) {
  const content =
    typeof props.message.content === "string" ? props.message.content : "";
  const spec = useMemo(() => parseSpec(content), [content]);

  // While the stream is not a valid spec yet (or is plain prose), render the
  // default bubble.
  if (!spec) return <CopilotChatAssistantMessage {...props} />;

  return (
    <div
      data-testid="copilot-assistant-message"
      data-message-role="assistant"
      className="w-full"
    >
      <div data-testid="json-render-root" className="w-full">
        <JSONUIProvider registry={registry}>
          <Renderer spec={spec} registry={registry} />
        </JSONUIProvider>
      </div>
    </div>
  );
}

/** Parses a json-render spec out of the assistant content, tolerating code fences and prose. */
function parseSpec(raw: string) {
  const jsonText = extractJsonObject(raw);
  if (!jsonText) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return null;
  }

  return isRenderableSpec(parsed) ? parsed : null;
}

/**
 * True when `value` is a spec whose root element exists and whose elements
 * all have props and a type from this demo's catalog.
 */
function isRenderableSpec(value: unknown): value is Spec {
  if (!isRecord(value)) return false;
  const { root, elements } = value;
  const hasRoot =
    typeof root === "string" && isRecord(elements) && root in elements;
  if (!hasRoot) return false;
  return Object.values(elements).every(isRenderableElement);
}

function isRenderableElement(element: unknown) {
  if (!isRecord(element)) return false;
  const hasAllowedType =
    typeof element.type === "string" && ALLOWED_TYPES.has(element.type);
  return hasAllowedType && isRecord(element.props);
}

/** Strips code fences, then returns the first balanced {...} object as a string. */
function extractJsonObject(raw: string) {
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
