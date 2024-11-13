import { Client } from "@langchain/langgraph-sdk";
import { randomUUID } from "node:crypto";
import { parse as parsePartialJson } from "partial-json";
import { ActionInput } from "../../graphql/inputs/action.input";
import { LangGraphCloudAgent, LangGraphCloudEndpoint } from "./remote-actions";
import { CopilotRequestContextProperties } from "../integrations";
import { Message } from "../../graphql/types/converted";
import { MessageRole } from "../../graphql/types/enums";
import { AIMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";

type State = Record<string, any>;
type LangGraphMessage = AIMessage | SystemMessage | HumanMessage | ToolMessage;

type ExecutionAction = Pick<ActionInput, "name" | "description"> & { parameters: string };

interface ExecutionArgs extends Omit<LangGraphCloudEndpoint, "agents"> {
  agent: LangGraphCloudAgent;
  threadId: string;
  nodeName: string;
  messages: Message[];
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
    deploymentUrl,
    langsmithApiKey,
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

  // TODO: deploymentUrl is not required in local development
  const client = new Client({ apiUrl: deploymentUrl, apiKey: langsmithApiKey });
  let initialThreadId = agrsInitialThreadId;
  const wasInitiatedWithExistingThread = !!initialThreadId;
  if (initialThreadId && initialThreadId.startsWith("ck-")) {
    initialThreadId = initialThreadId.substring(3);
  }

  const assistants = await client.assistants.search();
  const retrievedAssistant = assistants.find((a) => a.name === name);
  const threadId = initialThreadId ?? randomUUID();
  if (initialThreadId === threadId) {
    await client.threads.get(threadId);
  } else {
    await client.threads.create({ threadId: threadId });
  }

  let agentState = { values: {} };
  if (wasInitiatedWithExistingThread) {
    agentState = await client.threads.getState(threadId);
  }
  const agentStateValues = agentState.values as State;
  state.messages = agentStateValues.messages;
  const mode = wasInitiatedWithExistingThread && nodeName != "__end__" ? "continue" : "start";
  state = langGraphDefaultMergeState(state, formatMessages(messages), actions, name);

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
    const metadata = event.metadata;

    shouldExit = shouldExit != null ? shouldExit : metadata["copilotkit:exit"];
    const emitIntermediateState = metadata["copilotkit:emit-intermediate-state"];
    const forceEmitIntermediateState = metadata["copilotkit:force-emit-intermediate-state"];
    const manuallyEmitMessage = metadata["copilotkit:manually-emit-messages"];
    const manuallyEmitToolCall = metadata["copilotkit:manually-emit-tool-calls"];
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

    if (manuallyEmitMessage) {
      if (eventType === "on_chain_end") {
        state = event.data.output;
        emit(
          JSON.stringify({
            event: "on_copilotkit_emit_message",
            message: event.data.output,
            messageId: randomUUID(),
            role: MessageRole.assistant,
          }) + "\n",
        );
      }
      continue;
    }

    if (manuallyEmitToolCall) {
      if (eventType === "on_chain_end") {
        state = event.data.output;
        emit(
          JSON.stringify({
            event: "on_copilotkit_emit_tool_call",
            name: event.data.output.name,
            args: event.data.output.args,
            id: event.data.output.id,
          }) + "\n",
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
  messages: LangGraphMessage[],
  actions: ExecutionAction[],
  agentName: string,
): State {
  if (messages.length > 0 && "role" in messages[0] && messages[0].role === "system") {
    // remove system message
    messages = messages.slice(1);
  }

  // merge with existing messages
  const mergedMessages: LangGraphMessage[] = state.messages || [];
  const existingMessageIds = new Set(mergedMessages.map((message) => message.id));
  const existingToolCallResults = new Set<string>();

  for (const message of mergedMessages) {
    if ("tool_call_id" in message) {
      existingToolCallResults.add(message.tool_call_id);
    }
  }

  for (const message of messages) {
    // filter tool calls to activate the agent itself
    if (
      "tool_calls" in message &&
      message.tool_calls.length > 0 &&
      message.tool_calls[0].name === agentName
    ) {
      continue;
    }

    // filter results from activating the agent
    if ("name" in message && message.name === agentName) {
      continue;
    }

    if (!existingMessageIds.has(message.id)) {
      // skip duplicate tool call results
      if ("tool_call_id" in message && existingToolCallResults.has(message.tool_call_id)) {
        console.warn("Warning: Duplicate tool call result, skipping:", message.tool_call_id);
        continue;
      }

      mergedMessages.push(message);
    } else {
      // Replace the message with the existing one
      for (let i = 0; i < mergedMessages.length; i++) {
        if (mergedMessages[i].id === message.id) {
          if ("tool_calls" in message) {
            if (
              ("tool_calls" in mergedMessages[i] || "additional_kwargs" in mergedMessages[i]) &&
              mergedMessages[i].content
            ) {
              message.tool_calls = mergedMessages[i]["tool_calls"];
              message.additional_kwargs = mergedMessages[i].additional_kwargs;
            }
          }
          mergedMessages[i] = message;
        }
      }
    }
  }

  // fix wrong tool call ids
  for (let i = 0; i < mergedMessages.length - 1; i++) {
    const currentMessage = mergedMessages[i];
    const nextMessage = mergedMessages[i + 1];

    if (
      "tool_calls" in currentMessage &&
      currentMessage.tool_calls.length > 0 &&
      "tool_call_id" in nextMessage
    ) {
      nextMessage.tool_call_id = currentMessage.tool_calls[0].id;
    }
  }

  // try to auto-correct and log alignment issues
  const correctedMessages: LangGraphMessage[] = [];

  for (let i = 0; i < mergedMessages.length; i++) {
    const currentMessage = mergedMessages[i];
    const nextMessage = mergedMessages[i + 1] || null;
    const prevMessage = mergedMessages[i - 1] || null;

    if ("tool_calls" in currentMessage && currentMessage.tool_calls.length > 0) {
      if (!nextMessage) {
        console.warn(
          "No next message to auto-correct tool call, skipping:",
          currentMessage.tool_calls[0].id,
        );
        continue;
      }

      if (
        !("tool_call_id" in nextMessage) ||
        nextMessage.tool_call_id !== currentMessage.tool_calls[0].id
      ) {
        const toolMessage = mergedMessages.find(
          (m) => "tool_call_id" in m && m.tool_call_id === currentMessage.tool_calls[0].id,
        );

        if (toolMessage) {
          console.warn(
            "Auto-corrected tool call alignment issue:",
            currentMessage.tool_calls[0].id,
          );
          correctedMessages.push(currentMessage, toolMessage);
          continue;
        } else {
          console.warn(
            "No corresponding tool call result found for tool call, skipping:",
            currentMessage.tool_calls[0].id,
          );
          continue;
        }
      }

      correctedMessages.push(currentMessage);
      continue;
    }

    if ("tool_call_id" in currentMessage) {
      if (!prevMessage || !("tool_calls" in prevMessage)) {
        console.warn("No previous tool call, skipping tool call result:", currentMessage.id);
        continue;
      }

      if (prevMessage.tool_calls && prevMessage.tool_calls[0].id !== currentMessage.tool_call_id) {
        console.warn("Tool call id is incorrect, skipping tool call result:", currentMessage.id);
        continue;
      }

      correctedMessages.push(currentMessage);
      continue;
    }

    correctedMessages.push(currentMessage);
  }

  return deepMerge(state, {
    messages: correctedMessages,
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

function formatMessages(messages: Message[]): LangGraphMessage[] {
  return messages.map((message) => {
    if (message.isTextMessage() && message.role === "assistant") {
      return new AIMessage({
        content: message.content,
        id: message.id,
      });
    }
    if (message.isTextMessage() && message.role === "system") {
      return new SystemMessage({
        content: message.content,
        id: message.id,
      });
    }
    if (message.isTextMessage() && message.role === "user") {
      return new HumanMessage({
        content: message.content,
        id: message.id,
      });
    }
    if (message.isActionExecutionMessage()) {
      const toolCall = {
        name: message["name"],
        args: message["arguments"],
        id: message["id"],
      };
      return new AIMessage({
        tool_calls: [toolCall],
        content: "",
        id: message["id"],
      });
    }
    if (message.isResultMessage()) {
      return new ToolMessage({
        content: message.result,
        id: message["id"],
        tool_call_id: message.actionExecutionId,
        name: message.actionName,
      });
    }

    throw new Error(`Unknown message type ${message.type}`);
  });
}
