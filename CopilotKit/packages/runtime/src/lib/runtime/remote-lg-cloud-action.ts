import { Client } from "@langchain/langgraph-sdk";
import { randomUUID } from "node:crypto";
import { parse as parsePartialJson } from "partial-json";
import { ActionInput } from "../../graphql/inputs/action.input";
import { LangGraphCloudAgent } from "./remote-actions";
import { CopilotRequestContextProperties } from "../integrations";
import { BaseMessage as CopilotKitBaseMessage } from "../../graphql/types/base";

type State = Record<string, any>;

type ExecutionAction = Pick<ActionInput, "name" | "description"> & { parameters: string };

interface ExecutionArgs {
  agent: LangGraphCloudAgent;
  threadId: string;
  nodeName: string;
  messages: CopilotKitBaseMessage[];
  state: State;
  properties: CopilotRequestContextProperties;
  actions: ExecutionAction[];
}

export async function execute(args: ExecutionArgs): Promise<ReadableStream<Uint8Array>> {
  return new ReadableStream({
    async start(controller) {
      try {
        await streamEvents(controller, args);
        controller.close();
      } catch (err) {}
    },
  });
}

async function streamEvents(controller: ReadableStreamDefaultController, args: ExecutionArgs) {
  const {
    threadId: agrsInitialThreadId,
    agent,
    nodeName: initialNodeName,
    state: initialState,
    messages,
    actions,
  } = args;

  let nodeName = initialNodeName;
  let state = initialState;
  const { name, assistantId: initialAssistantId } = agent;

  const client = new Client();
  let initialThreadId = agrsInitialThreadId;
  const wasInitiatedWithExistingThread = !!initialThreadId;
  if (initialThreadId && initialThreadId.startsWith("ck-")) {
    initialThreadId = initialThreadId.substring(3);
  }

  const assistants = await client.assistants.search();
  const retrievedAssistant = assistants.find((a) => a.name === name);
  const threadId = initialThreadId ?? randomUUID();
  await client.threads.create({ threadId: threadId });

  let agentState = { values: {} };
  if (wasInitiatedWithExistingThread) {
    agentState = await client.threads.getState(threadId);
  }
  const agentStateValues = agentState.values as State;
  state.messages = agentStateValues.messages;
  const mode = wasInitiatedWithExistingThread && nodeName != "__end__" ? "continue" : "start";
  state = langGraphDefaultMergeState(state, messages, actions);

  if (mode === "continue") {
    await client.threads.updateState(threadId, { values: state, asNode: nodeName });
  }

  const assistantId = initialAssistantId ?? retrievedAssistant.assistant_id;
  const graphInfo = await client.assistants.getGraph(assistantId);
  const streamInput = mode === "start" ? state : null;

  let streamingStateExtractor = new StreamingStateExtractor([]);
  let prevNodeName = null;
  let emitIntermediateStateUntilEnd = null;
  let shouldExit = null;
  let externalRunId = null;

  const streamResponse = client.runs.stream(threadId, assistantId, {
    input: streamInput,
    streamMode: ["events", "values"],
  });

  const emit = (message: string) => controller.enqueue(new TextEncoder().encode(message));

  let latestStateValues = {};

  for await (const chunk of streamResponse) {
    if (!["events", "values"].includes(chunk.event)) continue;

    if (chunk.event === "values") {
      latestStateValues = chunk.data;
      continue;
    }

    const event = chunk.data;
    const currentNodeName = event.name;
    const eventType = event.event;
    const runId = event.metadata.run_id;
    externalRunId = runId;
    const tags = event.tags;
    const metadata = event.metadata;

    shouldExit = shouldExit != null ? shouldExit : tags.includes("copilotkit:exit");
    const emitIntermediateState = metadata["copilotkit:emit-intermediate-state"];
    const forceEmitIntermediateState = tags.includes("copilotkit:force-emit-intermediate-state");
    // we only want to update the node name under certain conditions
    // since we don't need any internal node names to be sent to the frontend
    if (graphInfo["nodes"].some((node) => node.id === currentNodeName)) {
      nodeName = currentNodeName;
    }

    if (!nodeName) {
      continue;
    }

    if (forceEmitIntermediateState) {
      if (eventType === "on_chain_end") {
        state = event.data.output;
        emit(
          getStateSyncEvent({
            threadId,
            runId,
            agentName: agent.name,
            nodeName,
            state: event.data.output,
            running: true,
            active: true,
          }),
        );
      }
      continue;
    }

    if (emitIntermediateState && emitIntermediateStateUntilEnd == null) {
      emitIntermediateStateUntilEnd = nodeName;
    }

    if (emitIntermediateState && eventType === "on_chat_model_start") {
      // reset the streaming state extractor
      streamingStateExtractor = new StreamingStateExtractor(emitIntermediateState);
    }

    let updatedState = latestStateValues;

    if (emitIntermediateState && eventType === "on_chat_model_stream") {
      streamingStateExtractor.bufferToolCalls(event);
    }

    if (emitIntermediateStateUntilEnd !== null) {
      updatedState = {
        ...updatedState,
        ...streamingStateExtractor.extractState(),
      };
    }

    if (
      !emitIntermediateState &&
      currentNodeName === emitIntermediateStateUntilEnd &&
      eventType === "on_chain_end"
    ) {
      // stop emitting function call state
      emitIntermediateStateUntilEnd = null;
    }

    const exitingNode = nodeName === currentNodeName && eventType === "on_chain_end";

    if (
      JSON.stringify(updatedState) !== JSON.stringify(state) ||
      prevNodeName != nodeName ||
      exitingNode
    ) {
      state = updatedState;
      prevNodeName = nodeName;
      emit(
        getStateSyncEvent({
          threadId,
          runId,
          agentName: agent.name,
          nodeName,
          state,
          running: true,
          active: !exitingNode,
        }),
      );
    }

    emit(JSON.stringify(event) + "\n");
  }

  state = await client.threads.getState(threadId);
  const isEndNode = state.next.length === 0;
  nodeName = Object.keys(state.metadata.writes)[0];

  emit(
    getStateSyncEvent({
      threadId,
      runId: externalRunId,
      agentName: agent.name,
      nodeName: isEndNode ? "__end__" : nodeName,
      state: state.values,
      running: !shouldExit,
      active: false,
    }),
  );

  return Promise.resolve();
}

