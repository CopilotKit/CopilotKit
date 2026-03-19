// Derived from hashbrown/packages/react/src/hooks/use-json-parser.tsx
// Original: https://github.com/liveloveapp/hashbrown
// License: MIT (see LICENSE-THIRD-PARTY)

import {
  createParserState,
  parseChunk,
  type ParserError,
  type ParserState,
  s,
} from '@copilotkitnext/core/streaming-json';
import { useMemo, useRef } from 'react';

interface JsonParserSession<Output> {
  parserState: ParserState;
  cache: s.FromJsonAstCache | undefined;
  value: Output | undefined;
  error: ParserError | Error | undefined;
  json: string;
  schemaKey: string | null;
}

const createSession = <Output,>(): JsonParserSession<Output> => ({
  parserState: createParserState(),
  cache: undefined,
  value: undefined,
  error: undefined,
  json: '',
  schemaKey: null,
});

function getSchemaKey(schema?: s.SchemaType<unknown>) {
  if (!schema) {
    return null;
  }

  return JSON.stringify(schema.toJsonSchema());
}

function getParserResolvedValue<Output>(state: ParserState) {
  if (state.error || state.rootId === null) {
    return undefined;
  }

  return state.nodes[state.rootId]?.resolvedValue as Output | undefined;
}

function resolveSchemaError(
  parserError: ParserError | null,
  isInvalid: boolean,
  previousError: ParserError | Error | undefined,
) {
  if (parserError) {
    return parserError;
  }

  if (!isInvalid) {
    return undefined;
  }

  return previousError ?? new Error('Schema invalid');
}

function resetSession<Output>(schemaKey: string | null): JsonParserSession<Output> {
  return {
    ...createSession<Output>(),
    schemaKey,
  };
}

function resolveNextSession<Output>(
  previous: JsonParserSession<Output>,
  json: string,
  schema: s.SchemaType<Output> | undefined,
  schemaKey: string | null,
): JsonParserSession<Output> {
  const schemaChanged = previous.schemaKey !== schemaKey;
  let baseSession = previous;

  if (schemaChanged) {
    baseSession = {
      ...previous,
      cache: undefined,
      value: undefined,
      error: undefined,
      schemaKey,
    };
  }

  let nextParserState = baseSession.parserState;
  let nextCache = baseSession.cache;
  let nextValue = baseSession.value;
  let nextError = baseSession.error;

  if (json !== baseSession.json) {
    if (json.startsWith(baseSession.json)) {
      const chunk = json.slice(baseSession.json.length);
      if (chunk.length > 0) {
        nextParserState = parseChunk(baseSession.parserState, chunk);
      }
    } else {
      const resetState = createParserState();
      nextParserState = json.length > 0 ? parseChunk(resetState, json) : resetState;
      nextCache = undefined;
      nextValue = undefined;
      nextError = undefined;
    }
  }

  if (!schema) {
    nextError = nextParserState.error ?? undefined;
    nextValue =
      nextParserState.error === null
        ? getParserResolvedValue<Output>(nextParserState)
        : undefined;
  } else {
    const output = s.fromJsonAst(schema, nextParserState, nextCache);
    const result = output.result;
    const isMatch = result.state === 'match';
    const isInvalid = result.state === 'invalid';
    if (isMatch) {
      nextValue = result.value as Output;
    }

    nextCache = output.cache;
    nextError = resolveSchemaError(
      nextParserState.error,
      isInvalid,
      nextError,
    );
  }

  return {
    parserState: nextParserState,
    cache: nextCache,
    value: nextValue,
    error: nextError,
    json,
    schemaKey,
  };
}

/**
 * The result object returned by the `useJsonParser` hook.
 */
export interface UseJsonParserResult<Output> {
  /**
   * The current streaming JSON parser state.
   */
  parserState: ParserState;

  /**
   * The latest resolved value produced by the schema or parser state.
   */
  value: Output | undefined;

  /**
   * The current parser or schema error, if any.
   */
  error: ParserError | Error | undefined;
}

/**
 * A React hook for declarative, prop-driven streaming JSON parsing.
 *
 * `useJsonParser` incrementally parses a growing JSON string and optionally
 * resolves typed values against a schema. It is designed for streaming
 * scenarios where the JSON payload arrives chunk by chunk (e.g., from an
 * LLM response). When the `json` prop grows as a prefix extension, parsing
 * resumes from where it left off, avoiding redundant work.
 *
 * **With a schema** — the returned `value` is the schema-resolved output,
 * typed according to `s.Infer<Schema>`. Partial matches are emitted as
 * fields arrive when using streaming schemas (e.g., `s.streaming.object`).
 *
 * **Without a schema** — `value` is the raw `resolvedValue` from the parser
 * state, which reflects whatever JSON structure has been parsed so far.
 *
 * @param json - The full JSON string accumulated so far. As new chunks
 *   arrive, pass the growing concatenation. The hook detects prefix
 *   extensions and only parses the new portion.
 * @param schema - An optional schema (from `s.*` or `s.streaming.*`) used
 *   to resolve and type-check the parsed JSON AST.
 * @returns A {@link UseJsonParserResult} containing `parserState`, `value`,
 *   and `error`.
 *
 * @example
 * ```tsx
 * import { useJsonParser } from '@copilotkitnext/react';
 * import { s } from '@copilotkitnext/core/streaming-json';
 *
 * const schema = s.streaming.object('user', {
 *   name: s.streaming.string('name'),
 *   age: s.number('age'),
 * });
 *
 * function StreamingUser({ json }: { json: string }) {
 *   const { value, error } = useJsonParser(json, schema);
 *
 *   if (error) return <div>Error: {error.message}</div>;
 *   if (!value) return <div>Waiting for data...</div>;
 *
 *   return (
 *     <div>
 *       <p>Name: {value.name}</p>
 *       {value.age !== undefined && <p>Age: {value.age}</p>}
 *     </div>
 *   );
 * }
 * ```
 *
 * @example
 * ```tsx
 * // Without a schema — parses raw JSON
 * function RawJson({ json }: { json: string }) {
 *   const { value, parserState } = useJsonParser(json);
 *   return <pre>{JSON.stringify(value, null, 2)}</pre>;
 * }
 * ```
 */
export function useJsonParser<Schema extends s.SchemaType>(
  json: string,
  schema: Schema,
): UseJsonParserResult<s.Infer<Schema>>;

/** @internal Overload for schema-less usage. */
export function useJsonParser<Output = unknown>(
  json: string,
  schema?: s.SchemaType<Output>,
): UseJsonParserResult<Output> {
  const sessionRef = useRef<JsonParserSession<Output> | null>(null);
  const schemaKey = useMemo(() => getSchemaKey(schema), [schema]);

  const session = useMemo(() => {
    const previous = sessionRef.current ?? resetSession<Output>(schemaKey);
    const next = resolveNextSession(previous, json, schema, schemaKey);
    sessionRef.current = next;
    return next;
  }, [json, schema]);

  return {
    parserState: session.parserState,
    value: session.value,
    error: session.error,
  };
}
