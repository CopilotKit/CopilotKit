import { AssistantMessage, FunctionCall, JSONValue } from "../types/openai-assistant";

export function encodeResult(result: string): string {
  if (result === undefined) {
    return "";
  } else if (typeof result === "string") {
    return result;
  } else {
    return JSON.stringify(result);
  }
}

export function decodeResult(result: string): any {
  try {
    return JSON.parse(result);
  } catch (e) {
    return result;
  }
}

export interface StreamPart<CODE extends string, NAME extends string, TYPE> {
  code: CODE;
  name: NAME;
  parse: (value: JSONValue) => { type: NAME; value: TYPE };
}

const textStreamPart: StreamPart<"0", "text", string> = {
  code: "0",
  name: "text",
  parse: (value: JSONValue) => {
    if (typeof value !== "string") {
      throw new Error('"text" parts expect a string value.');
    }
    return { type: "text", value };
  },
};

/**
 * This is a utility function that helps in parsing the stream parts.
 * It takes a JSONValue as input and returns an object with type and value.
 * The type is a string that represents the type of the stream part.
 * The value is the actual value of the stream part.
 * If the input value is not a string, it throws an error.
 */
const functionCallStreamPart: StreamPart<"1", "function_call", { function_call: FunctionCall }> = {
  code: "1",
  name: "function_call",
  parse: (value: JSONValue) => {
    if (
      value == null ||
      typeof value !== "object" ||
      !("function_call" in value) ||
      typeof value.function_call !== "object" ||
      value.function_call == null ||
      !("name" in value.function_call) ||
      !("arguments" in value.function_call) ||
      typeof value.function_call.name !== "string" ||
      typeof value.function_call.arguments !== "string"
    ) {
      throw new Error('"function_call" parts expect an object with a "function_call" property.');
    }

    return {
      type: "function_call",
      value: value as unknown as { function_call: FunctionCall },
    };
  },
};

const dataStreamPart: StreamPart<"2", "data", Array<JSONValue>> = {
  code: "2",
  name: "data",
  parse: (value: JSONValue) => {
    if (!Array.isArray(value)) {
      throw new Error('"data" parts expect an array value.');
    }

    return { type: "data", value };
  },
};

const errorStreamPart: StreamPart<"3", "error", string> = {
  code: "3",
  name: "error",
  parse: (value: JSONValue) => {
    if (typeof value !== "string") {
      throw new Error('"error" parts expect a string value.');
    }
    return { type: "error", value };
  },
};

const assistantMessage: StreamPart<"4", "assistant_message", AssistantMessage> = {
  code: "4",
  name: "assistant_message",
  parse: (value: JSONValue) => {
    if (
      value == null ||
      typeof value !== "object" ||
      !("id" in value) ||
      !("role" in value) ||
      !("content" in value) ||
      typeof value.id !== "string" ||
      typeof value.role !== "string" ||
      value.role !== "assistant" ||
      !Array.isArray(value.content) ||
      !value.content.every(
        (item) =>
          item != null &&
          typeof item === "object" &&
          "type" in item &&
          item.type === "text" &&
          "text" in item &&
          item.text != null &&
          typeof item.text === "object" &&
          "value" in item.text &&
          typeof item.text.value === "string",
      )
    ) {
      throw new Error(
        '"assistant_message" parts expect an object with an "id", "role", and "content" property.',
      );
    }

    return {
      type: "assistant_message",
      value: value as AssistantMessage,
    };
  },
};

const assistantControlData: StreamPart<
  "5",
  "assistant_control_data",
  {
    threadId: string;
    messageId: string;
  }
> = {
  code: "5",
  name: "assistant_control_data",
  parse: (value: JSONValue) => {
    if (
      value == null ||
      typeof value !== "object" ||
      !("threadId" in value) ||
      !("messageId" in value) ||
      typeof value.threadId !== "string" ||
      typeof value.messageId !== "string"
    ) {
      throw new Error(
        '"assistant_control_data" parts expect an object with a "threadId" and "messageId" property.',
      );
    }

    return {
      type: "assistant_control_data",
      value: {
        threadId: value.threadId,
        messageId: value.messageId,
      },
    };
  },
};

const streamParts = [
  textStreamPart,
  functionCallStreamPart,
  dataStreamPart,
  errorStreamPart,
  assistantMessage,
  assistantControlData,
] as const;

