import { EventType, Middleware } from "@ag-ui/client";
import type {
  AbstractAgent,
  BaseEvent,
  Message,
  RunAgentInput,
  ToolCallArgsEvent,
  ToolCallEndEvent,
  ToolCallStartEvent,
} from "@ag-ui/client";
import { Observable } from "rxjs";
import {
  GENERATIVE_UI_ACTIVITY_TYPE,
  GENERATIVE_UI_RENDER_TOOL,
  RenderUIArgsStream,
  generativeUISurfaceMessageId,
  getOperationKind,
  getOperationSurfaceId,
  randomUUID,
  readCopilotKitUIEnvelope,
  validateOperation,
} from "@copilotkit/shared";
import type {
  A2UIOperation,
  GenerativeUIManifest,
  GenerativeUIRejectedOperation,
  GenerativeUISurfaceContent,
} from "@copilotkit/shared";
import {
  GENERATIVE_UI_CONTEXT_DESCRIPTION,
  buildGenerativeUIPrompt,
} from "./prompt";

type EventWithState = { event: BaseEvent; messages: Message[] };
type JsonPatchOperation = {
  op: "add" | "replace";
  path: string;
  value: unknown;
};

interface RenderCallState {
  stream: RenderUIArgsStream;
  target?: string;
  buffered: Array<Record<string, unknown> | null>;
  nextIndex: number;
  applied: number;
  rejected: GenerativeUIRejectedOperation[];
  touched: Set<string>;
  finished: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Builds the manifest from the generative UI envelope
 * (`forwardedProps.copilotkit.ui`). The client sends the envelope, so it is
 * not trusted: `readCopilotKitUIEnvelope` checks every field. Returns
 * `undefined` (the run passes through) when:
 * - there is no valid envelope;
 * - the transport is "markdown" (the model writes fences, not render_ui);
 * - the catalog has no components (the server cannot validate operations).
 */
function readManifest(forwardedProps: unknown) {
  const envelope = readCopilotKitUIEnvelope(forwardedProps);
  if (envelope?.transport !== "tool") return undefined;
  const { catalog, functions, targets, surfaces } = envelope;
  if (catalog.components === undefined) return undefined;
  return {
    catalogId: catalog.id,
    catalogVersion: catalog.version,
    components: catalog.components,
    functions,
    targets,
    surfaces,
  };
}

function prepareInput(input: RunAgentInput, manifest: GenerativeUIManifest) {
  const tools = (input.tools ?? []).filter(
    (t) => t.name !== GENERATIVE_UI_RENDER_TOOL,
  );
  tools.push({
    name: GENERATIVE_UI_RENDER_TOOL,
    description:
      "Render or update generative UI surfaces with A2UI v0.9 operations. Follow the generative UI guide in context.",
    parameters: {
      type: "object",
      properties: {
        target: {
          type: "string",
          enum: manifest.targets.map((t) => t.id),
          description:
            'Where the surface is shown: "chat" or a named inline target.',
        },
        operations: {
          type: "array",
          description: "A2UI v0.9 operations, applied in order.",
          items: { type: "object" },
        },
      },
      required: ["target", "operations"],
    },
  });
  const context = (input.context ?? []).filter(
    (c) => c.description !== GENERATIVE_UI_CONTEXT_DESCRIPTION,
  );
  context.push({
    description: GENERATIVE_UI_CONTEXT_DESCRIPTION,
    value: buildGenerativeUIPrompt(manifest),
  });
  return { ...input, tools, context };
}

/**
 * Experimental. Lets an agent render CopilotKit generative UI surfaces via the
 * `render_ui` tool. It applies only to runs whose generative UI envelope uses
 * the "tool" transport. Each complete operation in the streamed arguments is
 * validated against the catalog in the envelope and committed immediately:
 * `ACTIVITY_SNAPSHOT` for a new surface, `ACTIVITY_DELTA` for every further op.
 */
export class GenerativeUIMiddleware extends Middleware {
  run(input: RunAgentInput, next: AbstractAgent): Observable<BaseEvent> {
    const manifest = readManifest(input.forwardedProps);
    if (!manifest) return this.runNext(input, next);
    return processStream(
      this.runNextWithState(
        prepareInput(input, manifest),
        next,
      ) as Observable<EventWithState>,
      manifest,
    );
  }
}

/**
 * The first time a render_ui call touches an existing surface, mark it
 * streaming and clear its rejection list: earlier calls' rejections were
 * already reported to the model in their own tool results, and a repaired
 * surface must not keep showing them. A surface created by this call starts
 * with an empty list in its snapshot.
 */
function beginSurfaceUpdate(
  state: RenderCallState,
  surfaceId: string,
): JsonPatchOperation[] {
  if (state.touched.has(surfaceId)) return [];
  state.touched.add(surfaceId);
  return [
    { op: "replace", path: "/status", value: "streaming" },
    { op: "replace", path: "/rejected", value: [] },
  ];
}

function processStream(
  source: Observable<EventWithState>,
  manifest: GenerativeUIManifest,
) {
  return new Observable<BaseEvent>((subscriber) => {
    const surfaces = new Map<string, string>(
      Object.entries(manifest.surfaces).map(([id, s]) => [id, s.target]),
    );
    const calls = new Map<string, RenderCallState>();
    let heldFinish: EventWithState | null = null;

    const emit = (event: BaseEvent) => subscriber.next(event);
    const patch = (surfaceId: string, ops: JsonPatchOperation[]) =>
      emit({
        type: EventType.ACTIVITY_DELTA,
        messageId: generativeUISurfaceMessageId(surfaceId),
        activityType: GENERATIVE_UI_ACTIVITY_TYPE,
        patch: ops,
      } as BaseEvent);

    const processOperation = (
      state: RenderCallState,
      op: Record<string, unknown> | null,
    ) => {
      const index = state.nextIndex++;
      const reject = (reason: string, surfaceId?: string) => {
        const entry = { index, reason };
        state.rejected.push(entry);
        if (surfaceId && surfaces.has(surfaceId)) {
          patch(surfaceId, [
            ...beginSurfaceUpdate(state, surfaceId),
            { op: "add", path: "/rejected/-", value: entry },
          ]);
        }
      };
      if (op === null) return reject("operation is not valid JSON");
      let surfaceId: string | undefined;
      try {
        surfaceId = getOperationSurfaceId(op);
        applyOperation(state, withCatalogId(op), surfaceId, reject);
      } catch (error) {
        // Never let one bad operation take down the run: report it to the
        // model through the tool result instead.
        reject(
          `operation could not be processed: ${error instanceof Error ? error.message : String(error)}`,
          surfaceId,
        );
      }
    };

    /**
     * A run has one catalog, so the model does not have to name it. A
     * createSurface gets the catalog id of the envelope, whatever the model
     * wrote. The operation on the wire then stays valid A2UI v0.9.
     */
    const withCatalogId = (op: Record<string, unknown>) => {
      const create = op.createSurface;
      if (typeof create !== "object" || create === null) return op;
      return {
        ...op,
        createSurface: { ...create, catalogId: manifest.catalogId },
      };
    };

    const applyOperation = (
      state: RenderCallState,
      op: Record<string, unknown>,
      surfaceId: string | undefined,
      reject: (reason: string, surfaceId?: string) => void,
    ) => {
      const validation = validateOperation(op, {
        manifest,
        knownSurfaces: new Set(surfaces.keys()),
        functions: manifest.functions,
      });
      // `=== false` (not `!ok`): runtime is compiled non-strict, where `!ok`
      // does not narrow the discriminated union.
      if (validation.ok === false) return reject(validation.reason, surfaceId);
      const id = surfaceId as string;
      const kind = getOperationKind(op);

      if (kind === "createSurface") {
        const target = state.target as string;
        if (!manifest.targets.some((t) => t.id === target)) {
          return reject(`target "${target}" is not mounted`);
        }
        surfaces.set(id, target);
        const content: GenerativeUISurfaceContent = {
          surfaceId: id,
          target,
          catalogId: manifest.catalogId,
          operations: [op as unknown as A2UIOperation],
          status: "streaming",
          rejected: [],
        };
        emit({
          type: EventType.ACTIVITY_SNAPSHOT,
          messageId: generativeUISurfaceMessageId(id),
          activityType: GENERATIVE_UI_ACTIVITY_TYPE,
          content,
          replace: true,
        } as BaseEvent);
        state.touched.add(id);
      } else {
        patch(id, [
          ...beginSurfaceUpdate(state, id),
          { op: "add", path: "/operations/-", value: op },
        ]);
        if (kind === "deleteSurface") surfaces.delete(id);
      }
      state.applied++;
    };

    /** Same buffering rule as streamed ops: hold them until the target is known. */
    const acceptOperation = (
      state: RenderCallState,
      op: Record<string, unknown> | null,
    ) => {
      if (state.target === undefined) state.buffered.push(op);
      else processOperation(state, op);
    };

    /**
     * The streaming parser found no operations at all. Models sometimes send
     * `operations` as a JSON-encoded string; recover those from the complete
     * arguments. Anything still unusable leaves the call with zero operations,
     * which the tool result reports as an error.
     */
    const recoverOperations = (state: RenderCallState) => {
      let args: unknown;
      try {
        args = JSON.parse(state.stream.text);
      } catch {
        return;
      }
      if (!isRecord(args)) return;
      if (state.target === undefined && typeof args.target === "string") {
        state.target = args.target;
      }
      let operations = args.operations;
      if (typeof operations === "string") {
        try {
          operations = JSON.parse(operations);
        } catch {
          return;
        }
      }
      if (!Array.isArray(operations)) return;
      for (const op of operations)
        acceptOperation(state, isRecord(op) ? op : null);
    };

    const finishCall = (state: RenderCallState) => {
      if (state.finished) return;
      state.finished = true;
      if (state.nextIndex === 0 && state.buffered.length === 0)
        recoverOperations(state);
      if (state.target === undefined) {
        for (const _op of state.buffered) {
          state.rejected.push({
            index: state.nextIndex++,
            reason: "render_ui was called without a target",
          });
        }
        state.buffered = [];
      }
      if (state.stream.hasIncompleteOperation) {
        // The arguments ended inside an element (for example the model hit its
        // output limit): report it instead of silently dropping it.
        state.rejected.push({
          index: state.nextIndex++,
          reason: "operation was truncated",
        });
      }
      for (const id of state.touched) {
        patch(id, [{ op: "replace", path: "/status", value: "ready" }]);
      }
    };

    const flushFinish = () => {
      if (heldFinish) {
        emit(heldFinish.event);
        heldFinish = null;
      }
    };

    const handleEvent = ({ event, messages }: EventWithState) => {
      flushFinish();
      if (event.type === EventType.RUN_FINISHED) {
        heldFinish = { event, messages };
        return;
      }
      emit(event);
      if (event.type === EventType.TOOL_CALL_START) {
        const start = event as ToolCallStartEvent;
        if (start.toolCallName === GENERATIVE_UI_RENDER_TOOL) {
          calls.set(start.toolCallId, {
            stream: new RenderUIArgsStream(),
            buffered: [],
            nextIndex: 0,
            applied: 0,
            rejected: [],
            touched: new Set(),
            finished: false,
          });
        }
      } else if (event.type === EventType.TOOL_CALL_ARGS) {
        const args = event as ToolCallArgsEvent;
        const state = calls.get(args.toolCallId);
        if (!state || state.finished) return;
        const { target, newOperations } = state.stream.push(args.delta);
        if (target !== undefined && state.target === undefined) {
          state.target = target;
          const buffered = state.buffered;
          state.buffered = [];
          for (const op of buffered) processOperation(state, op);
        }
        for (const op of newOperations) acceptOperation(state, op);
      } else if (event.type === EventType.TOOL_CALL_END) {
        const state = calls.get((event as ToolCallEndEvent).toolCallId);
        if (state) finishCall(state);
      }
    };

    const completeRun = () => {
      for (const state of calls.values()) finishCall(state);
      if (heldFinish) {
        const answered = new Set(
          heldFinish.messages
            .filter((m) => m.role === "tool")
            .map((m) => (m as { toolCallId: string }).toolCallId),
        );
        for (const [toolCallId, state] of calls) {
          if (answered.has(toolCallId)) continue;
          const nothingParsed =
            state.applied === 0 && state.rejected.length === 0;
          emit({
            type: EventType.TOOL_CALL_RESULT,
            messageId: randomUUID(),
            toolCallId,
            content: JSON.stringify(
              nothingParsed
                ? {
                    status: "error",
                    applied: 0,
                    rejected: [],
                    reason:
                      "operations must be a JSON array of A2UI operation objects; nothing was rendered",
                  }
                : {
                    status: "rendered",
                    applied: state.applied,
                    rejected: state.rejected,
                  },
            ),
          } as BaseEvent);
        }
        flushFinish();
      }
      subscriber.complete();
    };

    let failed = false;
    const subscription = source.subscribe({
      next: (item) => {
        if (failed) return;
        try {
          handleEvent(item);
        } catch (error) {
          // Anything unexpected must reach the consumer as an error instead of
          // escaping this callback, where RxJS would rethrow it asynchronously
          // as an uncaught exception.
          failed = true;
          subscriber.error(error);
        }
      },
      error: (error) => {
        flushFinish();
        subscriber.error(error);
      },
      complete: () => {
        if (failed) return;
        try {
          completeRun();
        } catch (error) {
          failed = true;
          subscriber.error(error);
        }
      },
    });
    return () => subscription.unsubscribe();
  });
}
