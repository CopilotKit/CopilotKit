/**
 * CopilotKit Studio — shared contract types.
 *
 * These types are the wire-protocol surface between the launcher (Node) and
 * the SPA (browser). They are intentionally framework-free so they can be
 * imported by both halves without pulling in browser- or Node-only deps.
 *
 * **This file is the type lock.** During the parallel-agent phase (Wave 2 of
 * the execution plan), additions are allowed but renames and removals are
 * not. See:
 *   - .chalk/plans/web-inspector-v1.md §7   — full type spec
 *   - .chalk/plans/web-inspector-execution.md §3 — coordination contracts
 *
 * Provenance line numbers below refer to the locked spec at the time of M0.
 */

// ---------------------------------------------------------------------------
// §7.1 Tool descriptor — launcher's internal model, broadcast to SPA over WS.
// ---------------------------------------------------------------------------

/**
 * The CopilotKit hooks the scanner recognizes. New entries can be added as
 * the hook surface grows (see §6.2 HOOK_REGISTRY sketch in the main plan).
 *
 * For M0 the scanner only string-matches `useCopilotAction` — the other
 * variants are listed here so downstream agents (M1+) can extend the scanner
 * without churning this union.
 */
export type HookName =
  | "useCopilotAction"
  | "useRenderTool"
  | "useRenderToolCall"
  | "useDefaultRenderTool"
  | "useFrontendTool";

/**
 * A single parameter on a tool's schema. Intentionally a simpler shape than
 * full JSON Schema — easier to walk for the form renderer and easier to
 * produce from the AST. Spec: .chalk/plans/web-inspector-v1.md §7.1.
 *
 * The `"opaque"` type is the fallback when the launcher can't infer a
 * concrete shape (dynamic Zod, runtime-built `parameters`, etc.). The form
 * renderer falls back to a raw JSON editor for opaque parameters.
 */
export type ParameterDescriptor = {
  name: string;
  type:
    | "string"
    | "number"
    | "boolean"
    | "object"
    | "array"
    | "enum"
    | "opaque";
  required: boolean;
  description?: string;
  /** Present when `type === "enum"`. */
  enumValues?: string[];
  /** Present when `type === "array"`. Describes the element shape. */
  itemType?: ParameterDescriptor;
  /** Present when `type === "object"`. Describes the nested fields. */
  properties?: ParameterDescriptor[];
};

/**
 * A single discovered tool definition. One per `useCopilotAction(...)` (or
 * equivalent hook) call site found during the scan. Spec: §7.1.
 *
 * Field notes:
 *   - `filePath` is always absolute and resolved (no `..`).
 *   - `loc` uses 1-indexed lines and 0-indexed columns to match oxc-parser's
 *     output; M0's regex-based scanner emits the line where the hook call
 *     starts and column 0 as a placeholder.
 *   - `enclosingComponent` is the React component that contains the hook;
 *     `null` when the scanner can't determine it (M0 always emits `null`).
 *   - `parameters` is empty in M0 — schema extraction is M1's job.
 *   - `fixtures` / `fixturePath` are `null` in M0 — fixture loading is M2.
 */
export type ToolDescriptor = {
  name: string;
  hook: HookName;
  filePath: string;
  loc: {
    line: number;
    column: number;
    endLine: number;
    endColumn: number;
  };
  enclosingComponent: string | null;
  description?: string;
  parameters: ParameterDescriptor[];
  fixtures: Record<string, unknown> | null;
  fixturePath: string | null;
};

// ---------------------------------------------------------------------------
// §7.2 Launcher ↔ SPA wire protocol.
//
// Transport: WebSocket at `ws://localhost:NNNN/__inspector/ws`.
// Auth: none — localhost trust model, same as Vite/Next dev servers.
// ---------------------------------------------------------------------------

/**
 * Messages the launcher pushes to the SPA. Spec: §7.2.
 *
 * - `workspace.ready` — first event sent after the scanner finishes its
 *   initial walk. Followed immediately by a `registry.snapshot`.
 * - `registry.snapshot` — full tool list. Sent on connect and on
 *   `LauncherCommand.scan.refresh`.
 * - `registry.delta` — incremental update from the file watcher (M1+).
 * - `fixture.changed` — sibling fixture file edits (M2+).
 * - `scan.error` — a file failed to parse; surfaced in the SPA as a
 *   non-fatal banner.
 */
export type LauncherEvent =
  | {
      type: "registry.snapshot";
      tools: ToolDescriptor[];
      scannedAt: string;
    }
  | {
      type: "registry.delta";
      added: ToolDescriptor[];
      removed: string[];
      modified: ToolDescriptor[];
      at: string;
    }
  | {
      type: "fixture.changed";
      filePath: string;
      tools: string[];
      fixtures: Record<string, unknown>;
      at: string;
    }
  | {
      type: "scan.error";
      filePath: string;
      message: string;
      at: string;
    }
  | {
      type: "workspace.ready";
      rootDir: string;
      scannedFiles: number;
    };

