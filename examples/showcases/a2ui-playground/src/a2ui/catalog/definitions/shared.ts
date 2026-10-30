/**
 * Shared prop shapes for every catalog definition.
 *
 * This file must stay free of React: the agent (server) imports the
 * definitions to build the sub-agent's catalog prompt and to repair
 * streamed props, the client imports them to build the generative UI.
 *
 * A2UI 1.0 resolves dynamic values at any depth before props are
 * validated: any value may be a `{ "@path": "/x" }` binding or a
 * `{ "@call": "fn", args }` function call. So a schema describes only the
 * literal value; there is no `{ path }` union any more.
 *
 * Child references use the A2UI 1.0 `ComponentId` / `ChildList` marks, the
 * same ones `child()` / `childList()` from
 * `@copilotkit/react-core/v2/generative-ui` write. They are re-declared here
 * because that module is client-only. The engine renders the referenced
 * components and hands the renderer React nodes in place of the ids.
 */
import type { ReactNode } from "react";
import { A2UI_CHILD_LIST_MARK, A2UI_COMPONENT_ID_MARK } from "@copilotkit/shared";
import { z } from "zod";

const toNode = (value: unknown) => value as ReactNode;
const mark = (prefix: string, description?: string) => (description ? `${prefix} ${description}` : prefix);

/** One component id. The renderer receives the rendered child. */
export function child(description?: string) {
  return z.string().min(1).describe(mark(A2UI_COMPONENT_ID_MARK, description)).transform(toNode);
}

/** Component ids, or a template `{ componentId, path }` repeated per item of a data array. */
export function childList(description?: string) {
  return z
    .union([z.array(z.string().min(1)), z.object({ componentId: z.string().min(1), path: z.string().min(1) })])
    .describe(mark(A2UI_CHILD_LIST_MARK, description))
    .transform(toNode);
}

export const tone = z.enum(["default", "positive", "negative", "warning", "info", "accent"]);
export const option = z.object({ value: z.string(), label: z.string() });

export type Category =
  | "Layout"
  | "Content"
  | "Data display"
  | "Charts"
  | "Maps"
  | "Inputs"
  | "Feedback"
  | "Domain";

/** An event prop. The model binds it to `{ event }` (sent to the agent) or `{ functionCall }`. */
export type EventDef = { description?: string; parameters: z.ZodTypeAny };

export type Def<T extends z.ZodRawShape = z.ZodRawShape> = {
  category: Category;
  description: string;
  props: z.ZodObject<T>;
  /** Callback props, e.g. `onAction`. */
  events?: Record<string, EventDef>;
  /** Props the component writes back to the data model: `value` gets `setValue`. */
  writable?: readonly string[];
};

/** Typed helper that keeps the Zod shape inferable per definition. */
export function def<T extends z.ZodRawShape>(
  category: Category,
  description: string,
  props: z.ZodObject<T>,
  extra: Pick<Def<T>, "events" | "writable"> = {},
): Def<T> {
  return { category, description, props, ...extra };
}

/**
 * The one event the playground's cards fire. The component calls it with no
 * arguments; the model's binding supplies the name and context.
 */
export const onAction = (description: string): Pick<Def, "events"> => ({
  events: { onAction: { description, parameters: z.object({}).passthrough() } },
});

/** Inputs write their `value` back to the bound data-model path. */
export const writableValue: Pick<Def, "writable"> = { writable: ["value"] };

export const gap = z.enum(["none", "xs", "sm", "md", "lg"]);
export const icon = z.string().describe("lucide icon name, kebab-case");
