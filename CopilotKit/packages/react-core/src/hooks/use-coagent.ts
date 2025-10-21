/**
 * <Callout type="info">
 *   Usage of this hook assumes some additional setup in your application, for more information
 *   on that see the CoAgents <span className="text-blue-500">[getting started guide](/coagents/quickstart/langgraph)</span>.
 * </Callout>
 * <Frame className="my-12">
 *   <img
 *     src="https://cdn.copilotkit.ai/docs/copilotkit/images/coagents/SharedStateCoAgents.gif"
 *     alt="CoAgents demonstration"
 *     className="w-auto"
 *   />
 * </Frame>
 *
 * This hook is used to integrate an agent into your application. With its use, you can
 * render and update the state of an agent, allowing for a dynamic and interactive experience.
 * We call these shared state experiences agentic copilots, or CoAgents for short.
 *
 * ## Usage
 *
 * ### Simple Usage
 *
 * ```tsx
 * import { useCoAgent } from "@copilotkit/react-core";
 *
 * type AgentState = {
 *   count: number;
 * }
 *
 * const agent = useCoAgent<AgentState>({
 *   name: "my-agent",
 *   initialState: {
 *     count: 0,
 *   },
 * });
 *
 * ```
 *
 * `useCoAgent` returns an object with the following properties:
 *
 * ```tsx
 * const {
 *   name,     // The name of the agent currently being used.
 *   nodeName, // The name of the current LangGraph node.
 *   state,    // The current state of the agent.
 *   setState, // A function to update the state of the agent.
 *   running,  // A boolean indicating if the agent is currently running.
 *   start,    // A function to start the agent.
 *   stop,     // A function to stop the agent.
 *   run,      // A function to re-run the agent. Takes a HintFunction to inform the agent why it is being re-run.
 * } = agent;
 * ```
 *
 * Finally we can leverage these properties to create reactive experiences with the agent!
 *
 * ```tsx
 * const { state, setState } = useCoAgent<AgentState>({
 *   name: "my-agent",
 *   initialState: {
 *     count: 0,
 *   },
 * });
 *
 * return (
 *   <div>
 *     <p>Count: {state.count}</p>
 *     <button onClick={() => setState({ count: state.count + 1 })}>Increment</button>
 *   </div>
 * );
 * ```
 *
 * This reactivity is bidirectional, meaning that changes to the state from the agent will be reflected in the UI and vice versa.
 *
 * ## Parameters
 * <PropertyReference name="options" type="UseCoagentOptions<T>" required>
 *   The options to use when creating the coagent.
 *   <PropertyReference name="name" type="string" required>
 *     The name of the agent to use.
 *   </PropertyReference>
 *   <PropertyReference name="initialState" type="T | any">
 *     The initial state of the agent.
 *   </PropertyReference>
 *   <PropertyReference name="state" type="T | any">
 *     State to manage externally if you are using this hook with external state management.
 *   </PropertyReference>
 *   <PropertyReference name="setState" type="(newState: T | ((prevState: T | undefined) => T)) => void">
 *     A function to update the state of the agent if you are using this hook with external state management.
 *   </PropertyReference>
 * </PropertyReference>
 */

import { useCallback, useEffect, useMemo } from "react";
import { Message, parseJson } from "@copilotkit/shared";
import { useAgent } from "@copilotkitnext/react";
import { type AgentSubscriber } from "@ag-ui/client";

interface UseCoagentOptionsBase {
  /**
   * The name of the agent being used.
   */
  name: string;
  /**
   * @deprecated - use "config.configurable"
   * Config to pass to a LangGraph Agent
   */
  configurable?: Record<string, any>;
  /**
   * Config to pass to a LangGraph Agent
   */
  config?: {
    configurable?: Record<string, any>;
    [key: string]: any;
  };
}

interface WithInternalStateManagementAndInitial<T> extends UseCoagentOptionsBase {
  /**
   * The initial state of the agent.
   */
  initialState: T;
}

interface WithInternalStateManagement extends UseCoagentOptionsBase {
  /**
   * Optional initialState with default type any
   */
  initialState?: any;
}

interface WithExternalStateManagement<T> extends UseCoagentOptionsBase {
  /**
   * The current state of the agent.
   */
  state: T;
  /**
   * A function to update the state of the agent.
   */
  setState: (newState: T | ((prevState: T | undefined) => T)) => void;
}

