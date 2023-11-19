import { JSONValue } from "../types/openai-assistant";

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
  text: 0,
  function_call: 1,
  data: 2,
  error: 3,
  control_data: 4,
} as const;

/**
 * Prepends a string with a prefix from the `StreamChunkPrefixes`, JSON-ifies it, and appends a new line.
 */
export const getStreamString = (
  type: keyof typeof StreamStringPrefixes,
  value: JSONValue
): StreamString => `${StreamStringPrefixes[type]}:${JSON.stringify(value)}\n`;

export type StreamString =
  `${typeof StreamStringPrefixes[keyof typeof StreamStringPrefixes]}:${string}\n`;

export const getStreamStringTypeAndValue = (
  line: string
): { type: keyof typeof StreamStringPrefixes; value: JSONValue } => {
  const firstSeperatorIndex = line.indexOf(":");

  if (firstSeperatorIndex === -1) {
    throw new Error("Failed to parse stream string");
  }

  const prefix = line.slice(0, firstSeperatorIndex);
  const type = Object.keys(StreamStringPrefixes).find(
    (key) =>
      StreamStringPrefixes[key as keyof typeof StreamStringPrefixes] ===
      Number(prefix)
  ) as keyof typeof StreamStringPrefixes;

  const val = line.slice(firstSeperatorIndex + 1);

  let parsedVal = val;

  if (!val) {
    return { type, value: "" };
  }

  try {
    parsedVal = JSON.parse(val);
  } catch (e) {
    console.error("Failed to parse JSON value:", val);
  }

  return { type, value: parsedVal };
};