function getStateSyncEvent({
  threadId,
  runId,
  agentName,
  nodeName,
  state,
  running,
  active,
}: {
  threadId: string;
  runId: string;
  agentName: string;
  nodeName: string;
  state: State;
  running: boolean;
  active: boolean;
}): string {
  const stateWithoutMessages = Object.keys(state).reduce((acc, key) => {
    if (key !== "messages") {
      acc[key] = state[key];
    }
    return acc;
  }, {} as State);

  return (
    JSON.stringify({
      event: "on_copilotkit_state_sync",
      thread_id: threadId,
      run_id: runId,
      agent_name: agentName,
      node_name: nodeName,
      active: active,
      state: stateWithoutMessages,
      running: running,
      role: "assistant",
    }) + "\n"
  );
}

class StreamingStateExtractor {
  private emitIntermediateState: { [key: string]: any }[];
  private toolCallBuffer: { [key: string]: string };
  private currentToolCall: string | null;
  private previouslyParsableState: { [key: string]: any };

  constructor(emitIntermediateState: { [key: string]: any }[]) {
    this.emitIntermediateState = emitIntermediateState;
    this.toolCallBuffer = {};
    this.currentToolCall = null;
    this.previouslyParsableState = {};
  }

  bufferToolCalls(event: {
    data: { chunk: { tool_call_chunks: { name: string | null; args: string }[] } };
  }) {
    if (event.data.chunk.tool_call_chunks.length > 0) {
      const chunk = event.data.chunk.tool_call_chunks[0];

      if (chunk.name !== null) {
        this.currentToolCall = chunk.name;
        this.toolCallBuffer[this.currentToolCall] = chunk.args;
      } else if (this.currentToolCall !== null) {
        this.toolCallBuffer[this.currentToolCall] += chunk.args;
      }
    }
  }

  getEmitStateConfig(currentToolName: string): [string | null, string | null] {
    for (const config of this.emitIntermediateState) {
      const stateKey = config["state_key"];
      const tool = config["tool"];
      const toolArgument = config["tool_argument"];

      if (currentToolName === tool) {
        return [toolArgument, stateKey];
      }
    }
    return [null, null];
  }

  extractState(): State {
    const state: State = {};

    for (const [key, value] of Object.entries(this.toolCallBuffer)) {
      const [argumentName, stateKey] = this.getEmitStateConfig(key);

      if (stateKey === null) {
        continue;
      }

      let parsedValue;
      try {
        parsedValue = parsePartialJson(value);
      } catch (error) {
        if (key in this.previouslyParsableState) {
          parsedValue = this.previouslyParsableState[key];
        } else {
          continue;
        }
      }

      this.previouslyParsableState[key] = parsedValue;

      if (!argumentName) {
        state[stateKey] = parsedValue;
      } else {
        state[stateKey] = parsedValue[argumentName];
      }
    }

    return state;
  }
}

// Start of Selection
function langGraphDefaultMergeState(
  state: State,
  messages: CopilotKitBaseMessage[],
  actions: ExecutionAction[],
): State {
  if (messages.length > 0 && "role" in messages[0] && messages[0].role === "system") {
    // remove system message
    messages = messages.slice(1);
  }

  // merge with existing messages
  const mergedMessages = state.messages || [];
  const existingMessageIds = new Set(mergedMessages.map((message) => message.id));

  for (const message of messages) {
    if (!existingMessageIds.has(message.id)) {
      mergedMessages.push(message);
    }
  }

  return deepMerge(state, {
    messages: mergedMessages,
    copilotkit: {
      actions,
    },
  });
}

function deepMerge(obj1: State, obj2: State) {
  let result = { ...obj1 };
  for (let key in obj2) {
    if (typeof obj2[key] === "object" && !Array.isArray(obj2[key])) {
      if (obj1[key]) {
        result[key] = deepMerge(obj1[key], obj2[key]);
      } else {
        result[key] = { ...obj2[key] };
      }
    } else {
      result[key] = obj2[key];
    }
  }
  return result;
}