/**
 * Commands the SPA sends back to the launcher. Spec: §7.2.
 *
 * - `fixture.save` / `fixture.delete` — persist/remove a preset in the
 *   sibling `*.fixture.json` for a tool (M2+).
 * - `scan.refresh` — force a full rescan; primarily a debug affordance.
 * - `open-in-editor` — optional, M7+. Best-effort `file://` URL or
 *   per-editor protocol.
 */
export type LauncherCommand =
  | {
      type: "fixture.save";
      toolName: string;
      presetName: string;
      args: unknown;
    }
  | {
      type: "fixture.delete";
      toolName: string;
      presetName: string;
    }
  | { type: "scan.refresh" }
  | { type: "open-in-editor"; filePath: string; line: number };

// ---------------------------------------------------------------------------
// §7.3 SSE events consumed from the user's CopilotKit runtime.
//
// Transport: Server-Sent Events at `GET <runtimeUrl>/cpk-debug-events`.
// Producer: the user's CopilotKit runtime (Hono / Express). NOT the studio
// launcher. The runtime endpoint already exists today and is consumed by the
// VS Code extension's `debug-stream.ts`; we mirror its envelope shape here so
// the browser port stays drop-in compatible.
//
// **No new server-side surface.** v1 only reads the channel; it never POSTs
// or otherwise mutates anything on the runtime. CORS: assume the runtime
// sends `Access-Control-Allow-Origin: *` in dev. If it doesn't, the SSE
// client surfaces a connection error and the timeline drawer degrades to its
// "no runtime" empty state.
//
// **Additive in M5** — these types are new in M5 (Agent D). The pre-existing
// `LauncherEvent` / `LauncherCommand` / `ToolDescriptor` surfaces above are
// untouched.
// ---------------------------------------------------------------------------

/**
 * The raw envelope every event arrives in over the SSE channel. Mirrors the
 * shape the VS Code extension consumes (see
 * `.chalk/references/vscode-extension/src/extension/inspector-types.ts`).
 * Studio's M5 timeline derives `TimelineEvent` from this; later milestones
 * can read `envelope.event` directly to access the AG-UI passthrough.
 */
export type DebugEventEnvelope = {
  /** Epoch milliseconds when the runtime emitted the event. */
  timestamp: number;
  /** The agent that produced the event (e.g. `"default"`). */
  agentId: string;
  /** The thread the event was scoped to. */
  threadId: string;
  /** The run within the thread. */
  runId: string;
  /** The actual event body; `type` discriminates the variants below. */
  event: SseEvent;
};

/**
 * Discriminated event payload inside a `DebugEventEnvelope`. Spec sketch:
 * .chalk/plans/web-inspector-v1.md §7.3.
 *
 * Studio reads the variants listed here; everything else falls into the
 * AG-UI passthrough tail (the last member of the union) so future milestones
 * can broaden the consumer without churning existing members.
 *
 * - `frontend_tool.invoked` — feeds the timeline.
 * - `frontend_tool.result`  — closes out a timeline entry with result/error.
 * - `agent.thread.changed`  — surfaces the active thread in the header.
 *
 * `at` is an ISO-8601 timestamp on each variant; envelopes also carry a
 * `timestamp` (epoch ms) for legacy consumers.
 */
export type SseEvent =
  | {
      type: "frontend_tool.invoked";
      name: string;
      args: unknown;
      agent?: string;
      thread?: string;
      at?: string;
      /** Optional id the runtime mints so result events can join back. */
      invocationId?: string;
    }
  | {
      type: "frontend_tool.result";
      name: string;
      result?: unknown;
      error?: string;
      agent?: string;
      thread?: string;
      at?: string;
      invocationId?: string;
    }
  | {
      type: "agent.thread.changed";
      agent: string;
      thread: string;
      at?: string;
    }
  | {
      // AG-UI passthrough — any event we don't model explicitly. Keeps the
      // envelope total / exhaustive without forcing schema lock-step with
      // the runtime.
      type: string;
      [key: string]: unknown;
    };

/** Lifecycle state of the SSE connection to the user's runtime. */
export type SseConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

/**
 * The studio-internal projection of a `frontend_tool.invoked` (optionally
 * joined with its `frontend_tool.result`). The timeline drawer renders one
 * row per `TimelineEvent`. The M7 integration layer (App.tsx) is responsible
 * for collapsing `invoked` + `result` pairs into a single entry; M5's
 * `sse-client.ts` surfaces raw envelopes and lets the consumer decide.
 *
 * `id` is stable across the entry's lifetime so React keying works through
 * the invoked → result state transition.
 */
export type TimelineEvent = {
  /** Stable, monotonically-unique id (e.g. `${runId}:${invocationId|seq}`). */
  id: string;
  /** ISO-8601 string — display-ready time. */
  at: string;
  /** Tool name from `frontend_tool.invoked`. */
  tool: string;
  /** The args the agent passed. `unknown` because the runtime is the truth. */
  args: unknown;
  agent: string;
  thread: string;
  /** `pending` until the matching `frontend_tool.result` arrives. */
  status: "pending" | "ok" | "error";
  /** Populated when `status === "ok"`. */
  result?: unknown;
  /** Populated when `status === "error"`. */
  error?: string;
};
