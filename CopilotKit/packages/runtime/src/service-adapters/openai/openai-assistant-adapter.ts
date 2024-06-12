/**
 * CopilotKit Adapter for the OpenAI Assistant API.
 *
 * Use this adapter to get responses from the OpenAI Assistant API.
 *
 * <RequestExample>
 * ```typescript
 * const copilotKit = new CopilotRuntime();
 * return copilotKit.response(
 *   req,
 *   new OpenAIAssistantAdapter({
 *    assistantId: "your-assistant-id"
 *   })
 * );
 * ```
 * </RequestExample>
 */
import OpenAI from "openai";
import {
  CopilotServiceAdapter,
  CopilotRuntimeChatCompletionRequest,
  CopilotRuntimeChatCompletionResponse,
} from "../service-adapter";
import { Message, ResultMessage, TextMessage } from "@copilotkit/shared";
import {
  convertActionInputToOpenAITool,
  convertMessageToOpenAIMessage,
  convertSystemMessageToAssistantAPI,
} from "./utils";
import { RunSubmitToolOutputsStreamParams } from "openai/resources/beta/threads/runs/runs";
import { AssistantStream } from "openai/lib/AssistantStream";
import { RuntimeEventSource } from "../events";
import { ActionInput } from "../../graphql/inputs/action.input";
import { AssistantStreamEvent, AssistantTool } from "openai/resources/beta/assistants";

export interface OpenAIAssistantAdapterParams {
  /**
   * The ID of the assistant to use.
   */
  assistantId: string;

  /**
   * An instance of `OpenAI` to use for the request. If not provided, a new instance will be created.
   */
  openai?: OpenAI;

  /**
   * Whether to enable the code interpreter. Defaults to `true`.
   */
  codeInterpreterEnabled?: boolean;

  /**
   * Whether to enable retrieval. Defaults to `true`.
   */
  fileSearchEnabled?: boolean;
}

export class OpenAIAssistantAdapter implements CopilotServiceAdapter {
  private openai: OpenAI;
  private codeInterpreterEnabled: boolean;
  private assistantId: string;
  private fileSearchEnabled: boolean;

  constructor(params: OpenAIAssistantAdapterParams) {
    this.openai = params.openai || new OpenAI({});
    this.codeInterpreterEnabled = params.codeInterpreterEnabled === false || true;
    this.fileSearchEnabled = params.fileSearchEnabled === false || true;
    this.assistantId = params.assistantId;
  }

  async process({
    messages,
    actions,
    eventSource,
    threadId,
    runId,
  }: CopilotRuntimeChatCompletionRequest): Promise<CopilotRuntimeChatCompletionResponse> {
    let run: OpenAI.Beta.Threads.Runs.Run | null = null;

    // if we don't have a threadId, create a new thread
    threadId ||= (await this.openai.beta.threads.create()).id;
    const lastMessage = messages.at(-1);

    // submit function outputs
    if (lastMessage instanceof ResultMessage && runId) {
      run = await this.submitToolOutputs(threadId, runId, messages, eventSource);
    }
    // submit user message
    else if (lastMessage instanceof TextMessage) {
      run = await this.submitUserMessage(threadId, messages, actions, eventSource);
    }
    // unsupported message
    else {
      console.error("No actionable message found in the messages");
      throw new Error("No actionable message found in the messages");
    }

    // TODO-PROTOCOL:
    // implement streaming
    // if (run.status === "requires_action") {
    //   // return the tool calls
    //   return {
    //     stream: new AssistantSingleChunkReadableStream(
    //       "",
    //       run.required_action!.submit_tool_outputs.tool_calls,
    //     ),
    //     threadId,
    //     runId: run.id,
    //   };
    // } else {
    //   // return the last message
    //   const newMessages = await this.openai.beta.threads.messages.list(threadId, {
    //     limit: 1,
    //     order: "desc",
    //   });

    //   const content = newMessages.data[0].content[0];
    //   const contentString = content.type === "text" ? content.text.value : "";

    //   return {
    //     stream: new AssistantSingleChunkReadableStream(contentString),
    //     threadId,
    //   };
    // }

    return {
      threadId,
      runId: run.id,
    };
  }

  // private async waitForRun(
  //   run: OpenAI.Beta.Threads.Runs.Run,
  // ): Promise<OpenAI.Beta.Threads.Runs.Run> {
  //   while (true) {
  //     const status = await this.openai.beta.threads.runs.retrieve(run.thread_id, run.id);
  //     if (status.status === "completed" || status.status === "requires_action") {
  //       return status;
  //     } else if (status.status !== "in_progress" && status.status !== "queued") {
  //       console.error(`Thread run failed with status: ${status.status}`);
  //       throw new Error(`Thread run failed with status: ${status.status}`);
  //     }
  //     await new Promise((resolve) => setTimeout(resolve, RUN_STATUS_POLL_INTERVAL));
  //   }
  // }

