import type { ChildRef } from "@copilotkit/shared";
import type { Message } from "@ag-ui/client";
import {
  extractFenceOperations,
  flattenInformationalCards,
  getMarkdownOperationSurfaceId,
  prepareSurfaceOperations,
  segmentSurfaceProse,
  splitA2UIMarkdown,
} from "@copilotkit/core";
import type { A2UIMarkdownOperation, ChildIdsOf } from "@copilotkit/core";
import {
  GENERATIVE_UI_CHAT_TARGET,
  GENERATIVE_UI_ROOT_ID,
  getOperationKind,
  validateOperation,
  childIdsAtRefs,
  collectChildRefs,
  hasBoundChildRef,
} from "@copilotkit/shared";
import type {
  A2UIOperation,
  GenerativeUIFunctionManifest,
  GenerativeUIRejectedOperation,
  GenerativeUISurfaceContent,
  ValidateOperationOptions,
} from "@copilotkit/shared";
import { catalogIdsOf } from "../catalog";
import type { GenerativeUI } from "../catalog";
import { toJsonSchema } from "../json-schema";
import type { GenerativeUISurfaceManager } from "../surface-manager";

/** What renders in place of one ```a2ui fence, in order. */
export type MarkdownFenceBlock =
  | { kind: "markdown"; markdown: string }
  | { kind: "surface"; surfaceId: string };

/** The part of a generative UI that the markdown source reads. */
type MarkdownSourceUI = Pick<GenerativeUI, "id" | "manifestComponents">;

export interface BuildMarkdownSurfacesOptions {
  ui: MarkdownSourceUI;
  /** The declared functions. A `functionCall` must name one of them. */
  functions: Record<string, GenerativeUIFunctionManifest>;
  /**
   * The last message can still grow. Then an open fence in it is still
   * streaming: its last, unfinished operation is left out, and the surface
   * it creates has the status "streaming". Else an open fence is final.
   */
  running: boolean;
}

/** One surface, collected from the fences of all messages. */
interface SurfaceDraft {
  surfaceId: string;
  target: string;
  operations: A2UIMarkdownOperation[];
  /** The fence that created the surface is still streaming. */
  streaming: boolean;
}

