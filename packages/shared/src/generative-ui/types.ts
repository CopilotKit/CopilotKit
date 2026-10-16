/** A2UI protocol version used on the wire. */
export const A2UI_VERSION = "v0.9";
/** Activity type of a generated surface message. */
export const GENERATIVE_UI_ACTIVITY_TYPE = "generative-ui-surface";
/** Tool the model calls to render or update surfaces. */
export const GENERATIVE_UI_RENDER_TOOL = "render_ui";
/** Target id of the chat transcript. */
export const GENERATIVE_UI_CHAT_TARGET = "chat";
/** Component id every surface renders from. */
export const GENERATIVE_UI_ROOT_ID = "root";

/** Activity message id of a surface. One message per surface. */
export function generativeUISurfaceMessageId(surfaceId: string): string {
  return `genui:${surfaceId}`;
}

// Named `GenerativeUIJSONSchema` because the package root already exports a
// `JSONSchema` (utils/json-schema.ts); the bare name would collide.
export type GenerativeUIJSONSchema = Record<string, unknown>;

export type A2UIComponentNode = {
  id: string;
  component: string;
  [prop: string]: unknown;
};

export type A2UIOperation =
  | { version: "v0.9"; createSurface: { surfaceId: string; catalogId: string } }
  | {
      version: "v0.9";
      updateComponents: { surfaceId: string; components: A2UIComponentNode[] };
    }
  | {
      version: "v0.9";
      updateDataModel: { surfaceId: string; path?: string; value?: unknown };
    }
  | { version: "v0.9"; deleteSurface: { surfaceId: string } };

/** Value of an event prop: run a host function, or report the event to the agent. */
export type GenerativeUIActionBinding =
  | { functionCall: { call: string; args?: Record<string, unknown> } }
  | { event: { name: string; context?: Record<string, unknown> } };

export type GenerativeUISurfaceStatus = "streaming" | "ready" | "error";

export interface GenerativeUIRejectedOperation {
  /** Position of the operation in the render_ui call, or in the content list. */
  index: number;
  reason: string;
}

/** Content of a `generative-ui-surface` activity message. */
export interface GenerativeUISurfaceContent {
  surfaceId: string;
  target: string;
  catalogId: string;
  /** Committed (validated) operations, cumulative. */
  operations: A2UIOperation[];
  status: GenerativeUISurfaceStatus;
  rejected: GenerativeUIRejectedOperation[];
}

/**
 * Value of a "multiple" slot that repeats one component for each item of the
 * list at `path`. Paths inside the repeated component are relative to the item.
 */
export type GenerativeUITemplateChildren = {
  componentId: string;
  path: string;
};

export interface GenerativeUIComponentManifest {
  description?: string;
  props: GenerativeUIJSONSchema;
  events?: Record<
    string,
    { description?: string; parameters: GenerativeUIJSONSchema }
  >;
  /**
   * Props that hold child components. A "single" slot takes one component id.
   * A "multiple" slot takes a `string[]` of component ids, or a
   * {@link GenerativeUITemplateChildren} template.
   */
  slots?: Record<string, "single" | "multiple">;
}

export interface GenerativeUIFunctionManifest {
  description?: string;
  parameters: GenerativeUIJSONSchema;
}

/** Serializable description of what the browser can render and call. */
export interface GenerativeUIManifest {
  catalogId: string;
  catalogVersion: string;
  components: Record<string, GenerativeUIComponentManifest>;
  functions: Record<string, GenerativeUIFunctionManifest>;
  /**
   * Places where the model can render surfaces. Only mounted targets are
   * listed. `description` tells the model where the target is on the page
   * and what to put in it.
   */
  targets: { id: string; kind: "chat" | "inline"; description?: string }[];
  /** Surfaces the client already holds for the current thread. */
  surfaces: Record<string, GenerativeUISurfaceSummary>;
}

/** Most rejections that a surface summary lists. */
export const GENERATIVE_UI_MAX_SUMMARY_REJECTIONS = 20;
/** Most characters of one rejection in a surface summary. */
export const GENERATIVE_UI_MAX_REJECTION_LENGTH = 500;

/** One surface that the client holds, as the model sees it. */
export interface GenerativeUISurfaceSummary {
  target: string;
  /** The values that the user set, by path. Left out when there are none. */
  dataModel?: Record<string, unknown>;
  /**
   * Operations that the client dropped, as `"operation <index>: <reason>"`.
   * At most {@link GENERATIVE_UI_MAX_SUMMARY_REJECTIONS} entries of at most
   * {@link GENERATIVE_UI_MAX_REJECTION_LENGTH} characters. Left out when
   * there are none.
   */
  rejected?: string[];
}

/** A user interaction bound to `{ event }`, sent to the agent. */
export interface GenerativeUIUserEvent {
  name: string;
  surfaceId: string;
  componentId: string;
  context: Record<string, unknown>;
}
