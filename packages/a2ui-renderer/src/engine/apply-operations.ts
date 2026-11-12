import { A2uiMessageSchema } from "@a2ui/web_core/v0_9";
import type {
  A2uiMessage,
  ComponentApi,
  MessageProcessor,
  SurfaceModel,
} from "@a2ui/web_core/v0_9";
import type { A2UINativeOperations } from "./native-operations";

export type { A2UINativeOperations } from "./native-operations";

/**
 * A message of another protocol version than v0.9, such as A2UI 1.0, kept as
 * it arrived for web_core to validate. See `normalizeA2UIOperations`.
 */
export type A2UINativeMessage = Record<string, unknown> & { version: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const OPERATION_KEYS = [
  "createSurface",
  "updateComponents",
  "updateDataModel",
  "deleteSurface",
] as const;

/** Whether an operation names a protocol version other than v0.9. */
function isNativeOperation(
  operation: Record<string, unknown>,
): operation is A2UINativeMessage {
  return typeof operation.version === "string" && operation.version !== "v0.9";
}

function surfaceIdOf(message: A2uiMessage | A2UINativeMessage) {
  for (const key of OPERATION_KEYS) {
    const body = (message as Record<string, unknown>)[key];
    if (isRecord(body) && typeof body.surfaceId === "string") {
      return body.surfaceId;
    }
  }
  return undefined;
}

/**
 * Keeps the operations that are valid A2UI v0.9 messages; an operation without
 * a `version` is read as v0.9, and keys outside the message (such as a
 * top-level `surfaceId` some models add) are ignored. Every `createSurface` is
 * pinned to `catalogId`: a renderer runs one catalog and web_core rejects a
 * surface that names an unknown one, so a stray id from the model would
 * otherwise blank the surface. Anything else, such as a v0.8 message, is
 * dropped with a warning.
 *
 * With `options.native`, a message that names another version, such as
 * A2UI 1.0, is kept exactly as it arrived, for web_core to validate against
 * that version's schema and catalogs.
 *
 * @param operations - Operations as they arrived.
 * @param catalogId - The id of the v0.9 catalog the renderer runs.
 * @param options.native - Keep messages of other protocol versions.
 */
export function normalizeA2UIOperations(
  operations: readonly unknown[],
  catalogId: string,
  options: { native?: boolean } = {},
): (A2uiMessage | A2UINativeMessage)[] {
  return operations.flatMap((operation) => {
    const record = isRecord(operation) ? operation : {};
    if (options.native && isNativeOperation(record)) return [record];
    const key = OPERATION_KEYS.find((candidate) => isRecord(record[candidate]));
    const message: Record<string, unknown> = {
      version: record.version ?? "v0.9",
    };
    if (key === "createSurface" && isRecord(record.createSurface)) {
      message.createSurface = { ...record.createSurface, catalogId };
    } else if (key) {
      message[key] = record[key];
    }
    const parsed = A2uiMessageSchema.safeParse(message);
    if (parsed.success) return [parsed.data];
    console.warn(
      "[A2UI] Dropped an operation that is not an A2UI v0.9 message:",
      operation,
      parsed.error.issues,
    );
    return [];
  });
}

/** Options for applying operations to a processor. */
export interface A2UIApplyOptions {
  /**
   * Native A2UI 1.0 support. Without it, only v0.9 messages are applied and
   * the rest are dropped with a warning.
   */
  native?: A2UINativeOperations;
  /**
   * The previous snapshot as it arrived. A repeated native `createSurface`
   * replays only the inline data model that changed since then.
   */
  previousOperations?: readonly unknown[];
}

/**
 * Applies operations in order and returns the surfaces they address that
 * still exist. A `createSurface` for an existing surface is skipped (web_core
 * throws on a duplicate, and content snapshots repeat the whole list), and a
 * surface addressed before it is created gets one with `catalogId` and `theme`.
 *
 * With `options.native`, native (A2UI 1.0) messages are applied as they
 * arrived; the whole batch is checked first, so a message that would change a
 * surface's protocol version throws before anything is applied, and a
 * repeated native `createSurface` is replayed as updates of its inline
 * components and changed data model.
 *
 * @param processor - The web_core processor to apply to.
 * @param operations - Operations as they arrived; see {@link normalizeA2UIOperations}.
 * @param catalogId - The id of the v0.9 catalog the processor runs.
 * @param theme - The theme for surfaces created on demand.
 * @param options - Native 1.0 support; see {@link A2UIApplyOptions}.
 */
export function applyA2UIOperations<T extends ComponentApi>(
  processor: MessageProcessor<T>,
  operations: readonly unknown[],
  catalogId: string,
  theme?: Record<string, unknown>,
  options: A2UIApplyOptions = {},
) {
  const surfaceIds = new Set<string>();
  const exists = (surfaceId: string) =>
    processor.model.getSurface(surfaceId) !== undefined;
  const { native, previousOperations = [] } = options;

  const messages = normalizeA2UIOperations(operations, catalogId, {
    native: native !== undefined,
  });
  native?.validate(
    processor as unknown as MessageProcessor<ComponentApi>,
    messages as Record<string, unknown>[],
  );
  for (const message of messages) {
    const surfaceId = surfaceIdOf(message);
    if (surfaceId === undefined) {
      // Only a native message can lack one; web_core reports it.
      processor.processMessages([message as never]);
      continue;
    }
    surfaceIds.add(surfaceId);
    const nativeMessage = isNativeOperation(message as Record<string, unknown>);
    if ("createSurface" in message) {
      if (!exists(surfaceId)) processor.processMessages([message as never]);
      else if (native && nativeMessage) {
        const updates = native.replayCreate(message, previousOperations);
        if (updates.length > 0) processor.processMessages(updates as never);
      }
      continue;
    }
    if ("deleteSurface" in message) {
      if (exists(surfaceId)) processor.processMessages([message as never]);
      continue;
    }
    if (nativeMessage) {
      processor.processMessages([message as never]);
      continue;
    }
    if (!exists(surfaceId)) {
      processor.processMessages([
        {
          version: "v0.9",
          createSurface: { surfaceId, catalogId, theme: theme ?? {} },
        },
      ]);
    }
    processor.processMessages([message as A2uiMessage]);
  }

  return [...surfaceIds]
    .map((surfaceId) => processor.model.getSurface(surfaceId))
    .filter((surface): surface is SurfaceModel<T> => surface !== undefined);
}

/** Whether an operation is a native (A2UI 1.0) `createSurface`. */
function nativeCreateSurfaceId(operation: unknown) {
  if (!isRecord(operation) || operation.version !== "1.0") return undefined;
  const create = operation.createSurface;
  return isRecord(create) && typeof create.surfaceId === "string"
    ? create.surfaceId
    : undefined;
}

/**
 * Applies successive snapshots of an operation list to one processor.
 *
 * A2UI content arrives as snapshots that repeat every earlier operation, so
 * re-applying the whole list would replay history. The applier remembers what
 * it applied: an identical snapshot does nothing, a snapshot that extends the
 * applied history applies only the new operations, and any other snapshot
 * starts over from an empty model. A batch that throws also starts over, so
 * a partially applied batch cannot leave stale surfaces behind.
 *
 * With native A2UI 1.0 support, a snapshot whose history changed only in
 * native `createSurface` operations of surfaces that still exist (a native
 * create carries the current components and data model inline) is replayed
 * from the first change without starting over, so the surfaces keep their
 * local edits; and a batch the native checks reject throws before anything,
 * including the start over, changes the model.
 *
 * @example
 * ```ts
 * const processor = new MessageProcessor([catalog], onAction);
 * const applier = new A2UIOperationApplier(processor, catalog.id);
 * const surfaces = applier.apply(operations); // same array until a change
 * ```
 */
export class A2UIOperationApplier<T extends ComponentApi> {
  readonly #processor: MessageProcessor<T>;
  readonly #catalogId: string;
  readonly #theme: Record<string, unknown> | undefined;
  readonly #native: A2UINativeOperations | undefined;
  #lastHash = "";
  #appliedCount = 0;
  #surfaces: readonly SurfaceModel<T>[] = [];

  /**
   * @param processor - The web_core processor to apply to.
   * @param catalogId - The id of the v0.9 catalog the processor runs.
   * @param theme - The theme for surfaces created on demand.
   * @param options.native - Native A2UI 1.0 support; see `A2UIApplyOptions`.
   */
  constructor(
    processor: MessageProcessor<T>,
    catalogId: string,
    theme?: Record<string, unknown>,
    options: { native?: A2UINativeOperations } = {},
  ) {
    this.#processor = processor;
    this.#catalogId = catalogId;
    this.#theme = theme;
    this.#native = options.native;
  }

  /**
   * Applies an operation snapshot and returns every surface in the model.
   * Returns the same array when nothing changed. Throws what the processor
   * throws, after starting over.
   *
   * @param operations - The full operation list of the latest snapshot.
   */
  apply(operations: readonly unknown[]) {
    if (operations.length === 0) {
      this.reset();
      return this.#surfaces;
    }

    const hash = JSON.stringify(operations);
    if (hash === this.#lastHash) return this.#surfaces;

    // The previous snapshot as it arrived: web_core may since have changed
    // the data objects it was given, as bound controls edit the data model.
    const previous: unknown[] = this.#lastHash
      ? JSON.parse(this.#lastHash)
      : [];
    let start = this.#appliedCount;

    // Keep the model only when the applied history is unchanged, or changed
    // only in native creates that can be replayed.
    const prefixHash = JSON.stringify(operations.slice(0, this.#appliedCount));
    if (prefixHash !== this.#lastHash) {
      const replayFrom = this.#replayStart(operations, previous);
      if (replayFrom === undefined) {
        // Check before starting over, so a rejected batch keeps the cards.
        this.#native?.validate(
          this.#processor as unknown as MessageProcessor<ComponentApi>,
          normalizeA2UIOperations(operations, this.#catalogId, {
            native: true,
          }) as Record<string, unknown>[],
        );
        this.reset();
        start = 0;
      } else {
        start = replayFrom;
      }
    }

    const batch = operations.slice(start);
    const options = { native: this.#native, previousOperations: previous };
    // A rejected native batch has changed nothing, so it keeps the model.
    this.#native?.validate(
      this.#processor as unknown as MessageProcessor<ComponentApi>,
      normalizeA2UIOperations(batch, this.#catalogId, {
        native: true,
      }) as Record<string, unknown>[],
    );
    try {
      applyA2UIOperations(
        this.#processor,
        batch,
        this.#catalogId,
        this.#theme,
        options,
      );
    } catch (error) {
      this.reset();
      throw error;
    }
    this.#lastHash = hash;
    this.#appliedCount = operations.length;
    this.#surfaces = [...this.#processor.model.surfacesMap.values()];
    return this.#surfaces;
  }

  /**
   * The index to replay a changed snapshot from, when every operation of the
   * applied history is unchanged or a native create of a surface that still
   * exists, replaced by a native create of the same surface; otherwise
   * undefined. Only with native support.
   */
  #replayStart(operations: readonly unknown[], previous: readonly unknown[]) {
    if (!this.#native || operations.length < previous.length) return undefined;
    let first: number | undefined;
    for (let i = 0; i < previous.length; i++) {
      if (JSON.stringify(operations[i]) === JSON.stringify(previous[i])) {
        continue;
      }
      const surfaceId = nativeCreateSurfaceId(previous[i]);
      if (
        surfaceId === undefined ||
        nativeCreateSurfaceId(operations[i]) !== surfaceId ||
        !this.#processor.model.getSurface(surfaceId)
      ) {
        return undefined;
      }
      first ??= i;
    }
    return first;
  }

  /** Deletes every surface and forgets the applied history. */
  reset() {
    for (const [surfaceId, surface] of [...this.#processor.model.surfacesMap]) {
      const version =
        String(surface.protocolVersion ?? "").replace(/^v/, "") === "1.0"
          ? "1.0"
          : "v0.9";
      this.#processor.processMessages([
        { version, deleteSurface: { surfaceId } } as A2uiMessage,
      ]);
    }
    this.#lastHash = "";
    this.#appliedCount = 0;
    if (this.#surfaces.length > 0) this.#surfaces = [];
  }
}
