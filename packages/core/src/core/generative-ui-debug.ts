import type {
  A2UIOperation,
  CopilotKitUIEnvelope,
  GenerativeUIComponentManifest,
  GenerativeUIJSONSchema,
  GenerativeUIRejectedOperation,
  GenerativeUISurfaceStatus,
  GenerativeUITarget,
} from "@copilotkit/shared";

/** @internal One declared function of the generative UI, for the inspector. */
export interface ɵGenerativeUIDebugFunction {
  description?: string;
  parameters: GenerativeUIJSONSchema;
  /** How many `useGenerativeUIFunction` handlers are mounted. Only 1 is valid. */
  handlers: number;
}

/** @internal One surface that the browser holds, for the inspector. */
export interface ɵGenerativeUIDebugSurface {
  surfaceId: string;
  threadId: string;
  agentId: string | undefined;
  target: string;
  status: GenerativeUISurfaceStatus;
  /** The committed operations, in order. The browser can still reject some. */
  operations: readonly A2UIOperation[];
  /** The current data model. */
  dataModel: unknown;
  /** The values that the user wrote, by path. Agent writes to them are ignored. */
  userValues: Record<string, unknown>;
  rejected: Array<
    GenerativeUIRejectedOperation & { source: "runtime" | "browser" }
  >;
}

/** @internal One part of the text that a run adds to the prompt of the model. */
export interface ɵGenerativeUIDebugPromptSection {
  title: string;
  /** Who adds the text to the prompt. */
  source: "runtime" | "context" | "backend";
  text: string;
}

/** @internal What one run sends, or what the next run will send. */
export interface ɵGenerativeUIDebugRun {
  agentId: string | undefined;
  threadId: string | undefined;
  /** When the run started. Left out for the next run. */
  startedAt?: number;
  /** `forwardedProps.copilotkit.ui` of the run. */
  envelope: CopilotKitUIEnvelope;
  prompt: ɵGenerativeUIDebugPromptSection[];
}

/** @internal The state of a generative UI, for the inspector. */
export interface ɵGenerativeUIDebugSnapshot {
  catalogId: string;
  transport: "tool" | "markdown";
  /** The agents that get the generative UI. Left out: every agent. */
  agentIds?: string[];
  components: Record<string, GenerativeUIComponentManifest>;
  /** The id of the catalog that declared each component, by name. */
  componentCatalogs: Record<string, string>;
  functions: Record<string, ɵGenerativeUIDebugFunction>;
  /** The app state that bound props read, by key. */
  state: Record<string, unknown>;
  /** The chat first, then each mounted `<GenerativeUISurface>`. */
  targets: GenerativeUITarget[];
  activeThreadId: string | undefined;
  surfaces: ɵGenerativeUIDebugSurface[];
  lastRun: ɵGenerativeUIDebugRun | undefined;
  nextRun: ɵGenerativeUIDebugRun;
}

/**
 * @internal What a framework package (react-core) gives core, so that the
 * inspector can show its generative UI. `getSnapshot` builds the snapshot
 * when it is called, so a source that nobody reads costs nothing.
 */
export interface ɵGenerativeUIDebugSource {
  getSnapshot(): ɵGenerativeUIDebugSnapshot;
  /** Calls `listener` when the snapshot changes. Returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
}
