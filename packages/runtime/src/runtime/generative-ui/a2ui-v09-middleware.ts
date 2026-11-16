import { Middleware } from "@ag-ui/client";
import type { AbstractAgent, BaseEvent, RunAgentInput } from "@ag-ui/client";
import { concatMap } from "rxjs";
import type { Observable } from "rxjs";
import type { A2UIVersion, CopilotKitRuntimeOptions } from "../core/runtime";
import { downgradeA2UIV09Action } from "./a2ui-v09-actions";
import { buildA2UIV09CatalogContext } from "./a2ui-v09-catalog";
import { createA2UIV09ActivityUpgrader } from "./a2ui-v09-operations";

/**
 * The A2UI version of one agent, from the runtime's `generativeUI` option.
 * Without `a2uiVersion`, and for an agent that is not in an `a2uiVersion`
 * record, the version is `"1.0"`.
 *
 * @param generativeUI - The runtime's `generativeUI` option.
 * @param agentId - The id of the agent.
 * @returns `"0.9"` or `"1.0"`.
 */
export function resolveA2UIVersion(
  generativeUI: CopilotKitRuntimeOptions["generativeUI"],
  agentId: string,
): A2UIVersion {
  const option =
    typeof generativeUI === "object" ? generativeUI.a2uiVersion : undefined;
  const version =
    typeof option === "object" && option !== null ? option[agentId] : option;
  return version === "0.9" ? "0.9" : "1.0";
}

/**
 * The input that the agent side of a run gets:
 * - A click on a surface that was converted from v0.9 becomes the v0.9
 *   action (`forwardedProps.a2uiAction`), see {@link downgradeA2UIV09Action}.
 *   The input of a middleware has no activity messages (`AbstractAgent`
 *   removes them), so in practice `agentVersion` decides: every click of a
 *   run of a v0.9 agent becomes a v0.9 action.
 * - For a v0.9 agent, the v0.9 component schema of the client's catalog is
 *   added to the context. An entry with the same description is replaced.
 *
 * It never mutates `input`.
 */
export function prepareA2UIV09AgentInput(
  input: RunAgentInput,
  agentVersion: A2UIVersion,
): RunAgentInput {
  const agentInput = downgradeA2UIV09Action(input, { agentVersion });
  if (agentVersion !== "0.9") return agentInput;
  const catalog = buildA2UIV09CatalogContext(agentInput);
  if (!catalog) return agentInput;
  const descriptions = new Set(catalog.context.map((e) => e.description));
  return {
    ...agentInput,
    context: [
      ...(agentInput.context ?? []).filter(
        (entry) => !descriptions.has(entry.description),
      ),
      ...catalog.context,
    ],
  };
}

/**
 * Connects agents that speak A2UI v0.9 to the A2UI 1.0 client.
 *
 * - Input: {@link prepareA2UIV09AgentInput}. Only the agent side gets the
 *   changed input. The runtime stores the input of the client, so the
 *   thread keeps the click message.
 * - Output: every `a2ui-surface` activity event becomes a
 *   `generative-ui-surface` event, see `createA2UIV09ActivityUpgrader`.
 *   The version of each operation decides, so v0.9 surfaces convert also
 *   for a `"1.0"` agent (for example, from a tool result), and native 1.0
 *   operations on this path (for example, from ADK) reach the client as 1.0
 *   surfaces too.
 *
 * The first middleware given to `agent.use` is the outermost: it sees the
 * input first and the events last. Use this middleware before
 * `A2UIMiddleware`, so that `A2UIMiddleware` gets the v0.9 input and this
 * middleware converts the surfaces that `A2UIMiddleware` emits.
 *
 * @example
 * ```ts
 * agent.use(
 *   new A2UIV09BridgeMiddleware({ agentVersion: "0.9" }),
 *   new A2UIMiddleware({ injectA2UITool: true }),
 * );
 * ```
 */
export class A2UIV09BridgeMiddleware extends Middleware {
  private readonly agentVersion: A2UIVersion;

  constructor(options: { agentVersion?: A2UIVersion } = {}) {
    super();
    this.agentVersion = options.agentVersion ?? "1.0";
  }

  run(input: RunAgentInput, next: AbstractAgent): Observable<BaseEvent> {
    const upgrader = createA2UIV09ActivityUpgrader();
    return this.runNext(
      prepareA2UIV09AgentInput(input, this.agentVersion),
      next,
    ).pipe(concatMap((event) => upgrader.transform(event)));
  }
}
