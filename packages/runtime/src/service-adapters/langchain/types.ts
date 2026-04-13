import type {
  AIMessage,
  AIMessageChunk,
  BaseMessageChunk,
} from "@langchain/core/messages";
import type {
  IterableReadableStream,
  IterableReadableStreamInterface,
} from "@langchain/core/utils/stream";

export type LangChainBaseMessageChunkStream =
  IterableReadableStream<BaseMessageChunk>;
export type LangChainAIMessageChunkStream =
  IterableReadableStreamInterface<AIMessageChunk>;
export type LangChainReturnType =
  | LangChainBaseMessageChunkStream
  | LangChainAIMessageChunkStream
  | BaseMessageChunk
  | string
  | AIMessage;