/** The surface content, or one surface of it after the prose lift. */
type SurfacePart =
  | { kind: "markdown"; markdown: string }
  | {
      kind: "surface";
      surfaceId: string;
      operations: A2UIMarkdownOperation[];
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

/** The key of one fence of one message. */
export function fenceKey(messageId: string, fenceIndex: number) {
  return `${messageId}:${fenceIndex}`;
}

/** One `callRendererFunction` line of a fence, in the order of the fences. */
export interface MarkdownFunctionCall {
  messageId: string;
  fenceIndex: number;
  /** The operation as the model wrote it. It is not validated yet. */
  operation: A2UIMarkdownOperation;
}

/**
 * The operations of a fence body. While the fence streams, the last object
 * can be unfinished. Of an unfinished updateComponents or createSurface, the
 * components that are complete render at once (a createSurface also keeps
 * its data model when all of it arrived). Any other unfinished object is
 * left out, because a part of a data model value can still change. A final
 * fence keeps what can be saved from an unfinished object.
 */
function fenceOperations(text: string, isStreaming: boolean) {
  const parsed = extractFenceOperations(text);
  if (!isStreaming || parsed.partialObject === null) return parsed.operations;
  // The unfinished object is always the end of the text.
  const complete = extractFenceOperations(
    text.slice(0, text.length - parsed.partialObject.length),
  ).operations;
  const partial =
    parsed.operations.length > complete.length
      ? parsed.operations[parsed.operations.length - 1]
      : undefined;
  const canRenderPartial =
    partial !== undefined &&
    (isRecord(partial.updateComponents) || isRecord(partial.createSurface));
  return canRenderPartial ? [...complete, partial] : complete;
}

/**
 * An inline createSurface becomes a createSurface with only its surfaceId
 * and catalog, then an updateDataModel for its data model, then an
 * updateComponents for its components. The prose lift and the split per
 * component read only updateComponents, so they then work for an inline
 * surface too. A createSurface with a data model or components of a wrong
 * shape does not change, so that validation rejects it with the reason.
 */
function expandInlineCreate(operations: A2UIMarkdownOperation[]) {
  return operations.flatMap((op) => {
    const create = op.createSurface;
    if (!isRecord(create)) return [op];
    const { dataModel, components, ...rest } = create;
    const hasData = isRecord(dataModel);
    const hasComponents = Array.isArray(components) && components.length > 0;
    const isWellFormed =
      (dataModel === undefined || hasData) &&
      (components === undefined || hasComponents);
    if (!isWellFormed || (!hasData && !hasComponents)) return [op];
    const { surfaceId } = create;
    const expanded: A2UIMarkdownOperation[] = [{ ...op, createSurface: rest }];
    if (hasData) {
      expanded.push({
        version: op.version,
        updateDataModel: { surfaceId, path: "/", value: dataModel },
      });
    }
    if (hasComponents) {
      expanded.push({
        version: op.version,
        updateComponents: { surfaceId, components },
      });
    }
    return expanded;
  });
}

/**
 * Each updateComponents becomes one operation per component, in order. The
 * complete components of a streaming line then give the same first
 * operations as the finished line, so the operation list only grows and the
 * manager never has to start the surface again.
 */
function splitComponentUpdates(operations: A2UIMarkdownOperation[]) {
  return operations.flatMap((op) => {
    const update = op.updateComponents;
    if (!isRecord(update) || !Array.isArray(update.components)) return [op];
    if (update.components.length <= 1) return [op];
    return update.components.map((component) => ({
      ...op,
      updateComponents: { ...update, components: [component] },
    }));
  });
}

/** createSurface first, the other operations after it in their order. */
function createSurfaceFirst(operations: A2UIMarkdownOperation[]) {
  const creates = operations.filter((op) => isRecord(op.createSurface));
  const others = operations.filter((op) => !isRecord(op.createSurface));
  return [...creates, ...others];
}

/** True when the component of `name` has the prop `prop`. */
function hasProp(ui: MarkdownSourceUI, name: string, prop: string) {
  const properties = ui.manifestComponents[name]?.props.properties;
  return isRecord(properties) && Object.hasOwn(properties, prop);
}

const childRefCache = new WeakMap<object, readonly ChildRef[]>();

/** The ids in a slot value: an id, a list of ids, or a template. */
function slotIds(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter(isString);
  return isRecord(value) && isString(value.componentId)
    ? [value.componentId]
    : [];
}

/**
 * A reader of the ids a component renders beyond `child` and `children`:
 * its declared slots (the `trigger` and `content` of a Modal) and its typed
 * child references (the `child` of each entry of `tabs`), from its catalog
 * entry. The prose lift follows these ids like `children`, so a panel is
 * never cut off from its Tabs. A reference that is bound to the data
 * model is "unknown": its ids exist only at render time.
 */
function childIdsReader(ui: MarkdownSourceUI): ChildIdsOf {
  return (component) => {
    const name = component.component;
    // An own property only: "constructor" is not a component.
    const entry =
      typeof name === "string" && Object.hasOwn(ui.manifestComponents, name)
        ? ui.manifestComponents[name]
        : undefined;
    if (!entry) return [];
    const ids: string[] = [];
    for (const slot of Object.keys(entry.slots ?? {})) {
      if (slot !== "child" && slot !== "children") {
        ids.push(...slotIds(component[slot]));
      }
    }
    let refs = childRefCache.get(entry.props);
    if (!refs) {
      refs = collectChildRefs(entry.props);
      childRefCache.set(entry.props, refs);
    }
    if (refs.length === 0) return ids;
    if (hasBoundChildRef(component, refs)) return "unknown";
    return [...ids, ...childIdsAtRefs(component, refs)];
  };
}

/** Every component of the operations by id, last definition wins. */
function collectComponents(operations: A2UIMarkdownOperation[]) {
  const byId = new Map<string, Record<string, unknown>>();
  for (const op of operations) {
    const update = op.updateComponents;
    const list = isRecord(update) ? update.components : undefined;
    if (!Array.isArray(list)) continue;
    for (const component of list) {
      if (isRecord(component) && isString(component.id)) {
        byId.set(component.id, component);
      }
    }
  }
  return [...byId.values()];
}

/**
 * The data model must not be shared between two surfaces. A data model
 * keeps the object it gets, so an input in one surface would change the
 * data of the other one.
 */
function cloneData(value: unknown) {
  return value === undefined ? undefined : structuredClone(value);
}

/** The operation sent to `surfaceId`, with a copy of its data model value. */
function readdress(op: A2UIMarkdownOperation, surfaceId: string) {
  const kind = getOperationKind(op);
  const payload = kind ? op[kind] : undefined;
  if (!kind || !isRecord(payload)) return op;
  const next: Record<string, unknown> = { ...payload, surfaceId };
  if (kind === "updateDataModel" && "value" in payload) {
    next.value = cloneData(payload.value);
  }
  return { ...op, [kind]: next };
}

/**
 * The operations of one sub-surface. Each updateComponents keeps only the
 * components of the sub-surface, with its own root. The other operations
 * are sent to the sub-surface. The order stays the same, so a new operation
 * of the fence only adds operations at the end.
 */
function subSurfaceOperations(
  operations: A2UIMarkdownOperation[],
  components: Record<string, unknown>[],
  surfaceId: string,
) {
  const root = components.find((c) => c.id === GENERATIVE_UI_ROOT_ID);
  const ids = new Set(components.map((c) => c.id));
  const out: A2UIMarkdownOperation[] = [];
  for (const op of operations) {
    const update = op.updateComponents;
    if (!isRecord(update) || !Array.isArray(update.components)) {
      out.push(readdress(op, surfaceId));
      continue;
    }
    const kept = update.components
      .filter((c) => isRecord(c) && ids.has(c.id))
      .map((c) => (isRecord(c) && c.id === GENERATIVE_UI_ROOT_ID ? root : c));
    if (kept.length === 0) continue;
    out.push({
      ...op,
      updateComponents: { ...update, surfaceId, components: kept },
    });
  }
  return out;
}

/**
 * Prose lift. Text components in the main stack of the surface (titles,
 * paragraphs, text lists and the dividers between them) become chat
 * markdown. The surface splits around them: the first surface keeps
 * `surfaceId`, the next ones are `<surfaceId>#1`, `<surfaceId>#2`, and so
 * on. A surface with no prose comes back as one part with the same
 * operations.
 */
function liftProse(
  operations: A2UIMarkdownOperation[],
  surfaceId: string,
  childIds: ChildIdsOf,
) {
  const components = collectComponents(operations);
  const segments = segmentSurfaceProse(components, { childIds });
  const [first] = segments;
  const isUnchanged =
    segments.length === 1 &&
    first?.kind === "surface" &&
    first.components === components;
  if (isUnchanged) {
    const whole: SurfacePart[] = [{ kind: "surface", surfaceId, operations }];
    return whole;
  }
  let surfaceIndex = 0;
  return segments.map((segment): SurfacePart => {
    if (segment.kind === "markdown") return segment;
    const id = surfaceIndex === 0 ? surfaceId : `${surfaceId}#${surfaceIndex}`;
    surfaceIndex++;
    return {
      kind: "surface",
      surfaceId: id,
      operations: subSurfaceOperations(operations, segment.components, id),
    };
  });
}

/** `validateOperation`, with the operation typed when it is valid. */
function checkOperation(
  op: A2UIMarkdownOperation,
  options: ValidateOperationOptions,
) {
  const validation = validateOperation(op, options);
  if (!validation.ok) return validation;
  // validateOperation checked the shape of `op`.
  return { ok: true as const, operation: op as A2UIOperation };
}

/**
 * The content of one surface. Each operation is validated against the
 * manifest. A valid operation goes in `operations`. A rejected one goes in
 * `rejected`, with its position and the reason.
 */
function surfaceContent(
  surfaceId: string,
  draft: SurfaceDraft,
  operations: A2UIMarkdownOperation[],
  options: BuildMarkdownSurfacesOptions,
) {
  const { ui, functions } = options;
  const knownSurfaces = new Set<string>();
  const manifest = {
    catalogId: ui.id,
    catalogIds: catalogIdsOf(ui),
    components: ui.manifestComponents,
  };
  const valid: A2UIOperation[] = [];
  const rejected: GenerativeUIRejectedOperation[] = [];
  operations.forEach((op, index) => {
    const result = checkOperation(op, { manifest, knownSurfaces, functions });
    if (!result.ok) {
      rejected.push({ index, reason: result.reason });
      return;
    }
    valid.push(result.operation);
    const kind = getOperationKind(result.operation);
    if (kind === "createSurface") knownSurfaces.add(surfaceId);
    if (kind === "deleteSurface") knownSurfaces.delete(surfaceId);
  });
  const create = valid.find(
    (op): op is Extract<A2UIOperation, { createSurface: unknown }> =>
      "createSurface" in op,
  );
  const content: GenerativeUISurfaceContent = {
    surfaceId,
    target: draft.target,
    catalogId: create?.createSurface.catalogId ?? ui.id,
    operations: valid,
    status: draft.streaming ? "streaming" : "ready",
    rejected,
  };
  return content;
}

/**
 * Builds the surfaces of a thread from the ```a2ui fences of its assistant
 * messages, in message order.
 *
 * - Operations are grouped by surfaceId across all messages. An operation
 *   with no surfaceId goes to the first surface of its fence, else to
 *   `<messageId>-<fenceIndex>`.
 * - The fence that first writes a surface creates it. The `target=<id>` of
 *   that fence sets the target. With no target, the surface goes to the
 *   chat.
 * - A later fence of the same reply for the same surfaceId updates it. A
 *   later reply that reuses the id of a chat surface gets a surface of its
 *   own, `<id>@<messageId>`. A page target is updated from any reply.
 * - The status is "streaming" while the creating fence streams, else
 *   "ready".
 * - Each operation is validated with `validateOperation`. Rejected ones are
 *   left out and listed in `rejected`.
 * - Chat surfaces get the prose lift: informational cards lose their box,
 *   and prose becomes markdown that renders between sub-surfaces
 *   (`<surfaceId>#<n>`). An inline createSurface is split into its
 *   createSurface, updateDataModel and updateComponents first.
 * - A `callRendererFunction` line is not part of a surface. It goes to
 *   `functionCalls`. A streaming line gives nothing, so a function never
 *   runs with a part of its args.
 *
 * The function is pure. Call it again on each stream update. The manager
 * applies only the new operations, so unchanged surfaces do not render
 * again.
 *
 * @param messages - The messages of one thread.
 * @param options - The generative UI, its declared functions, and whether
 *   the last message can still grow.
 * @returns `surfaces`, one content for each surface and sub-surface;
 *   `fences`, the blocks that each fence renders, by `fenceKey` (a fence
 *   that is not in `fences` renders nothing); `functionCalls`, the function
 *   calls of the fences in order; and `parts`, the surface ids of the parts
 *   of each surface, by surface id.
 *
 * @example
 * ```ts
 * const { surfaces } = buildMarkdownSurfaces(agent.messages, {
 *   ui,
 *   functions: {},
 *   running: agent.isRunning,
 * });
 * for (const content of surfaces) manager.ingest(threadId, agentId, content);
 * ```
 */
export function buildMarkdownSurfaces(
  messages: readonly Message[],
  options: BuildMarkdownSurfacesOptions,
) {
  const { ui } = options;
  const drafts = new Map<string, SurfaceDraft>();
  /** The surfaces that each fence created, in order. */
  const created = new Map<string, string[]>();
  const functionCalls: MarkdownFunctionCall[] = [];
  /** The message that owns each chat surface id, by the id the model wrote. */
  const chatOwners = new Map<string, string>();
  const lastMessage = messages[messages.length - 1];

  /**
   * A chat surface belongs to the reply that wrote it: the chat is a
   * transcript, so a later reply that reuses an id gets a surface of its
   * own (`<id>@<messageId>`) instead of changing the earlier reply. A fence
   * for a page target keeps its id, because a target is a place on the
   * page that a later reply updates on purpose.
   */
  const scopedSurfaceId = (
    requested: string,
    messageId: string,
    target: string | undefined,
  ) => {
    if (target !== undefined) return requested;
    const owner = chatOwners.get(requested);
    if (owner === undefined) {
      chatOwners.set(requested, messageId);
      return requested;
    }
    return owner === messageId ? requested : `${requested}@${messageId}`;
  };

  for (const message of messages) {
    if (message.role !== "assistant" || !isString(message.content)) continue;
    const isLastMessage = message === lastMessage;
    const segments = splitA2UIMarkdown(message.content);
    for (const segment of segments) {
      if (segment.type !== "a2ui") continue;
      const isStreaming = !segment.closed && isLastMessage && options.running;
      const operations = fenceOperations(segment.text, isStreaming);
      const key = fenceKey(message.id, segment.index);
      const fenceSurfaceId =
        operations.map(getMarkdownOperationSurfaceId).find(isString) ??
        `${message.id}-${segment.index}`;
      const prepared = prepareSurfaceOperations({
        operations,
        fallbackSurfaceId: fenceSurfaceId,
        catalogId: ui.id,
      });
      for (const operation of prepared.functionCalls) {
        functionCalls.push({
          messageId: message.id,
          fenceIndex: segment.index,
          operation,
        });
      }
      // A function call is not part of a surface. A fence with only
      // function calls makes no surface and renders nothing.
      const surfaceOperations = operations.filter(
        (op) => getOperationKind(op) !== "callRendererFunction",
      );
      for (const op of surfaceOperations) {
        const requested = getMarkdownOperationSurfaceId(op) ?? fenceSurfaceId;
        const surfaceId = scopedSurfaceId(
          requested,
          message.id,
          segment.target,
        );
        let draft = drafts.get(surfaceId);
        if (!draft) {
          draft = {
            surfaceId,
            target: segment.target ?? GENERATIVE_UI_CHAT_TARGET,
            operations: [],
            streaming: isStreaming,
          };
          drafts.set(surfaceId, draft);
          created.set(key, [...(created.get(key) ?? []), surfaceId]);
        }
        draft.operations.push(
          surfaceId === requested ? op : readdress(op, surfaceId),
        );
      }
    }
  }

  // Only a Card with a `variant` prop can become a section.
  const canFlattenCards = hasProp(ui, "Card", "variant");
  const surfaces: GenerativeUISurfaceContent[] = [];
  const partsBySurface = new Map<string, SurfacePart[]>();
  const childIds = childIdsReader(ui);
  for (const draft of drafts.values()) {
    const prepared = prepareSurfaceOperations({
      operations: draft.operations,
      fallbackSurfaceId: draft.surfaceId,
      catalogId: ui.id,
      catalogIds: catalogIdsOf(ui),
    });
    const operations = splitComponentUpdates(
      expandInlineCreate(createSurfaceFirst(prepared.operations)),
    );
    const isChat = draft.target === GENERATIVE_UI_CHAT_TARGET;
    const parts: SurfacePart[] = isChat
      ? liftProse(
          canFlattenCards
            ? flattenInformationalCards(operations, { childIds })
            : operations,
          draft.surfaceId,
          childIds,
        )
      : [{ kind: "surface", surfaceId: draft.surfaceId, operations }];
    partsBySurface.set(draft.surfaceId, parts);
    for (const part of parts) {
      if (part.kind !== "surface") continue;
      surfaces.push(
        surfaceContent(part.surfaceId, draft, part.operations, options),
      );
    }
  }

  /** The surface ids of the parts of each split surface, by surface id. */
  const parts = new Map<string, string[]>();
  for (const [surfaceId, surfaceParts] of partsBySurface) {
    const ids = surfaceParts.flatMap((part) =>
      part.kind === "surface" ? [part.surfaceId] : [],
    );
    parts.set(surfaceId, ids);
  }

  const fences = new Map<string, MarkdownFenceBlock[]>();
  for (const [key, surfaceIds] of created) {
    const blocks: MarkdownFenceBlock[] = [];
    for (const surfaceId of surfaceIds) {
      if (drafts.get(surfaceId)?.target !== GENERATIVE_UI_CHAT_TARGET) continue;
      for (const part of partsBySurface.get(surfaceId) ?? []) {
        blocks.push(
          part.kind === "markdown"
            ? part
            : { kind: "surface", surfaceId: part.surfaceId },
        );
      }
    }
    if (blocks.length > 0) fences.set(key, blocks);
  }

  return { surfaces, fences, functionCalls, parts };
}

/** The declared functions, as `validateOperation` takes them. */
function declaredFunctions(ui: GenerativeUI) {
  const functions: Record<string, GenerativeUIFunctionManifest> = {};
  for (const [name, fn] of ui.functions) {
    try {
      functions[name] = {
        ...(fn.description ? { description: fn.description } : {}),
        parameters: toJsonSchema(fn.parameters),
      };
    } catch {
      // A schema that cannot become JSON Schema still names a function.
      functions[name] = { parameters: {} };
    }
  }
  return functions;
}

/** True when `list` starts with all the items of `prefix`. */
function startsWith(list: string[], prefix: string[]) {
  return (
    list.length >= prefix.length &&
    prefix.every((item, index) => item === list[index])
  );
}

/**
 * The markdown transport source of one surface manager. It turns the
 * messages of a thread into surfaces in the manager, and keeps the blocks
 * that each fence renders.
 */
export class MarkdownSurfaceSource {
  private readonly functions: Record<string, GenerativeUIFunctionManifest>;
  /** By thread: the blocks of each fence, from the latest sync. */
  private readonly fences = new Map<
    string,
    Map<string, MarkdownFenceBlock[]>
  >();
  /** By thread, then surface: the operations last ingested, as JSON. */
  private readonly ingested = new Map<string, Map<string, string[]>>();

  constructor(
    private readonly manager: GenerativeUISurfaceManager,
    private readonly ui: GenerativeUI,
  ) {
    this.functions = declaredFunctions(ui);
  }

  /**
   * Builds the surfaces of `threadId` from `messages` and gives them to the
   * manager. A surface that an earlier sync of the thread made, and that the
   * messages no longer write, is deleted. Other threads do not change.
   *
   * @param threadId - The thread of the messages.
   * @param agentId - The agent that owns the thread.
   * @param messages - All messages of the thread.
   * @param options - `running`: the last message can still grow.
   * @returns The function calls of the fences, in order. The source does
   *   not run them.
   */
  sync(
    threadId: string,
    agentId: string | undefined,
    messages: readonly Message[],
    options: { running: boolean },
  ) {
    const result = buildMarkdownSurfaces(messages, {
      ui: this.ui,
      functions: this.functions,
      running: options.running,
    });
    this.fences.set(threadId, result.fences);
    // The parts of a split surface share one data model, so an input in one
    // part drives a binding in another.
    for (const parts of result.parts.values()) {
      this.manager.linkSurfaces(threadId, parts);
    }
    const previous = this.ingested.get(threadId) ?? new Map<string, string[]>();
    const next = new Map<string, string[]>();
    for (const content of result.surfaces) {
      const fingerprints = content.operations.map((op) => JSON.stringify(op));
      const before = previous.get(content.surfaceId);
      // The manager checks only the last operation that it applied. When an
      // earlier one changed (for example, the prose lift moved a split), an
      // empty content makes it start the surface again.
      if (before && !startsWith(fingerprints, before)) {
        this.manager.ingest(threadId, agentId, { ...content, operations: [] });
      }
      this.manager.ingest(threadId, agentId, content);
      next.set(content.surfaceId, fingerprints);
    }
    for (const surfaceId of previous.keys()) {
      if (!next.has(surfaceId)) this.manager.forgetSurface(threadId, surfaceId);
    }
    this.ingested.set(threadId, next);
    return result.functionCalls;
  }

  /**
   * The blocks that a fence renders in the chat, from the latest sync of the
   * thread. `undefined` when the fence renders nothing: it updates a surface
   * of an earlier fence, its surface is for a named target, or it has no
   * complete operation yet.
   */
  getFenceBlocks(threadId: string, messageId: string, fenceIndex: number) {
    return this.fences.get(threadId)?.get(fenceKey(messageId, fenceIndex));
  }
}

const sources = new WeakMap<
  GenerativeUISurfaceManager,
  MarkdownSurfaceSource
>();

/**
 * The markdown source of a generative UI runtime. There is one source for
 * each surface manager. The root syncs it, and the chat messages read the
 * fence blocks from it.
 */
export function getMarkdownSurfaceSource(runtime: {
  manager: GenerativeUISurfaceManager;
  ui: GenerativeUI;
}) {
  let source = sources.get(runtime.manager);
  if (!source) {
    source = new MarkdownSurfaceSource(runtime.manager, runtime.ui);
    sources.set(runtime.manager, source);
  }
  return source;
}
