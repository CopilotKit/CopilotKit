export const MODELS = ["gemini-3.6-flash", "gemini-3.8-flash"] as const;
export const FORMATS = ["express", "json"] as const;
export const TRANSPORTS = ["markdown", "tool"] as const;
export const DEMOS = ["general", "charting"] as const;

export type ExampleModel = (typeof MODELS)[number];
export type ExampleFormat = (typeof FORMATS)[number];
export type ExampleTransport = (typeof TRANSPORTS)[number];
export type ExampleDemo = (typeof DEMOS)[number];

export interface ExampleSettings {
  model: ExampleModel;
  format: ExampleFormat;
  transport: ExampleTransport;
  demo: ExampleDemo;
}

export function getAgentId({
  model,
  format,
  transport,
}: Pick<ExampleSettings, "model" | "format" | "transport">) {
  return `adk-${model}-${format}-${transport}`;
}

export function readSettings(params: {
  get(name: string): string | null;
}): ExampleSettings {
  return {
    model:
      params.get("model") === "gemini-3.6-flash"
        ? "gemini-3.6-flash"
        : "gemini-3.8-flash",
    format: params.get("format") === "json" ? "json" : "express",
    transport: params.get("transport") === "tool" ? "tool" : "markdown",
    demo: params.get("demo") === "charting" ? "charting" : "general",
  };
}
