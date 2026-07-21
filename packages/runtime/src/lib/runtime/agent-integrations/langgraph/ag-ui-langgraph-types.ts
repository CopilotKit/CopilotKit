// @ag-ui/langgraph@0.0.42 publishes declarations that import private
// @langchain/langgraph-sdk paths. Mirror its public agent surface using only
// supported package-root exports; agent.ts still uses the original runtime values.
import type {
  AbstractAgent,
  AgentConfig,
  CustomEvent,
  HttpAgent,
  HttpAgentConfig,
  MessagesSnapshotEvent,
  RawEvent,
  ReasoningEncryptedValueEvent,
  ReasoningEndEvent,
  ReasoningMessageContentEvent,
  ReasoningMessageEndEvent,
  ReasoningMessageStartEvent,
  ReasoningStartEvent,
  RunAgentInput,
  RunErrorEvent,
  RunFinishedEvent,
  RunStartedEvent,
  StateDeltaEvent,
  StateSnapshotEvent,
  StepFinishedEvent,
  StepStartedEvent,
  TextMessageContentEvent,
  TextMessageEndEvent,
  TextMessageStartEvent,
  ToolCallArgsEvent,
  ToolCallEndEvent,
  ToolCallResultEvent,
  ToolCallStartEvent,
} from "@ag-ui/client";
import type {
  Assistant,
  AssistantGraph,
  Client,
  Config,
  DefaultValues,
  Message,
  StreamMode,
  Thread,
  ThreadState,
} from "@langchain/langgraph-sdk";
import type { Observable, Subscriber } from "rxjs";

export type ProcessedEvents =
  | TextMessageStartEvent
  | TextMessageContentEvent
  | TextMessageEndEvent
  | ReasoningStartEvent
  | ReasoningMessageStartEvent
  | ReasoningMessageContentEvent
  | ReasoningMessageEndEvent
  | ReasoningEndEvent
  | ReasoningEncryptedValueEvent
  | ToolCallStartEvent
  | ToolCallArgsEvent
  | ToolCallEndEvent
  | ToolCallResultEvent
  | StateSnapshotEvent
  | StateDeltaEvent
  | MessagesSnapshotEvent
  | RawEvent
  | CustomEvent
  | RunStartedEvent
  | RunFinishedEvent
  | RunErrorEvent
  | StepStartedEvent
  | StepFinishedEvent;

export type State<TDefinedState = Record<string, unknown>> = {
  [K in keyof TDefinedState]: TDefinedState[K] | null;
} & Record<string, unknown>;

export type SchemaKeys = {
  input: string[] | null;
  output: string[] | null;
  context: string[] | null;
  config: string[] | null;
} | null;

export interface StateEnrichment {
  messages: Message[];
  tools: LangGraphToolWithName[];
  "ag-ui": {
    tools: LangGraphToolWithName[];
    context: RunAgentInput["context"];
    inject_a2ui_tool?: boolean | string;
  };
}

interface LangGraphToolWithName {
  type: "function";
  name?: string;
  function: {
    name: string;
    description: string;
    parameters: unknown;
  };
}

interface MessageInProgress {
  id: string;
  toolCallId?: string | null;
  toolCallName?: string | null;
}

interface LangGraphReasoning {
  type: "text";
  text: string;
  index: number;
  signature?: string;
  id?: string;
}

interface ReasoningInProgress {
  index: number;
  type?: LangGraphReasoning["type"];
  messageId: string;
  signature?: string;
}

interface RunMetadata {
  id: string;
  schemaKeys?: SchemaKeys;
  nodeName?: string;
  prevNodeName?: string | null;
  exitingNode?: boolean;
  manuallyEmittedState?: State | null;
  threadId?: string;
  graphInfo?: AssistantGraph;
  hasFunctionStreaming?: boolean;
  serverRunIdKnown?: boolean;
  modelMadeToolCall?: boolean;
}

type MessagesInProgressRecord = Record<string, MessageInProgress | null>;
type RunsStreamPayload = NonNullable<Parameters<Client["runs"]["stream"]>[2]>;
type LangGraphStream = ReturnType<Client["runs"]["stream"]>;

interface RunAgentExtendedInput<
  TStreamMode extends StreamMode | StreamMode[] = StreamMode,
  TSubgraphs extends boolean = false,
