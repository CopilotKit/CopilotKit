// Derived from hashbrown/packages/core/src/schema/from-json-ast.ts
// Original: https://github.com/liveloveapp/hashbrown
// License: MIT (see LICENSE-THIRD-PARTY)

import type {
  JsonAstNode,
  JsonResolvedValue,
  ParserError,
} from '../json-parser';
import { internal, PRIMITIVE_WRAPPER_FIELD_NAME } from './constants';
import type {
  FromJsonAstCache,
  FromJsonAstInput,
  FromJsonAstOutput,
  SchemaType,
} from './base';

export const emptyCache: FromJsonAstCache = {
  byNodeId: {},
  byNodeIdAndSchemaId: {},
};

export function ensureCache(cache?: FromJsonAstCache): FromJsonAstCache {
  return cache ?? emptyCache;
}

export function getNode(
  nodes: JsonAstNode[],
  id: number | null,
): JsonAstNode | null {
  if (id === null) {
    return null;
  }

  return nodes[id] ?? null;
}

export function readCacheValue(
  cache: FromJsonAstCache,
  nodeId: number,
  schemaId: number,
  useSchemaId: boolean,
) {
  if (useSchemaId) {
    return cache.byNodeIdAndSchemaId[`${nodeId}:${schemaId}`];
  }

  return cache.byNodeId[nodeId];
}

export function writeCacheValue(
  cache: FromJsonAstCache,
  nodeId: number,
  schemaId: number,
  useSchemaId: boolean,
  value: JsonResolvedValue,
) {
  if (useSchemaId) {
    const key = `${nodeId}:${schemaId}`;
    if (cache.byNodeIdAndSchemaId[key] === value) {
      return cache;
    }

    return {
      ...cache,
      byNodeIdAndSchemaId: { ...cache.byNodeIdAndSchemaId, [key]: value },
    };
  }

  if (cache.byNodeId[nodeId] === value) {
    return cache;
  }

  return {
    ...cache,
    byNodeId: { ...cache.byNodeId, [nodeId]: value },
  };
}

export function reuseCachedArray(
  cached: JsonResolvedValue | undefined,
  nextValues: JsonResolvedValue[],
) {
  if (!Array.isArray(cached) || cached.length !== nextValues.length) {
    return undefined;
  }

  for (let i = 0; i < cached.length; i += 1) {
    if (cached[i] !== nextValues[i]) {
      return undefined;
    }
  }

  return cached;
}

export function reuseCachedObject(
  cached: JsonResolvedValue | undefined,
  nextValues: Record<string, JsonResolvedValue>,
) {
  if (!cached || typeof cached !== 'object' || Array.isArray(cached)) {
    return undefined;
  }

  const cachedKeys = Object.keys(cached);
  const nextKeys = Object.keys(nextValues);
  if (cachedKeys.length !== nextKeys.length) {
    return undefined;
  }

  for (const key of nextKeys) {
    if (
      (cached as Record<string, JsonResolvedValue>)[key] !== nextValues[key]
    ) {
      return undefined;
    }
  }

  return cached as Record<string, JsonResolvedValue>;
}

function createSchemaIdGetter() {
  const schemaIdMap = new WeakMap<SchemaType, number>();
  let nextSchemaId = 1;

  return (schema: SchemaType): number => {
    const existing = schemaIdMap.get(schema);
    if (existing !== undefined) {
      return existing;
    }

    const next = nextSchemaId;
    nextSchemaId += 1;
    schemaIdMap.set(schema, next);
    return next;
  };
}

/**
 * Module-level singleton that assigns a stable numeric ID to each SchemaType instance.
 *
 * This is intentionally a singleton so that schema IDs remain consistent across
 * all calls to `fromJsonAst` and `resolveSchemaAtNode` within the same runtime.
 * The underlying WeakMap ensures IDs are garbage-collected when schemas are.
 */
export const getSchemaId = createSchemaIdGetter();

export function resolveSchemaAtNode<T extends SchemaType>(
  schema: T,
  input: FromJsonAstInput,
  cache: FromJsonAstCache,
  nodeId: number | null,
): FromJsonAstOutput<T[typeof internal]['result']> {
  return schema.fromJsonAst({
    nodes: input.nodes,
    rootId: nodeId,
    error: input.error,
    cache,
    schemaId: getSchemaId(schema),
    schema,
  });
}

export function unwrapPrimitiveWrapper(
  nodes: JsonAstNode[],
  rootId: number | null,
  schemaType: string,
  primitiveWrapperField: string,
): number | null {
  if (rootId === null) {
    return null;
  }

  if (schemaType === 'object' || schemaType === 'node') {
    return rootId;
  }

  const root = nodes[rootId];
  if (!root || root.type !== 'object') {
    return rootId;
  }

  if (root.keys.length !== 1) {
    return rootId;
  }

  if (root.keys[0] !== primitiveWrapperField) {
    return rootId;
  }

  const childId = root.children[0];
  return childId ?? rootId;
}

export function fromJsonAst<T extends SchemaType>(
  schema: T,
  state: {
    nodes: JsonAstNode[];
    rootId: number | null;
    error: ParserError | null;
  },
  cache?: FromJsonAstCache,
): FromJsonAstOutput<T[typeof internal]['result']> {
  const nextCache = ensureCache(cache);

  if (state.error) {
    return { result: { state: 'invalid' }, cache: nextCache };
  }

  const rootId = unwrapPrimitiveWrapper(
    state.nodes,
    state.rootId,
    schema[internal].definition.type,
    PRIMITIVE_WRAPPER_FIELD_NAME,
  );

  return schema.fromJsonAst({
    nodes: state.nodes,
    rootId,
    error: state.error,
    cache: nextCache,
    schemaId: getSchemaId(schema),
    schema,
  });
}