  private async submitToolOutputs(
    threadId: string,
    runId: string,
    messages: Message[],
    eventSource: RuntimeEventSource,
  ) {
    let run = await this.openai.beta.threads.runs.retrieve(threadId, runId);
    if (!run.required_action) {
      throw new Error("No tool outputs required");
    }

    // get the required tool call ids
    const toolCallsIds = run.required_action.submit_tool_outputs.tool_calls.map(
      (toolCall) => toolCall.id,
    );

    // search for these tool calls
    const resultMessages = messages.filter(
      (message) =>
        message instanceof ResultMessage && toolCallsIds.includes(message.actionExecutionId),
    ) as ResultMessage[];

    if (toolCallsIds.length != resultMessages.length) {
      throw new Error("Number of function results does not match the number of tool calls");
    }

    // submit the tool outputs
    const toolOutputs: RunSubmitToolOutputsStreamParams.ToolOutput[] = resultMessages.map(
      (message) => {
        return {
          tool_call_id: message.actionExecutionId,
          output: message.result,
        };
      },
    );

    const stream = this.openai.beta.threads.runs.submitToolOutputsStream(threadId, runId, {
      tool_outputs: toolOutputs,
    });

    await this.streamResponse(stream, eventSource);

    return stream.currentRun();
  }

  private async submitUserMessage(
    threadId: string,
    messages: Message[],
    actions: ActionInput[],
    eventSource: RuntimeEventSource,
  ) {
    messages = [...messages];

    // get the instruction message
    const instructionsMessage = messages.shift();
    const instructions =
      instructionsMessage instanceof TextMessage ? instructionsMessage.content : "";

    // get the latest user message
    const userMessage = messages
      .map(convertMessageToOpenAIMessage)
      .map(convertSystemMessageToAssistantAPI)
      .at(-1);

    if (!(userMessage instanceof TextMessage && userMessage.role === "user")) {
      throw new Error("No user message found");
    }

    // create a new message on the thread
    await this.openai.beta.threads.messages.create(threadId, {
      role: "user",
      content: userMessage.content,
    });

    const openaiTools = actions.map(convertActionInputToOpenAITool);

    const tools = [
      ...openaiTools,
      ...(this.codeInterpreterEnabled ? [{ type: "code_interpreter" } as AssistantTool] : []),
      ...(this.fileSearchEnabled ? [{ type: "file_search" } as AssistantTool] : []),
    ];

    // run the thread
    let stream = this.openai.beta.threads.runs.stream(threadId, {
      assistant_id: this.assistantId,
      instructions,
      tools: tools,
    });

    await this.streamResponse(stream, eventSource);

    return stream.currentRun();
  }

  private async streamResponse(stream: AssistantStream, eventSource: RuntimeEventSource) {
    eventSource.stream(async (eventStream$) => {
      for await (const chunk of stream) {
        console.log(chunk);
      }
      eventStream$.complete();
    });
  }
}

// function transformMessages(messages: any[]): any[] {
//   return messages.map((message) => {
//     if (message.role === "system") {
//       return {
//         ...message,
//         role: "user",
//         content:
//           "THE FOLLOWING MESSAGE IS NOT A USER MESSAGE. IT IS A SYSTEM MESSAGE: " + message.content,
//       };
//     }
//     return message;
//   });
// }

// class AssistantSingleChunkReadableStream extends ReadableStream<any> {
//   constructor(
//     content: string,
//     toolCalls?: OpenAI.Beta.Threads.Runs.RequiredActionFunctionToolCall[],
//   ) {
//     super({
//       start(controller) {
//         let tool_calls: any = undefined;
//         if (toolCalls) {
//           tool_calls = toolCalls.map((toolCall, index) => {
//             return {
//               index,
//               id: toolCall.id,
//               function: {
//                 name: toolCall.function.name,
//                 arguments: toolCall.function.arguments,
//               },
//             };
//           });
//         }
//         const chunk: ChatCompletionChunk = {
//           choices: [
//             {
//               delta: {
//                 content: content,
//                 role: "assistant",
//                 tool_calls,
//               },
//             },
//           ],
//         };
//         writeChatCompletionChunk(controller, chunk);
//         writeChatCompletionEnd(controller);

//         controller.close();
//       },
//       cancel() {},
//     });
//   }
// }
