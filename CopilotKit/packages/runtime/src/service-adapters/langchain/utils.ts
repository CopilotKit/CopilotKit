import { ActionExecutionMessage, Message, ResultMessage, TextMessage } from "@copilotkit/shared";
import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { z } from "zod";
import { ActionInput } from "../../graphql/inputs/action.input";

export function convertMessageToLangchainMessage(message: Message): BaseMessage {
  if (message instanceof TextMessage) {
    if (message.role == "user") {
      return new HumanMessage(message.content);
    } else if (message.role == "assistant") {
      return new AIMessage(message.content);
    } else if (message.role === "system") {
      return new SystemMessage(message.content);
    }
  } else if (message instanceof ActionExecutionMessage) {
    return new AIMessage({
      content: "",
      tool_calls: [
        {
          id: message.id,
          args: message.arguments,
          name: message.name,
        },
      ],
    });
  } else if (message instanceof ResultMessage) {
    return new ToolMessage({
      content: message.result,
      tool_call_id: message.actionExecutionId,
    });
  }
}

export function convertJsonSchemaToZodSchema(jsonSchema: any, required: boolean): z.ZodSchema {
  if (jsonSchema.type === "object") {
    const spec: { [key: string]: z.ZodSchema } = {};
    for (const [key, value] of Object.entries(jsonSchema.properties)) {
      spec[key] = convertJsonSchemaToZodSchema(
        value,
        jsonSchema.required ? jsonSchema.required.includes(key) : false,
      );
    }
    let schema = z.object(spec);
    return !required ? schema.optional() : schema;
  } else if (jsonSchema.type === "string") {
    let schema = z.string().describe(jsonSchema.description);
    return !required ? schema.optional() : schema;
  } else if (jsonSchema.type === "number") {
    let schema = z.number().describe(jsonSchema.description);
    return !required ? schema.optional() : schema;
  } else if (jsonSchema.type === "boolean") {
    let schema = z.boolean().describe(jsonSchema.description);
    return !required ? schema.optional() : schema;
  } else if (jsonSchema.type === "array") {
    let itemSchema = convertJsonSchemaToZodSchema(jsonSchema.items, false);
    let schema = z.array(itemSchema);
    return !required ? schema.optional() : schema;
  }
}

export function convertActionInputToLangchainTool(actionInput: ActionInput): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: actionInput.name,
    description: actionInput.description,
    schema: convertJsonSchemaToZodSchema(
      JSON.parse(actionInput.jsonSchema),
      false,
    ) as z.ZodObject<any>,
    func: async () => {
      return "";
    },
  });
}
