import { AssistantGraph, Client as LangGraphClient, GraphSchema } from "@langchain/langgraph-sdk";
import { createHash } from "node:crypto";
import { isValidUUID, randomUUID } from "@copilotkit/shared";
import { parse as parsePartialJson } from "partial-json";
import { Logger } from "pino";
import { ActionInput } from "../../graphql/inputs/action.input";
import { LangGraphPlatformAgent, LangGraphPlatformEndpoint } from "./remote-actions";
import { CopilotRequestContextProperties } from "../integrations";
import { ActionExecutionMessage, Message, MessageType } from "../../graphql/types/converted";
import { MessageRole } from "../../graphql/types/enums";
import { CustomEventNames, LangGraphEventTypes } from "../../agents/langgraph/events";
import telemetry from "../telemetry-client";
import { MetaEventInput } from "../../graphql/inputs/meta-event.input";
import { MetaEventName } from "../../graphql/types/meta-events.type";
import { RunsStreamPayload } from "@langchain/langgraph-sdk/dist/types";
import { parseJson, CopilotKitMisuseError } from "@copilotkit/shared";
import { RemoveMessage } from "@langchain/core/messages";

type State = Record<string, any>;

type ExecutionAction = Pick<ActionInput, "name" | "description"> & { parameters: string };

interface ExecutionArgs extends Omit<LangGraphPlatformEndpoint, "agents"> {
  agent: LangGraphPlatformAgent;
  threadId: string;
  nodeName: string;
  messages: Message[];
  state: State;
  config?: {
    configurable?: Record<string, any>;
    [key: string]: any;
  };
  properties: CopilotRequestContextProperties;
  actions: ExecutionAction[];
  logger: Logger;
  metaEvents?: MetaEventInput[];
}

// The following types are our own definition to the messages accepted by LangGraph Platform, enhanced with some of our extra data.
interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

type BaseLangGraphPlatformMessage = Omit<
  Message,
  | "isResultMessage"
  | "isTextMessage"
  | "isImageMessage"
  | "isActionExecutionMessage"
  | "isAgentStateMessage"
  | "type"
  | "createdAt"
> & {
  content: string;
  role: MessageRole;
  additional_kwargs?: Record<string, unknown>;
  type: MessageType;
};

interface LangGraphPlatformResultMessage extends BaseLangGraphPlatformMessage {
  tool_call_id: string;
  name: string;
}

interface LangGraphPlatformActionExecutionMessage extends BaseLangGraphPlatformMessage {
  tool_calls: ToolCall[];
}

type LangGraphPlatformMessage =
  | LangGraphPlatformActionExecutionMessage
  | LangGraphPlatformResultMessage
  | BaseLangGraphPlatformMessage;

type SchemaKeys = {
  input: string[] | null;
  output: string[] | null;
  config: string[] | null;
} | null;

let activeInterruptEvent = false;

export async function execute(args: ExecutionArgs): Promise<ReadableStream<Uint8Array>> {
  return new ReadableStream({
    async start(controller) {
      try {
        await streamEvents(controller, args);
        controller.close();
      } catch (err) {
        // Unwrap the possible cause
        const cause = err?.cause;

        // Check code directly if it exists
        const errorCode = cause?.code || err?.code;

        if (errorCode === "ECONNREFUSED") {
          throw new CopilotKitMisuseError({
            message: `
              The LangGraph client could not connect to the graph. Please further check previous logs, which includes further details.
              
              See more: https://docs.copilotkit.ai/troubleshooting/common-issues`,
          });
        } else {
          throw new CopilotKitMisuseError({
            message: `
              The LangGraph client threw unhandled error ${err}.
              
              See more: https://docs.copilotkit.ai/troubleshooting/common-issues`,
          });
        }
      }
    },
  });
}

