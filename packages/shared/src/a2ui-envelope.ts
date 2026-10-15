/**
 * The structured generative-UI envelope the React provider forwards on every
 * run as `forwardedProps.copilotkit.ui`, for backends that build their own
 * prompt instead of relying on the context entries.
 */

/** Top-level `forwardedProps` key CopilotKit namespaces its run properties under. */
export const COPILOTKIT_FORWARDED_PROPS_KEY = "copilotkit";

/** Version of the envelope shape itself (not of the UI protocol it carries). */
export const COPILOTKIT_UI_ENVELOPE_FORMAT = 1;

export interface CopilotKitUIEnvelope {
  /** The generative-UI protocol. Only "a2ui" today. */
  method: "a2ui";
  /** The protocol version the catalog and instructions target. */
  version: "v0.9";
  /** Envelope shape version. */
  format: typeof COPILOTKIT_UI_ENVELOPE_FORMAT;
  /** How the model emits UI: inside ```a2ui markdown fences, or via the render tool. */
  mode: "tool" | "markdown";
  /**
   * The catalog the client renders. `components` is the A2UI inline catalog
   * schema (JSON Schema per component); it is omitted when the provider is
   * configured with `includeCatalog: false`, leaving only the id.
   */
  catalog: { id: string; components?: Record<string, unknown> };
  /** The generation guideline text, ready to append to a system prompt. */
  instructions: string;
  /** Whether the same material was also sent as context entries on this run. */
  contextSent: boolean;
}

/** The envelope on a run's `forwardedProps`, or undefined when absent or malformed. */
export function readCopilotKitUIEnvelope(
  forwardedProps: unknown,
): CopilotKitUIEnvelope | undefined {
  if (typeof forwardedProps !== "object" || forwardedProps === null) {
    return undefined;
  }
  const ns = (forwardedProps as Record<string, unknown>)[
    COPILOTKIT_FORWARDED_PROPS_KEY
  ];
  if (typeof ns !== "object" || ns === null) return undefined;
  const ui = (ns as Record<string, unknown>).ui;
  if (typeof ui !== "object" || ui === null) return undefined;
  const env = ui as Partial<CopilotKitUIEnvelope>;
  if (env.method !== "a2ui") return undefined;
  if (env.mode !== "tool" && env.mode !== "markdown") return undefined;
  return env as CopilotKitUIEnvelope;
}
