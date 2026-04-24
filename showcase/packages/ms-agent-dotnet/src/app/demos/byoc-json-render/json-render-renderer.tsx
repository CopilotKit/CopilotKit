"use client";

/**
 * Custom `messageView.assistantMessage` slot that renders the agent's
 * structured-JSON output through `@json-render/react`.
 *
 * While the agent streams, the content is often a partial/invalid JSON
 * string. We fall back to the default CopilotChatAssistantMessage which
 * shows the raw streaming text. Once the content parses AND every
 * referenced element type is in the catalog, we swap to the json-render
 * Renderer + our catalog-backed registry (see `registry.tsx`).
 */

import React, { useMemo } from "react";
import {
  CopilotChatAssistantMessage,
  type CopilotChatAssistantMessageProps,
} from "@copilotkit/react-core/v2";
import { Renderer } from "@json-render/react";
import { registry } from "./registry";
import type { JsonRenderSpec } from "./types";

const ALLOWED_TYPES = new Set(["MetricCard", "BarChart", "PieChart"]);

export function JsonRenderAssistantMessage(
  props: CopilotChatAssistantMessageProps,
) {
  const content =
    typeof props.message.content === "string" ? props.message.content : "";

  const parseResult = useMemo(() => parseSpec(content), [content]);

  if (!parseResult.ok) {
    return <CopilotChatAssistantMessage {...props} />;
  }

  return (
    <div data-testid="json-render-root" className="w-full">
      <Renderer
        spec={
          parseResult.spec as unknown as Parameters<typeof Renderer>[0]["spec"]
        }
        registry={registry}
      />
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

function extractJsonObject(raw: string): string | null {
  const fenceMatch = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const candidate = (fenceMatch ? fenceMatch[1] : raw).trim();
  if (!candidate) return null;

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
