import { useLayoutEffect, useRef } from "react";
import { z } from "zod";
import zodToJsonSchema from "zod-to-json-schema";

// ---------------------------------------------------------------------------
// Mirrors packages/shared/src/standard-schema.ts::schemaToJsonSchema
// ---------------------------------------------------------------------------
export function schemaToJsonSchema(schema) {
  const props = schema?.["~standard"];
  if (props?.jsonSchema?.input) return props.jsonSchema.input({ target: "draft-07" });
  if (typeof schema?.toJSONSchema === "function") return schema.toJSONSchema();
  if (props?.vendor === "zod") return zodToJsonSchema(schema, { $refStrategy: "none" });
  throw new Error("Cannot convert schema");
}

// ---------------------------------------------------------------------------
// EXPORT DIRECTION: CopilotKit tool -> WebMCP tool descriptor
// ---------------------------------------------------------------------------
const WEBMCP_NAME_RE = /[^A-Za-z0-9_.\-]/g;
export function toWebMCPName(name) {
  return name.replace(WEBMCP_NAME_RE, "_").slice(0, 128);
}

const EMPTY_SCHEMA = { type: "object", properties: {} };

export function toWebMCPTool(tool, { core, exportedNames }) {
  let inputSchema = EMPTY_SCHEMA;
  if (tool.parameters) {
    const { $schema, ...rest } = schemaToJsonSchema(tool.parameters) ?? {};
    inputSchema = { type: "object", properties: {}, ...rest };
  }
  return {
    name: toWebMCPName(tool.name),
    description: tool.description || tool.name,
    inputSchema,
    annotations: tool.webmcp?.annotations,
    // The bridge RESOLVES with a structured error instead of rejecting:
    // WebMCP drops rejection reasons entirely (completionSteps(null, false)),
    // so rejecting would hand the agent an opaque failure.
    execute: async (args, { signal }) => {
      if (!tool.handler) return { ok: false, error: `Tool '${tool.name}' has no handler` };
      try {
        const result = await tool.handler(args ?? {}, {
          // Synthesized context: there is no AG-UI run behind a WebMCP call.
          toolCall: { id: `webmcp-${crypto.randomUUID()}`, function: { name: tool.name, arguments: JSON.stringify(args ?? {}) } },
          agent: core.getAgent?.(tool.agentId),
          signal,
          source: "webmcp", // <- proposed additive discriminant
        });
        return result === undefined ? { ok: true } : result;
      } catch (error) {
        // Cancellation is NOT a tool result. If the caller aborted, re-throw so
        // the spec's cancellation path runs; only genuine handler failures get
        // converted into a structured, agent-readable result.
        if (signal?.aborted) throw error;
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  };
}

// ---------------------------------------------------------------------------
// The bridge hook. Mount once (inside the provider) - mirrors every eligible
// registered tool into document.modelContext. Zero changes to call sites.
// ---------------------------------------------------------------------------
export function useWebMCPBridge(core, { enabled = true } = {}) {
  const exportedNames = useRef(new Set());

  useLayoutEffect(() => {
    const mc = globalThis.document?.modelContext;
    if (!enabled || !mc) return;

    const controllers = new Map();

    const sync = async () => {
      const eligible = core.tools.filter(
        (t) =>
          t.name !== "*" &&
          t.available !== false &&
          t.handler &&
          t.webmcp !== false &&      // per-tool opt-out
          !t.__fromWebMCP,           // loop guard: never re-export an imported tool
      );
      const want = new Map(eligible.map((t) => [toWebMCPName(t.name), t]));

      for (const [name, ctrl] of controllers) {
        if (!want.has(name)) { ctrl.abort(); controllers.delete(name); exportedNames.current.delete(name); }
      }
      for (const [name, tool] of want) {
        if (controllers.has(name)) continue;
        const ctrl = new AbortController();
        controllers.set(name, ctrl);
        exportedNames.current.add(name);
        try {
          await mc.registerTool(toWebMCPTool(tool, { core, exportedNames }), { signal: ctrl.signal });
        } catch (e) {
          controllers.delete(name); exportedNames.current.delete(name);
          console.warn(`[webmcp] register '${name}' failed:`, e?.message);
        }
      }
    };

    sync();
    const unsubscribe = core.subscribe?.(sync) ?? (() => {});
    return () => { unsubscribe(); for (const c of controllers.values()) c.abort(); controllers.clear(); };
  }, [core, enabled]);

  return exportedNames;
}