// union type of all stream parts
type StreamParts =
  | typeof textStreamPart
  | typeof functionCallStreamPart
  | typeof dataStreamPart
  | typeof errorStreamPart
  | typeof assistantMessage
  | typeof assistantControlData;

/**
 * Maps the type of a stream part to its value type.
 */
type StreamPartValueType = {
  [P in StreamParts as P["name"]]: ReturnType<P["parse"]>["value"];
};

export type StreamPartType =
  | ReturnType<typeof textStreamPart.parse>
  | ReturnType<typeof functionCallStreamPart.parse>
  | ReturnType<typeof dataStreamPart.parse>
  | ReturnType<typeof errorStreamPart.parse>
  | ReturnType<typeof assistantMessage.parse>
  | ReturnType<typeof assistantControlData.parse>;

export const streamPartsByCode = {
  [textStreamPart.code]: textStreamPart,
  [functionCallStreamPart.code]: functionCallStreamPart,
  [dataStreamPart.code]: dataStreamPart,
  [errorStreamPart.code]: errorStreamPart,
  [assistantMessage.code]: assistantMessage,
  [assistantControlData.code]: assistantControlData,
} as const;

/**
 * The map of prefixes for data in the stream
 *
 * - 0: Text from the LLM response
 * - 1: (OpenAI) function_call responses
 * - 2: custom JSON added by the user using `Data`
 *
 * Example:
 * ```
 * 0:Vercel
 * 0:'s
 * 0: AI
 * 0: AI
 * 0: SDK
 * 0: is great
 * 0:!
 * 2: { "someJson": "value" }
 * 1: {"function_call": {"name": "get_current_weather", "arguments": "{\\n\\"location\\": \\"Charlottesville, Virginia\\",\\n\\"format\\": \\"celsius\\"\\n}"}}
 *```
 */
export const StreamStringPrefixes = {
  [textStreamPart.name]: textStreamPart.code,
  [functionCallStreamPart.name]: functionCallStreamPart.code,
  [dataStreamPart.name]: dataStreamPart.code,
  [errorStreamPart.name]: errorStreamPart.code,
  [assistantMessage.name]: assistantMessage.code,
  [assistantControlData.name]: assistantControlData.code,
} as const;

export const validCodes = streamParts.map((part) => part.code);

/**
 * Parses a stream part from a string.
 *
 * @param line The string to parse.
 * @returns The parsed stream part.
 * @throws An error if the string cannot be parsed.
 */
export const parseStreamPart = (line: string): StreamPartType => {
  const firstSeparatorIndex = line.indexOf(":");

  if (firstSeparatorIndex === -1) {
    throw new Error("Failed to parse stream string. No separator found.");
  }

  const prefix = line.slice(0, firstSeparatorIndex);

  if (!validCodes.includes(prefix as keyof typeof streamPartsByCode)) {
    throw new Error(`Failed to parse stream string. Invalid code ${prefix}.`);
  }

  const code = prefix as keyof typeof streamPartsByCode;

  const textValue = line.slice(firstSeparatorIndex + 1);
  const jsonValue: JSONValue = JSON.parse(textValue);

  return streamPartsByCode[code].parse(jsonValue);
};

/**
 * Prepends a string with a prefix from the `StreamChunkPrefixes`, JSON-ifies it,
 * and appends a new line.
 *
 * It ensures type-safety for the part type and value.
 */
export function formatStreamPart<T extends keyof StreamPartValueType>(
  type: T,
  value: StreamPartValueType[T],
): StreamString {
  const streamPart = streamParts.find((part) => part.name === type);

  if (!streamPart) {
    throw new Error(`Invalid stream part type: ${type}`);
  }

  return `${streamPart.code}:${JSON.stringify(value)}\n`;
}

export const isStreamStringEqualToType = (
  type: keyof typeof StreamStringPrefixes,
  value: string,
): value is StreamString =>
  value.startsWith(`${StreamStringPrefixes[type]}:`) && value.endsWith("\n");

export type StreamString =
  `${(typeof StreamStringPrefixes)[keyof typeof StreamStringPrefixes]}:${string}\n`;

/**
 * A header sent to the client so it knows how to handle parsing the stream (as a deprecated text response or using the new prefixed protocol)
 */
export const COMPLEX_HEADER = "X-Experimental-Stream-Data";
