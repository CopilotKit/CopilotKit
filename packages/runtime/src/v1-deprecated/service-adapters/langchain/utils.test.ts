import { describe, it, expect } from "vitest";
import {
  AIMessage,
  HumanMessage,
  ToolMessage,
} from "@langchain/core/messages";
import { convertMessageToLangChainMessage } from "./utils";
import {
  ActionExecutionMessage,
  ResultMessage,
  TextMessage,
} from "../../graphql/types/converted";
import { MessageRole } from "../../graphql/types/enums";

describe("convertMessageToLangChainMessage", () => {
  it("carries the tool name onto the ToolMessage", () => {
    const converted = convertMessageToLangChainMessage(
      new ResultMessage({
        actionExecutionId: "call-1",
        actionName: "request_page_oncall",
        result: JSON.stringify({ approved: true }),
      }),
    );

    expect(converted).toBeInstanceOf(ToolMessage);
    expect((converted as ToolMessage).name).toBe("request_page_oncall");
  });

  it("leaves tool_call_id and content untouched", () => {
    const converted = convertMessageToLangChainMessage(
      new ResultMessage({
        actionExecutionId: "call-1",
        actionName: "request_page_oncall",
        result: "ok",
      }),
    ) as ToolMessage;

    expect(converted.tool_call_id).toBe("call-1");
    expect(converted.content).toBe("ok");
  });

  it("round-trips the name from the action execution that produced it", () => {
    const execution = new ActionExecutionMessage({
      id: "call-1",
      name: "request_page_oncall",
      arguments: { service: "checkout" },
    });
    const result = new ResultMessage({
      actionExecutionId: execution.id,
      actionName: execution.name,
      result: "ok",
    });

    const convertedExecution = convertMessageToLangChainMessage(
      execution,
    ) as AIMessage;
    const convertedResult = convertMessageToLangChainMessage(
      result,
    ) as ToolMessage;

    // A consumer routing on tool identity should not have to reach back into
    // the assistant message to learn which tool answered.
    expect(convertedResult.name).toBe(convertedExecution.tool_calls?.[0]?.name);
  });

  it("still converts text messages", () => {
    const converted = convertMessageToLangChainMessage(
      new TextMessage({ content: "hi", role: MessageRole.user }),
    );

    expect(converted).toBeInstanceOf(HumanMessage);
    expect(converted.content).toBe("hi");
  });
});
