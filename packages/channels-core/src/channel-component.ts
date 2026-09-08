import type { Renderable } from "@copilotkit/channels-ui";
import type { InferSchemaOutput, ObjectSchema } from "./standard-schema.js";

export type ChannelComponentPlatform =
  | "slack"
  | "teams"
  | "discord"
  | "telegram"
  | "whatsapp";

export interface ChannelComponentRenderContext {
  platform: ChannelComponentPlatform;
  signal: AbortSignal;
}

export interface ChannelComponentDefinition<
  Schema extends ObjectSchema = ObjectSchema,
> {
  name: string;
  description: string;
  parameters: Schema;
  render(
    props: InferSchemaOutput<Schema>,
    context: ChannelComponentRenderContext,
  ): Renderable | Promise<Renderable>;
}

/** Define an agent-rendered Channel component with schema-inferred props. */
export function defineChannelComponent<Schema extends ObjectSchema>(
  component: ChannelComponentDefinition<Schema>,
): ChannelComponentDefinition<Schema> {
  return component;
}

/** Distinguish component-tool descriptors from legacy JSX component functions. */
export function isChannelComponentDefinition(
  value: unknown,
): value is ChannelComponentDefinition {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { name?: unknown }).name === "string" &&
    typeof (value as { description?: unknown }).description === "string" &&
    typeof (value as { render?: unknown }).render === "function" &&
    typeof (value as { parameters?: { "~standard"?: unknown } }).parameters?.[
      "~standard"
    ] === "object"
  );
}