type UseCoagentOptions<T> =
  | WithInternalStateManagementAndInitial<T>
  | WithInternalStateManagement
  | WithExternalStateManagement<T>;

export interface UseCoagentReturnType<T> {
  /**
   * The name of the agent being used.
   */
  name: string;
  /**
   * The name of the current LangGraph node.
   */
  nodeName?: string;
  /**
   * The ID of the thread the agent is running in.
   */
  threadId?: string;
  /**
   * A boolean indicating if the agent is currently running.
   */
  running: boolean;
  /**
   * The current state of the agent.
   */
  state: T;
  /**
   * A function to update the state of the agent.
   */
  setState: (newState: T | ((prevState: T | undefined) => T)) => void;
  /**
   * A function to start the agent.
   */
  start: () => void;
  /**
   * A function to stop the agent.
   */
  stop: () => void;
  /**
   * A function to re-run the agent. The hint function can be used to provide a hint to the agent
   * about why it is being re-run again.
   */
  run: (...args: any[]) => Promise<any>;
}

export interface HintFunctionParams {
  /**
   * The previous state of the agent.
   */
  previousState: any;
  /**
   * The current state of the agent.
   */
  currentState: any;
}

export type HintFunction = (params: HintFunctionParams) => Message | undefined;

/**
 * This hook is used to integrate an agent into your application. With its use, you can
 * render and update the state of the agent, allowing for a dynamic and interactive experience.
 * We call these shared state experiences "agentic copilots". To get started using agentic copilots, which
 * we refer to as CoAgents, checkout the documentation at https://docs.copilotkit.ai/coagents/quickstart/langgraph.
 */
export function useCoAgent<T = any>(options: UseCoagentOptions<T>): UseCoagentReturnType<T> {
  const { agent } = useAgent({ agentId: options.name });

  useEffect(() => {
    if (!agent) return;
    let predictStateTools: {
      tool: string;
      state_key: string;
      tool_argument: string;
    }[];
    const subscriber: AgentSubscriber = {
      onCustomEvent: ({ event }) => {
        if (event.name === "PredictState") {
          predictStateTools = event.value;
        }
      },
      onToolCallArgsEvent: ({ partialToolCallArgs, toolCallName }) => {
        predictStateTools.forEach((t) => {
          if (t?.tool !== toolCallName) return;

          const emittedState =
            typeof partialToolCallArgs === "string"
              ? parseJson(partialToolCallArgs as unknown as string, partialToolCallArgs)
              : partialToolCallArgs;

          agent.setState({
            [t.state_key]: emittedState[t.state_key],
          });
        });
      },
    };
    const { unsubscribe } = agent.subscribe(subscriber);
    return () => {
      unsubscribe();
    };
  }, [Boolean(agent)]);

  const handleStateUpdate = useCallback(
    (newState: T | ((prevState: T | undefined) => T)) => {
      if (!agent) return;

      if (typeof newState === "function") {
        // @ts-ignore
        agent.setState(newState(agent.state));
      } else {
        agent.setState({ ...agent.state, ...newState });
      }
      agent.setState(newState);
    },
    [agent?.state, agent?.setState],
  );

  // Return a consistent shape whether or not the agent is available
  return useMemo<UseCoagentReturnType<T>>(() => {
    if (!agent) {
      const noop = () => {};
      const noopAsync = async () => {};
      const initialState =
        // prefer externally provided state if available
        ("state" in options && (options as any).state) ??
        // then initialState if provided
        ("initialState" in options && (options as any).initialState) ??
        ({} as T);
      return {
        name: options.name,
        nodeName: undefined,
        threadId: undefined,
        running: false,
        state: initialState as T,
        setState: noop,
        start: noop,
        stop: noop,
        run: noopAsync,
      };
    }

    return {
      name: agent?.agentId ?? options.name,
      nodeName: undefined,
      threadId: agent.threadId,
      running: agent.isRunning,
      state: agent.state,
      setState: handleStateUpdate,
      // TODO: start and run both have same thing. need to figure out
      start: agent.runAgent,
      stop: agent.abortRun,
      run: agent.runAgent,
    };
  }, [
    agent?.state,
    handleStateUpdate,
    agent?.runAgent,
    agent?.abortRun,
    agent?.runAgent,
    agent?.threadId,
    agent?.isRunning,
    agent?.agentId,
    options.name,
  ]);
}
