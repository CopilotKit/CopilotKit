import { expectTypeOf, test } from "vitest";
import {
  createParserState,
  finalizeJsonParse,
  parseChunk,
} from "../streaming.js";
import type {
  JsonAstNode,
  JsonValue,
  ParserOperation,
  StreamingError,
} from "../streaming.js";

test("public parser state and nodes are deeply readonly", () => {
  const state = createParserState();
  expectTypeOf(state.stack).toEqualTypeOf<readonly number[]>();
  expectTypeOf(state.nodes).toEqualTypeOf<readonly JsonAstNode[]>();

  // @ts-expect-error parser state is immutable
  state.mode = "Done";
  // @ts-expect-error parser stacks are immutable
  state.stack.push(1);
  // @ts-expect-error parser nodes are immutable
  state.nodes.push({} as JsonAstNode);
  // @ts-expect-error parser limits are immutable
  state.limits.maxBytes = 1;

  const arrayNode = {} as Extract<JsonAstNode, { type: "array" }>;
  // @ts-expect-error AST children are immutable
  arrayNode.children.push(1);
  // @ts-expect-error AST node fields are immutable
  arrayNode.closed = true;
  // @ts-expect-error resolved arrays are immutable
  arrayNode.resolvedValue?.push("value");

  const objectNode = {} as Extract<JsonAstNode, { type: "object" }>;
  // @ts-expect-error AST object keys are immutable
  objectNode.keys.push("key");
  if (objectNode.resolvedValue) {
    // @ts-expect-error resolved objects are immutable
    objectNode.resolvedValue.key = "value";
  }

  const stringNode = {} as Extract<JsonAstNode, { type: "string" }>;
  // @ts-expect-error AST buffers are immutable
  stringNode.buffer = "changed";

  const error = {} as StreamingError;
  // @ts-expect-error parser errors are immutable
  error.code = "syntax_error";

  const operation = {} as ParserOperation;
  // @ts-expect-error parser operations are immutable
  operation.state = state;
  // @ts-expect-error parser operation errors are immutable
  operation.error = error;

  const value = [] as JsonValue & readonly JsonValue[];
  // @ts-expect-error parsed arrays are immutable
  value.push(null);
});

test("pure parser operations accept and return readonly state", () => {
  const state = createParserState();
  const parsed = parseChunk(state, '{"ready":');
  const finalized = finalizeJsonParse(parsed.state);

  expectTypeOf(parsed).toEqualTypeOf<ParserOperation>();
  expectTypeOf(finalized).toEqualTypeOf<ParserOperation>();
});