> extends Omit<RunAgentInput, "forwardedProps"> {
  forwardedProps?: Omit<RunsStreamPayload, "input" | "streamMode"> & {
    streamMode?: TStreamMode;
    streamSubgraphs?: TSubgraphs;
    nodeName?: string;
    threadMetadata?: Record<string, unknown>;
    injectA2UITool?: boolean | string;
  };
}

interface RegenerateInput extends RunAgentExtendedInput {
  messageCheckpoint: Message;
}

export interface LangGraphAgentConfig extends AgentConfig {
  client?: Client;
  deploymentUrl: string;
  langsmithApiKey?: string;
  propertyHeaders?: Record<string, string>;
  assistantConfig?: Config;
  agentName?: string;
  graphId: string;
  headerFactory?: () => Record<string, string>;
}

interface PreparedStream {
  streamResponse: LangGraphStream;
  state: ThreadState<State>;
  streamMode?: StreamMode | StreamMode[];
}

export interface AGUILangGraphAgentBase extends AbstractAgent {
  client: Client;
  assistantConfig?: Config;
  agentName?: string;
  graphId: string;
  headers: Record<string, string>;
  assistant?: Assistant;
  messagesInProcess: MessagesInProgressRecord;
  emittedToolCallStartIds: Set<string>;
  reasoningProcess: null | ReasoningInProgress;
  activeRun?: RunMetadata;
  subscriber: Subscriber<ProcessedEvents>;
  constantSchemaKeys: string[];
  config: LangGraphAgentConfig;
  clone(): AGUILangGraphAgentBase;
  dispatchEvent(event: ProcessedEvents): boolean;
  run(input: RunAgentInput): Observable<ProcessedEvents>;
  runAgentStream(
    input: RunAgentExtendedInput,
    subscriber: Subscriber<ProcessedEvents>,
  ): Promise<void>;
  prepareRegenerateStream(
    input: RegenerateInput,
    streamMode: StreamMode | StreamMode[],
  ): Promise<void | PreparedStream>;
  prepareStream(
    input: RunAgentExtendedInput,
    streamMode: StreamMode | StreamMode[],
  ): Promise<void | PreparedStream>;
  handleStreamEvents(
    stream: PreparedStream | void,
    threadId: string,
    subscriber: Subscriber<ProcessedEvents>,
    input: RunAgentExtendedInput,
    streamModes: StreamMode | StreamMode[],
  ): Promise<void>;
  handleSingleEvent(event: unknown): void;
  abortRun(): void;
  handleReasoningEvent(reasoningData: LangGraphReasoning): void;
  getStateSnapshot(threadState: ThreadState<State>): State;
  getOrCreateThread(
    threadId: string,
    threadMetadata?: Record<string, unknown>,
  ): Promise<Thread>;
  getThread(threadId: string): Promise<Thread<DefaultValues, unknown>>;
  createThread(
    payload?: Parameters<Client["threads"]["create"]>[0],
  ): Promise<Thread<DefaultValues, unknown>>;
  mergeConfigs(input: {
    configs: Config[];
    assistant: Assistant;
    schemaKeys: SchemaKeys;
  }): Promise<Config>;
  getMessageInProgress(runId: string): MessageInProgress | null;
  setMessageInProgress(runId: string, data: MessageInProgress): void;
  getAssistant(): Promise<Assistant>;
  getSchemaKeys(): Promise<SchemaKeys>;
  langGraphDefaultMergeState(
    state: State,
    messages: Message[],
    input: RunAgentExtendedInput,
  ): State<StateEnrichment>;
  handleNodeChange(nodeName: string | undefined): void;
  startStep(nodeName: string): void;
  endStep(): void;
  getCheckpointByMessage(
    messageId: string,
    threadId: string,
    checkpoint?: null | {
      checkpoint_id?: null | string;
      checkpoint_ns: string;
    },
  ): Promise<ThreadState>;
}

export interface AGUILangGraphAgentConstructor {
  new (config: LangGraphAgentConfig): AGUILangGraphAgentBase;
}

export interface LangGraphHttpAgentConstructor {
  new (config: HttpAgentConfig): HttpAgent;
}
