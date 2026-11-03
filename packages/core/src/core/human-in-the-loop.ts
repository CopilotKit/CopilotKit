import type { HumanInTheLoopRenderProps } from "../chat/renderer-types";
import { ToolCallStatus } from "../types";
import type { FrontendTool, FrontendToolHandlerContext } from "../types";

/**
 * @internal The error message a parked human-in-the-loop call rejects with
 * when its run is aborted (or the core is disposed) before the user responds.
 */
export const ɵHITL_ABORTED_MESSAGE = "Human-in-the-loop interaction aborted";

/** Registration name of a catch-all tool: handles any otherwise-unhandled call. */
const WILDCARD_TOOL_NAME = "*";

type ParkedCall = {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  detachAbort?: () => void;
};

/**
 * @internal Parks human-in-the-loop tool calls until the UI responds. Calls
 * are keyed by tool call id, so parallel calls of one tool (or of one
 * catch-all registration) stay independent. Use the instance on
 * `CopilotKitCore.ɵhumanInTheLoop`. Application authors must not depend on
 * this API.
 */
export class ɵHumanInTheLoopRegistry {
  readonly #parked = new Map<string, ParkedCall>();

  /** A frontend-tool handler that parks each call until {@link respond}. */
  createHandler<
    T extends Record<string, unknown> = Record<string, unknown>,
  >(): (args: T, context: FrontendToolHandlerContext) => Promise<unknown> {
    return (_args, context) => this.wait(context.toolCall.id, context.signal);
  }

  /**
   * Park `toolCallId` until {@link respond}. Rejects with
   * {@link ɵHITL_ABORTED_MESSAGE} when `signal` aborts (or already has), so
   * core records an explicit error result instead of an empty success.
   */
  wait(toolCallId: string, signal?: AbortSignal): Promise<unknown> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error(ɵHITL_ABORTED_MESSAGE));
        return;
      }
      // A second wait for the same call replaces the first; settle the first
      // so its run does not hang.
      this.#take(toolCallId)?.reject(new Error(ɵHITL_ABORTED_MESSAGE));

      const parked: ParkedCall = { resolve, reject };
      this.#parked.set(toolCallId, parked);
      if (!signal) return;
      const onAbort = () => {
        if (this.#parked.get(toolCallId) !== parked) return;
        this.#parked.delete(toolCallId);
        reject(new Error(ɵHITL_ABORTED_MESSAGE));
      };
      signal.addEventListener("abort", onAbort, { once: true });
      parked.detachAbort = () => signal.removeEventListener("abort", onAbort);
    });
  }

  /**
   * Settle the parked call with the user's answer. Returns `false` when no
   * call with this id is waiting (already answered, aborted, or unknown).
   */
  respond(toolCallId: string, result: unknown): boolean {
    const parked = this.#take(toolCallId);
    if (!parked) return false;
    parked.resolve(result);
    return true;
  }

  /** True while a call with this id waits for {@link respond}. */
  isPending(toolCallId: string): boolean {
    return this.#parked.has(toolCallId);
  }

  /** Reject every parked call with {@link ɵHITL_ABORTED_MESSAGE}. */
  dispose(): void {
    for (const toolCallId of [...this.#parked.keys()]) {
      this.#take(toolCallId)?.reject(new Error(ɵHITL_ABORTED_MESSAGE));
    }
  }

  #take(toolCallId: string): ParkedCall | undefined {
    const parked = this.#parked.get(toolCallId);
    if (!parked) return undefined;
    parked.detachAbort?.();
    this.#parked.delete(toolCallId);
    return parked;
  }
}

/**
 * @internal Build the frontend tool core runs for a human-in-the-loop
 * registration: the registration's fields, `type: "human-in-the-loop"`, and
 * a handler that parks each call in `registry`. Pass a getter when the
 * registry's core does not exist yet; it is read on each call.
 */
export function ɵbuildHumanInTheLoopTool<
  T extends Record<string, unknown> = Record<string, unknown>,
  TConfig extends Omit<FrontendTool<T>, "handler" | "type"> = Omit<
    FrontendTool<T>,
    "handler" | "type"
  >,
>(
  config: TConfig,
  registry: ɵHumanInTheLoopRegistry | (() => ɵHumanInTheLoopRegistry),
): TConfig &
  FrontendTool<T> & {
    handler: NonNullable<FrontendTool<T>["handler"]>;
  } {
  return {
    ...config,
    type: "human-in-the-loop",
    handler: (_args, context) =>
      (typeof registry === "function" ? registry() : registry).wait(
        context.toolCall.id,
        context.signal,
      ),
  };
}

/** The tool-call fields a human-in-the-loop render starts from. */
type HumanInTheLoopCallProps<T> = {
  name: string;
  toolCallId: string;
  status: ToolCallStatus;
  args: Partial<T> | T;
  result: string | undefined;
};

/**
 * @internal Turn tool-call render props into human-in-the-loop render props.
 * `name`, `description` and `agentId` come from the registration, except that
 * a catch-all (`"*"`) keeps the name of the tool that was called. `respond`
 * is live only while the call executes, the one phase with a parked call.
 */
export function ɵhitlRenderProps<T, TProps extends HumanInTheLoopCallProps<T>>(
  props: TProps,
  tool: { name: string; description?: string; agentId?: string },
  registry: ɵHumanInTheLoopRegistry,
): Omit<TProps, "name" | "respond"> & HumanInTheLoopRenderProps<T> {
  return {
    ...props,
    name: tool.name === WILDCARD_TOOL_NAME ? props.name : tool.name,
    description: tool.description || "",
    agentId: tool.agentId,
    respond:
      props.status === ToolCallStatus.Executing
        ? async (result: unknown) => {
            registry.respond(props.toolCallId, result);
          }
        : undefined,
  } as Omit<TProps, "name" | "respond"> & HumanInTheLoopRenderProps<T>;
}
