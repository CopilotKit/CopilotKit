/** A2UI protocol version used on the wire. */
export const A2UI_VERSION = "v0.9";
/** Activity type of a generated surface message. */
export const GENERATIVE_UI_ACTIVITY_TYPE = "generative-ui-surface";
/** forwardedProps key carrying the client manifest. */
export const GENERATIVE_UI_MANIFEST_KEY = "generativeUI";
/** forwardedProps key carrying a user event bound to the agent. */
export const GENERATIVE_UI_ACTION_KEY = "generativeUIAction";
/** Tool the model calls to render or update surfaces. */
export const GENERATIVE_UI_RENDER_TOOL = "render_ui";
/** Synthetic tool call that reports a user event to the model. */
export const GENERATIVE_UI_EVENT_TOOL = "log_generative_ui_event";
/** Target id of the chat transcript. */
export const GENERATIVE_UI_CHAT_TARGET = "chat";
/** Data-model subtree owned by the app (read-only for agents). */
export const GENERATIVE_UI_APP_STATE_PATH = "/app";
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

export interface GenerativeUIComponentManifest {
  description?: string;
  props: GenerativeUIJSONSchema;
  events?: Record<
    string,
    { description?: string; parameters: GenerativeUIJSONSchema }
  >;
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
  appState: string[];
  targets: { id: string; kind: "chat" | "inline" }[];
  /** Surfaces the client already holds for the current thread. */
  surfaces: Record<string, { target: string }>;
}

/** A user interaction bound to `{ event }`, sent to the agent. */
export interface GenerativeUIUserEvent {
  name: string;
  surfaceId: string;
  componentId: string;
  context: Record<string, unknown>;
}