async function streamEvents(controller: ReadableStreamDefaultController, args: ExecutionArgs) {
  const {
    deploymentUrl,
    langsmithApiKey,
    threadId: argsInitialThreadId,
    agent,
    nodeName: initialNodeName,
    state: initialState,
    config: explicitConfig,
    messages,
    actions,
    logger,
    properties,
    metaEvents,
  } = args;

  let nodeName = initialNodeName;
  let state = initialState;
  const { name, assistantId: initialAssistantId } = agent;

  const propertyHeaders = properties.authorization
    ? { authorization: `Bearer ${properties.authorization}` }
    : null;

  const client = new LangGraphClient({
    apiUrl: deploymentUrl,
    apiKey: langsmithApiKey,
    defaultHeaders: { ...propertyHeaders },
  });

  let threadId = argsInitialThreadId ?? randomUUID();
  if (argsInitialThreadId && argsInitialThreadId.startsWith("ck-")) {
    threadId = argsInitialThreadId.substring(3);
  }

  if (!isValidUUID(threadId)) {
    console.warn(
      `Cannot use the threadId ${threadId} with LangGraph Platform. Must be a valid UUID.`,
    );
  }

  let wasInitiatedWithExistingThread = true;
  try {
    await client.threads.get(threadId);
  } catch (error) {
    wasInitiatedWithExistingThread = false;
    await client.threads.create({ threadId });
  }

  let agentState = { values: {} };
  if (wasInitiatedWithExistingThread) {
    agentState = await client.threads.getState(threadId);
  }

  const agentStateValues = agentState.values as State;
  state.messages = agentStateValues.messages;
  const mode =
    threadId && nodeName != "__end__" && nodeName != undefined && nodeName != null
      ? "continue"
      : "start";
  let formattedMessages = [];
  try {
    formattedMessages = copilotkitMessagesToLangChain(messages);
  } catch (e) {
    logger.error(e, `Error event thrown: ${e.message}`);
  }
  state = langGraphDefaultMergeState(state, formattedMessages, actions, name);

  const streamInput = mode === "start" ? state : null;

  const payload: RunsStreamPayload = {
    input: streamInput,
    streamMode: ["events", "values", "updates"],
    command: undefined,
  };

  const lgInterruptMetaEvent = metaEvents?.find(
    (ev) => ev.name === MetaEventName.LangGraphInterruptEvent,
  );
  if (activeInterruptEvent && !lgInterruptMetaEvent) {
    // state.messages includes only messages that were not processed by the agent, which are the interrupt messages
    payload.command = { resume: state.messages };
  }
  if (lgInterruptMetaEvent?.response) {
    let response = lgInterruptMetaEvent.response;
    payload.command = { resume: parseJson(response, response) };
  }

  if (mode === "continue" && !activeInterruptEvent) {
    await client.threads.updateState(threadId, { values: state, asNode: nodeName });
  }

  let streamInfo: {
    provider?: string;
    langGraphHost?: string;
    langGraphVersion?: string;
    hashedLgcKey: string;
  } = {
    hashedLgcKey: createHash("sha256").update(langsmithApiKey).digest("hex"),
  };

  const assistants = await client.assistants.search();
  const retrievedAssistant = assistants.find(
    (a) => a.name === name || a.assistant_id === initialAssistantId,
  );
  if (!retrievedAssistant) {
    telemetry.capture("oss.runtime.agent_execution_stream_errored", {
      ...streamInfo,
      error: `Found no assistants for given information, while ${assistants.length} assistants exists`,
    });
    console.error(`
      No agent found for the agent name specified in CopilotKit provider
      Please check your available agents or provide an agent ID in the LangGraph Platform endpoint definition.\n
      
      These are the available agents: [${assistants.map((a) => `${a.name} (ID: ${a.assistant_id})`).join(", ")}]
      `);
    throw new Error("No agent id found");
  }
  const assistantId = retrievedAssistant.assistant_id;

  const graphInfo = await client.assistants.getGraph(assistantId);
  const graphSchema = await client.assistants.getSchemas(assistantId);
  const schemaKeys = getSchemaKeys(graphSchema);

  if (explicitConfig) {
    let filteredConfigurable = retrievedAssistant.config.configurable ?? {};
    if (explicitConfig.configurable) {
      filteredConfigurable = schemaKeys?.config
        ? filterObjectBySchemaKeys(explicitConfig?.configurable, schemaKeys?.config)
        : explicitConfig?.configurable;
    }
    await client.assistants.update(assistantId, {
      config: { ...retrievedAssistant.config, ...explicitConfig, configurable: filteredConfigurable },
    });
  }

  // Do not input keys that are not part of the input schema
  if (payload.input && schemaKeys?.input) {
    payload.input = filterObjectBySchemaKeys(payload.input, schemaKeys.input);
  }

  let streamingStateExtractor = new StreamingStateExtractor([]);
  let prevNodeName = null;
  let emitIntermediateStateUntilEnd = null;
  let shouldExit = false;
  let externalRunId = null;

  const streamResponse = client.runs.stream(threadId, assistantId, payload);

  const emit = (message: string) => controller.enqueue(new TextEncoder().encode(message));

  let latestStateValues = {};
  let updatedState = state;
  // If a manual emittance happens, it is the ultimate source of truth of state, unless a node has exited.
  // Therefore, this value should either hold null, or the only edition of state that should be used.
  let manuallyEmittedState = null;

  activeInterruptEvent = false;
  try {
    telemetry.capture("oss.runtime.agent_execution_stream_started", {
      hashedLgcKey: streamInfo.hashedLgcKey,
    });
    for await (const chunk of streamResponse) {
      if (!["events", "values", "error", "updates"].includes(chunk.event)) continue;

      if (chunk.event === "error") {
        throw new Error(`Error event thrown: ${chunk.data.message}`);
      }

      const interruptEvents = chunk.data?.__interrupt__;
      if (interruptEvents?.length) {
        activeInterruptEvent = true;
        const interruptValue = interruptEvents?.[0].value;
        if (
          typeof interruptValue != "string" &&
          "__copilotkit_interrupt_value__" in interruptValue
        ) {
          const evValue = interruptValue.__copilotkit_interrupt_value__;
          emit(
            JSON.stringify({
              event: LangGraphEventTypes.OnCopilotKitInterrupt,
              data: {
                value: typeof evValue === "string" ? evValue : JSON.stringify(evValue),
                messages: langchainMessagesToCopilotKit(interruptValue.__copilotkit_messages__),
              },
            }) + "\n",
          );
        } else {
          emit(
            JSON.stringify({
              event: LangGraphEventTypes.OnInterrupt,
              value:
                typeof interruptValue === "string"
                  ? interruptValue
                  : JSON.stringify(interruptValue),
            }) + "\n",
          );
        }
        continue;
      }
      if (chunk.event === "updates") continue;

      if (chunk.event === "values") {
        latestStateValues = chunk.data;
        continue;
      }

      const event = chunk.data;
      const currentNodeName = event.metadata.langgraph_node;
      const eventType = event.event;
      const runId = event.metadata.run_id;
      externalRunId = runId;
      const metadata = event.metadata;

      if (event.data?.output?.model != null && event.data?.output?.model != "") {
        streamInfo.provider = event.data?.output?.model;
      }
      if (metadata.langgraph_host != null && metadata.langgraph_host != "") {
        streamInfo.langGraphHost = metadata.langgraph_host;
      }
      if (metadata.langgraph_version != null && metadata.langgraph_version != "") {
        streamInfo.langGraphVersion = metadata.langgraph_version;
      }

      shouldExit =
        shouldExit ||
        (eventType === LangGraphEventTypes.OnCustomEvent &&
          event.name === CustomEventNames.CopilotKitExit);

      const emitIntermediateState = metadata["copilotkit:emit-intermediate-state"];
      const manuallyEmitIntermediateState =
        eventType === LangGraphEventTypes.OnCustomEvent &&
        event.name === CustomEventNames.CopilotKitManuallyEmitIntermediateState;

      const exitingNode =
        nodeName === currentNodeName && eventType === LangGraphEventTypes.OnChainEnd;

      // See manuallyEmittedState for explanation
      if (exitingNode) {
        manuallyEmittedState = null;
      }

      // we only want to update the node name under certain conditions
      // since we don't need any internal node names to be sent to the frontend
      if (graphInfo["nodes"].some((node) => node.id === currentNodeName)) {
        nodeName = currentNodeName;
      }

      updatedState = manuallyEmittedState ?? latestStateValues;

      if (!nodeName) {
        continue;
      }

      if (manuallyEmitIntermediateState) {
        // See manuallyEmittedState for explanation
        manuallyEmittedState = event.data;
        emit(
          getStateSyncEvent({
            threadId,
            runId,
            agentName: agent.name,
            nodeName,
            state: manuallyEmittedState,
            running: true,
            active: true,
            schemaKeys,
          }),
        );
        continue;
      }

      if (emitIntermediateState && emitIntermediateStateUntilEnd == null) {
        emitIntermediateStateUntilEnd = nodeName;
      }

      if (emitIntermediateState && eventType === LangGraphEventTypes.OnChatModelStart) {
        // reset the streaming state extractor
        streamingStateExtractor = new StreamingStateExtractor(emitIntermediateState);
      }

      if (emitIntermediateState && eventType === LangGraphEventTypes.OnChatModelStream) {
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
        eventType === LangGraphEventTypes.OnChainEnd
      ) {
        // stop emitting function call state
        emitIntermediateStateUntilEnd = null;
      }

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
            schemaKeys,
          }),
        );
      }

      emit(JSON.stringify(event) + "\n");
    }

    state = await client.threads.getState(threadId);
    const interrupts = state.tasks?.[0]?.interrupts;
    nodeName = interrupts ? nodeName : Object.keys(state.metadata.writes)[0];
    const isEndNode = state.next.length === 0 && !interrupts;

    telemetry.capture("oss.runtime.agent_execution_stream_ended", streamInfo);

    emit(
      getStateSyncEvent({
        threadId,
        runId: externalRunId,
        agentName: agent.name,
        nodeName: isEndNode ? "__end__" : nodeName,
        state: state.values,
        running: !shouldExit,
        active: false,
        includeMessages: true,
        schemaKeys,
      }),
    );

    return Promise.resolve();
  } catch (e) {
    logger.error(e);
    telemetry.capture("oss.runtime.agent_execution_stream_errored", {
      ...streamInfo,
      error: e.message,
    });
    return Promise.resolve();
  }
}

