// The agent of the agent-config demo for the ag2, claude-sdk-python, langroid
// and llamaindex agent servers. The runtime sends the CopilotKit provider's
// `properties` as top-level keys of the run's `forwardedProps`. This agent
// moves them into `forwardedProps.config.configurable.properties`, the place
// where a LangGraph graph reads them, so every agent server gets them in the
// same place.
import { HttpAgent } from "@ag-ui/client";
import type { RunAgentInput } from "@ag-ui/client";

// The `forwardedProps` keys that the run uses itself. They are the keys of
// `RunAgentExtendedInput["forwardedProps"]` in the LangGraph AG-UI client.
// Every other key is a provider property.
const RESERVED_FORWARDED_PROPS_KEYS = new Set([
  "config",
  "command",
  "streamMode",
  "streamSubgraphs",
  "nodeName",
  "threadMetadata",
  "checkpointId",
  "checkpointDuring",
  "interruptBefore",
  "interruptAfter",
  "multitaskStrategy",
  "ifNotExists",
  "afterSeconds",
  "onCompletion",
  "onDisconnect",
  "webhook",
  "feedbackKeys",
  "metadata",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Splits a run's `forwardedProps` into the keys that the run uses itself
 * (`config`, `command`, `streamMode` and the other LangGraph run keys) and the
 * CopilotKit provider's `properties`, which the runtime adds next to them.
 *
 * @param forwardedProps - The run's `forwardedProps`. A value that is not an
 *   object gives two empty objects.
 *
 * @example
 * splitForwardedProps({ streamMode: "values", tone: "casual" });
 * // { reserved: { streamMode: "values" }, properties: { tone: "casual" } }
 */
export function splitForwardedProps(forwardedProps: unknown) {
  const reserved: Record<string, unknown> = {};
  const properties: Record<string, unknown> = {};
  if (!isRecord(forwardedProps)) return { reserved, properties };
  const entries = Object.entries(forwardedProps);
  for (const [key, value] of entries) {
    if (RESERVED_FORWARDED_PROPS_KEYS.has(key)) reserved[key] = value;
    else properties[key] = value;
  }
  return { reserved, properties };
}

// `input` with the provider's properties moved into
// `forwardedProps.config.configurable.properties`. A property that is already
// there keeps its value unless the provider sets the same key. Without
// provider properties, `input` is returned as it is.
function movePropertiesToConfigurable(input: RunAgentInput) {
  const { reserved, properties } = splitForwardedProps(input.forwardedProps);
  const hasProperties = Object.keys(properties).length > 0;
  if (!hasProperties) return input;
  const config = isRecord(reserved.config) ? reserved.config : {};
  const configurable = isRecord(config.configurable) ? config.configurable : {};
  const current = isRecord(configurable.properties)
    ? configurable.properties
    : {};
  return {
    ...input,
    forwardedProps: {
      ...reserved,
      config: {
        ...config,
        configurable: {
          ...configurable,
          properties: { ...current, ...properties },
        },
      },
    },
  };
}

/**
 * An `HttpAgent` that moves the CopilotKit provider's `properties` from the
 * top level of `forwardedProps` into
 * `forwardedProps.config.configurable.properties` before it posts a run. The
 * keys that the run uses itself, such as `config` and `streamMode`, stay where
 * they are.
 *
 * The class keeps no fields of its own, so the copy that `clone()` makes for
 * each request does the same.
 *
 * @example
 * new AgentConfigHttpAgent({ url: `${agentUrl("ag2")}/agent-config/` });
 */
export class AgentConfigHttpAgent extends HttpAgent {
  run(input: RunAgentInput) {
    return super.run(movePropertiesToConfigurable(input));
  }
}
