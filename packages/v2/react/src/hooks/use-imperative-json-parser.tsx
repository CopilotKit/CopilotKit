// Derived from hashbrown/packages/react/src/hooks/use-imperative-json-parser.tsx
// Original: https://github.com/liveloveapp/hashbrown
// License: MIT (see LICENSE-THIRD-PARTY)

import {
  createParserState,
  parseChunk,
  type ParserError,
  type ParserState,
  s,
} from '@copilotkitnext/core/streaming-json';
import { useCallback, useRef, useState } from 'react';

interface JsonParserSession<Output> {
  parserState: ParserState;
  cache: s.FromJsonAstCache | undefined;
  value: Output | undefined;
  error: ParserError | Error | undefined;
}

const createSession = <Output,>(): JsonParserSession<Output> => ({
  parserState: createParserState(),
  cache: undefined,
  value: undefined,
  error: undefined,
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

/**
 * The result object returned by the `useImperativeJsonParser` hook.
 */
export interface UseImperativeJsonParserResult<Output> {
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

  /**
   * Apply a JSON chunk to the parser.
   * @param chunk - The next JSON fragment.
   */
  parseChunk: (chunk: string) => void;

  /**
   * Reset the parser to its initial state.
   */
  reset: () => void;
}

/**
 * A React hook for imperative, chunk-by-chunk streaming JSON parsing.
 *
 * Unlike {@link useJsonParser} which is prop-driven, this hook gives you a
 * `parseChunk` callback so you can feed JSON fragments as they arrive
 * (e.g., from an SSE stream or WebSocket). It maintains internal parser
 * state across calls and optionally resolves typed values against a schema.
 *
 * **With a schema** — the returned `value` is the schema-resolved output,
 * typed according to `s.Infer<Schema>`. Streaming schemas
 * (e.g., `s.streaming.object`) emit partial matches as fields arrive.
 *
 * **Without a schema** — `value` is the raw `resolvedValue` from the parser
 * state.
 *
 * Call `reset()` to discard all parser state and start from scratch.
 *
 * @param schema - An optional schema (from `s.*` or `s.streaming.*`) used
 *   to resolve and type-check the parsed JSON AST.
 * @returns A {@link UseImperativeJsonParserResult} containing `parserState`,
 *   `value`, `error`, `parseChunk`, and `reset`.
 *
 * @example
 * ```tsx
 * import { useImperativeJsonParser } from '@copilotkitnext/react';
 * import { s } from '@copilotkitnext/core/streaming-json';
 *
 * const schema = s.streaming.object('message', {
 *   role: s.string('role'),
 *   content: s.streaming.string('content'),
 * });
 *
 * function StreamingMessage() {
 *   const { value, error, parseChunk, reset } =
 *     useImperativeJsonParser(schema);
 *
 *   useEffect(() => {
 *     const eventSource = new EventSource('/api/stream');
 *     eventSource.onmessage = (e) => parseChunk(e.data);
 *     eventSource.onerror = () => eventSource.close();
 *     return () => {
 *       eventSource.close();
 *       reset();
 *     };
 *   }, [parseChunk, reset]);
 *
 *   if (error) return <div>Error: {error.message}</div>;
 *   if (!value) return <div>Waiting...</div>;
 *
 *   return <p>{value.content}</p>;
 * }
 * ```
 *
 * @example
 * ```tsx
 * // Without a schema — parses raw JSON chunks
 * function RawStream() {
 *   const { value, parseChunk } = useImperativeJsonParser();
 *   // call parseChunk(chunk) as data arrives
 *   return <pre>{JSON.stringify(value, null, 2)}</pre>;
 * }
 * ```
 */
export function useImperativeJsonParser<Schema extends s.SchemaType>(
  schema: Schema,
): UseImperativeJsonParserResult<s.Infer<Schema>>;

/** @internal Overload for schema-less usage. */
export function useImperativeJsonParser<Output = unknown>(
  schema?: s.SchemaType<Output>,
): UseImperativeJsonParserResult<Output> {
  const [session, setSession] = useState<JsonParserSession<Output>>(() =>
    createSession<Output>(),
  );
  const schemaKey = getSchemaKey(schema);
  const schemaKeyRef = useRef(schemaKey);

  const parseChunkHandler = useCallback(
    (chunk: string) => {
      setSession((previous) => {
        const shouldReset = schemaKeyRef.current !== schemaKey;
        if (shouldReset) {
          schemaKeyRef.current = schemaKey;
        }

        const baseSession = shouldReset ? createSession<Output>() : previous;
        const nextParserState = parseChunk(baseSession.parserState, chunk);
        if (nextParserState === baseSession.parserState) {
          return shouldReset ? baseSession : previous;
        }

        if (!schema) {
          const nextError = nextParserState.error ?? undefined;
          const nextValue =
            nextParserState.error === null
              ? getParserResolvedValue<Output>(nextParserState)
              : undefined;
          if (
            nextError === baseSession.error &&
            nextValue === baseSession.value
          ) {
            return {
              ...baseSession,
              parserState: nextParserState,
            };
          }

          return {
            ...baseSession,
            parserState: nextParserState,
            value: nextValue,
            error: nextError,
          };
        }

        const output = s.fromJsonAst(schema, nextParserState, baseSession.cache);
        const result = output.result;
        const isMatch = result.state === 'match';
        const isInvalid = result.state === 'invalid';
        const nextValue = isMatch ? (result.value as Output) : baseSession.value;
        const nextError = resolveSchemaError(
          nextParserState.error,
          isInvalid,
          baseSession.error,
        );
        const nextSession = {
          parserState: nextParserState,
          cache: output.cache,
          value: nextValue,
          error: nextError,
        } satisfies JsonParserSession<Output>;

        if (
          nextSession.cache === baseSession.cache &&
          nextSession.value === baseSession.value &&
          nextSession.error === baseSession.error
        ) {
          return {
            ...baseSession,
            parserState: nextParserState,
          };
        }

        return nextSession;
      });
    },
    [schema],
  );

  const reset = useCallback(() => {
    setSession(createSession());
  }, []);

  return {
    parserState: session.parserState,
    value: session.value,
    error: session.error,
    parseChunk: parseChunkHandler,
    reset,
  };
}
