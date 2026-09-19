export type JsonTokenType =
  | "plain"
  | "key"
  | "string"
  | "number"
  | "boolean"
  | "null";

export type JsonToken = Readonly<{
  text: string;
  type: JsonTokenType;
}>;

const JSON_TOKEN_PATTERN =
  /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(?:\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g;

export function tokenizeJson(json: string): readonly JsonToken[] {
  const tokens: JsonToken[] = [];
  let lastIndex = 0;

  for (const match of json.matchAll(JSON_TOKEN_PATTERN)) {
    const index = match.index;
    if (index > lastIndex) {
      tokens.push({ text: json.slice(lastIndex, index), type: "plain" });
    }

    const text = match[0];
    let type: JsonTokenType = "number";
    if (text.startsWith('"')) {
      type = text.trimEnd().endsWith(":") ? "key" : "string";
    } else if (text === "true" || text === "false") {
      type = "boolean";
    } else if (text === "null") {
      type = "null";
    }
    tokens.push({ text, type });
    lastIndex = index + text.length;
  }

  if (lastIndex < json.length) {
    tokens.push({ text: json.slice(lastIndex), type: "plain" });
  }
  return tokens;
}