function getStateSyncEvent({
  threadId,
  runId,
  agentName,
  nodeName,
  state,
  running,
  active,
  includeMessages = false,
  schemaKeys,
}: {
  threadId: string;
  runId: string;
  agentName: string;
  nodeName: string;
  state: State;
  running: boolean;
  active: boolean;
  includeMessages?: boolean;
  schemaKeys: SchemaKeys;
}): string {
  if (!includeMessages) {
    state = Object.keys(state).reduce((acc, key) => {
      if (key !== "messages") {
        acc[key] = state[key];
      }
      return acc;
    }, {} as State);
  } else {
    state = {
      ...state,
      messages: langchainMessagesToCopilotKit(state.messages || []),
    };
  }

  // Do not emit state keys that are not part of the output schema
  if (schemaKeys?.output) {
    state = filterObjectBySchemaKeys(state, schemaKeys.output);
  }

  return (
    JSON.stringify({
      event: LangGraphEventTypes.OnCopilotKitStateSync,
      thread_id: threadId,
      run_id: runId,
      agent_name: agentName,
      node_name: nodeName,
      active: active,
      state: state,
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

      if (chunk.name !== null && chunk.name !== undefined) {
        this.currentToolCall = chunk.name;
        this.toolCallBuffer[this.currentToolCall] = chunk.args;
      } else if (this.currentToolCall !== null && this.currentToolCall !== undefined) {
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
  messages: LangGraphPlatformMessage[],
  actions: ExecutionAction[],
  agentName: string,
): State {
  if (messages.length > 0 && "role" in messages[0] && messages[0].role === "system") {
    // remove system message
    messages = messages.slice(1);
  }

  // merge with existing messages
  const existingMessages: LangGraphPlatformMessage[] = state.messages || [];
  const existingMessageIds = new Set(existingMessages.map((message) => message.id));
  const messageIds = new Set(messages.map((message) => message.id));

  let removedMessages = [];
  if (messages.length < existingMessages.length) {
    // Messages were removed
    removedMessages = existingMessages
      .filter((m) => !messageIds.has(m.id))
      .map((m) => new RemoveMessage({ id: m.id }));
  }

  const newMessages = messages.filter((message) => !existingMessageIds.has(message.id));

  return {
    ...state,
    messages: [...removedMessages, ...newMessages],
    copilotkit: {
      actions,
    },
  };
}

export function langchainMessagesToCopilotKit(messages: any[]): any[] {
  const result: any[] = [];
  const tool_call_names: Record<string, string> = {};

  // First pass: gather all tool call names from AI messages
  for (const message of messages) {
    if (message.type === "ai") {
      for (const tool_call of message.tool_calls) {
        tool_call_names[tool_call.id] = tool_call.name;
      }
    }
  }

  for (const message of messages) {
    let content: any = message.content;
    if (content instanceof Array) {
      content = content[0];
    }
    if (content instanceof Object) {
      content = content.text;
    }

    if (message.type === "human") {
      result.push({
        role: "user",
        content: content,
        id: message.id,
      });
    } else if (message.type === "system") {
      result.push({
        role: "system",
        content: content,
        id: message.id,
      });
    } else if (message.type === "ai") {
      if (message.tool_calls && message.tool_calls.length > 0) {
        for (const tool_call of message.tool_calls) {
          result.push({
            id: tool_call.id,
            name: tool_call.name,
            arguments: tool_call.args,
            parentMessageId: message.id,
          });
        }
      } else {
        result.push({
          role: "assistant",
          content: content,
          id: message.id,
          parentMessageId: message.id,
        });
      }
    } else if (message.type === "tool") {
      const actionName = tool_call_names[message.tool_call_id] || message.name || "";
      result.push({
        actionExecutionId: message.tool_call_id,
        actionName: actionName,
        result: content,
        id: message.id,
      });
    }
  }
  const resultsDict: Record<string, any> = {};
  for (const msg of result) {
    if (msg.actionExecutionId) {
      resultsDict[msg.actionExecutionId] = msg;
    }
  }

  const reorderedResult: Message[] = [];

  for (const msg of result) {
    // If it's not a tool result, just append it
    if (!("actionExecutionId" in msg)) {
      reorderedResult.push(msg);
    }

    // If the message has arguments (i.e., is a tool call invocation),
    // append the corresponding result right after it
    if ("arguments" in msg) {
      const msgId = msg.id;
      if (msgId in resultsDict) {
        reorderedResult.push(resultsDict[msgId]);
      }
    }
  }

  return reorderedResult;
}

function copilotkitMessagesToLangChain(messages: Message[]): LangGraphPlatformMessage[] {
  const result: LangGraphPlatformMessage[] = [];
  const processedActionExecutions = new Set<string>();

  for (const message of messages) {
    // Handle TextMessage
    if (message.isTextMessage()) {
      if (message.role === "user") {
        // Human message
        result.push({
          ...message,
          role: MessageRole.user,
        });
      } else if (message.role === "system") {
        // System message
        result.push({
          ...message,
          role: MessageRole.system,
        });
      } else if (message.role === "assistant") {
        // Assistant message
        result.push({
          ...message,
          role: MessageRole.assistant,
        });
      }
      continue;
    }

    // Handle ImageMessage
    if (message.isImageMessage()) {
      if (message.role === "user") {
        result.push({
          ...message,
          role: MessageRole.user,
          content: "",
        });
      } else if (message.role === "assistant") {
        result.push({
          ...message,
          role: MessageRole.assistant,
          content: "",
        });
      }
      continue;
    }

    // Handle ActionExecutionMessage (multiple tool calls per parentMessageId)
    if (message.isActionExecutionMessage()) {
      const messageId = message.parentMessageId ?? message.id;

      // If we've already processed this action execution group, skip
      if (processedActionExecutions.has(messageId)) {
        continue;
      }

      processedActionExecutions.add(messageId);

      // Gather all tool calls related to this messageId
      const relatedActionExecutions = messages.filter(
        (m) =>
          m.isActionExecutionMessage() &&
          ((m.parentMessageId && m.parentMessageId === messageId) || m.id === messageId),
      ) as ActionExecutionMessage[];

      const tool_calls: ToolCall[] = relatedActionExecutions.map((m) => ({
        name: m.name,
        args: m.arguments,
        id: m.id,
      }));

      result.push({
        id: messageId,
        type: "ActionExecutionMessage",
        content: "",
        tool_calls: tool_calls,
        role: MessageRole.assistant,
      } satisfies LangGraphPlatformActionExecutionMessage);

      continue;
    }

    // Handle ResultMessage
    if (message.isResultMessage()) {
      result.push({
        type: message.type,
        content: message.result,
        id: message.id,
        tool_call_id: message.actionExecutionId,
        name: message.actionName,
        role: MessageRole.tool,
      } satisfies LangGraphPlatformResultMessage);
      continue;
    }

    throw new Error(`Unknown message type ${message.type}`);
  }

  return result;
}

function getSchemaKeys(graphSchema: GraphSchema): SchemaKeys {
  const CONSTANT_KEYS = ["messages", "copilotkit"];
  let configSchema = null;
  if (graphSchema.config_schema.properties) {
    configSchema = Object.keys(graphSchema.config_schema.properties);
  }
  if (!graphSchema.input_schema.properties || !graphSchema.output_schema.properties) {
    return configSchema;
  }
  const inputSchema = Object.keys(graphSchema.input_schema.properties);
  const outputSchema = Object.keys(graphSchema.output_schema.properties);

  return {
    input: inputSchema && inputSchema.length ? [...inputSchema, ...CONSTANT_KEYS] : null,
    output: outputSchema && outputSchema.length ? [...outputSchema, ...CONSTANT_KEYS] : null,
    config: configSchema,
  };
}

function filterObjectBySchemaKeys(obj: Record<string, any>, schemaKeys: string[]) {
  return Object.fromEntries(Object.entries(obj).filter(([key]) => schemaKeys.includes(key)));
}
