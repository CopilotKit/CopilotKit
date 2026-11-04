import { A2uiMessageSchema } from "@a2ui/web_core/v0_9";
import type {
  A2uiMessage,
  ComponentApi,
  MessageProcessor,
  SurfaceModel,
} from "@a2ui/web_core/v0_9";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function surfaceIdOf(message: A2uiMessage) {
  if ("createSurface" in message) return message.createSurface.surfaceId;
  if ("updateComponents" in message) return message.updateComponents.surfaceId;
  if ("updateDataModel" in message) return message.updateDataModel.surfaceId;
  return message.deleteSurface.surfaceId;
}

const OPERATION_KEYS = [
  "createSurface",
  "updateComponents",
  "updateDataModel",
  "deleteSurface",
] as const;

/**
 * Keeps the operations that are valid A2UI v0.9 messages; an operation without
 * a `version` is read as v0.9, and keys outside the message (such as a
 * top-level `surfaceId` some models add) are ignored. Every `createSurface` is
 * pinned to `catalogId`: a renderer runs one catalog and web_core rejects a
 * surface that names an unknown one, so a stray id from the model would
 * otherwise blank the surface. Anything else, such as a v0.8 message, is
 * dropped with a warning.
 *
 * @param operations - Operations as they arrived.
 * @param catalogId - The id of the catalog the renderer runs.
 */
export function normalizeA2UIOperations(
  operations: readonly unknown[],
  catalogId: string,
) {
  return operations.flatMap((operation) => {
    const record = isRecord(operation) ? operation : {};
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

/**
 * Applies operations in order and returns the surfaces they address that
 * still exist. A `createSurface` for an existing surface is skipped (web_core
 * throws on a duplicate, and content snapshots repeat the whole list), and a
 * surface addressed before it is created gets one with `catalogId` and `theme`.
 *
 * @param processor - The web_core processor to apply to.
 * @param operations - Operations as they arrived; see {@link normalizeA2UIOperations}.
 * @param catalogId - The id of the catalog the processor runs.
 * @param theme - The theme for surfaces created on demand.
 */
export function applyA2UIOperations<T extends ComponentApi>(
  processor: MessageProcessor<T>,
  operations: readonly unknown[],
  catalogId: string,
  theme?: Record<string, unknown>,
) {
  const surfaceIds = new Set<string>();
  const exists = (surfaceId: string) =>
    processor.model.getSurface(surfaceId) !== undefined;

  const messages = normalizeA2UIOperations(operations, catalogId);
  for (const message of messages) {
    const surfaceId = surfaceIdOf(message);
    surfaceIds.add(surfaceId);
    if ("createSurface" in message) {
      if (!exists(surfaceId)) processor.processMessages([message]);
      continue;
    }
    if ("deleteSurface" in message) {
      if (exists(surfaceId)) processor.processMessages([message]);
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
    processor.processMessages([message]);
  }

  return [...surfaceIds]
    .map((surfaceId) => processor.model.getSurface(surfaceId))
    .filter((surface): surface is SurfaceModel<T> => surface !== undefined);
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
  #lastHash = "";
  #appliedCount = 0;
  #surfaces: readonly SurfaceModel<T>[] = [];

  /**
   * @param processor - The web_core processor to apply to.
   * @param catalogId - The id of the catalog the processor runs.
   * @param theme - The theme for surfaces created on demand.
   */
  constructor(
    processor: MessageProcessor<T>,
    catalogId: string,
    theme?: Record<string, unknown>,
  ) {
    this.#processor = processor;
    this.#catalogId = catalogId;
    this.#theme = theme;
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

    // Keep the model only when the applied history is unchanged.
    const prefixHash = JSON.stringify(operations.slice(0, this.#appliedCount));
    if (prefixHash !== this.#lastHash) this.reset();

    try {
      applyA2UIOperations(
        this.#processor,
        operations.slice(this.#appliedCount),
        this.#catalogId,
        this.#theme,
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

  /** Deletes every surface and forgets the applied history. */
  reset() {
    const surfaceIds = [...this.#processor.model.surfacesMap.keys()];
    for (const surfaceId of surfaceIds) {
      this.#processor.processMessages([
        { version: "v0.9", deleteSurface: { surfaceId } },
      ]);
    }
    this.#lastHash = "";
    this.#appliedCount = 0;
    if (this.#surfaces.length > 0) this.#surfaces = [];
  }
}
