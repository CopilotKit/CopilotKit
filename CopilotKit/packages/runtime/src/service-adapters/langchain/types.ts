import { AIMessage, AIMessageChunk, BaseMessageChunk } from "@langchain/core/messages";
import {
  IterableReadableStream,
  IterableReadableStreamInterface,
} from "@langchain/core/utils/stream";

export type LangChainBaseMessageChunkStream = IterableReadableStream<BaseMessageChunk>;
export type LangChainAIMessageChunkStream = IterableReadableStreamInterface<AIMessageChunk>;
export type LangChainStreamReturnType =
  | LangChainBaseMessageChunkStream
  | LangChainAIMessageChunkStream;
export type LangChainReturnType = LangChainStreamReturnType | BaseMessageChunk | string | AIMessage;
