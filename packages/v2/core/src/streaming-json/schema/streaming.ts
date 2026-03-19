// Derived from hashbrown/packages/core/src/schema/streaming.ts
// Original: https://github.com/liveloveapp/hashbrown
// License: MIT (see LICENSE-THIRD-PARTY)

/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  ArrayType,
  SchemaType,
  ObjectType,
  StringConstraintsInput,
  StringType,
} from './base';
import { CleanInterfaceShape } from './types';

/**
 * Create a streaming string schema that emits partial content before the closing quote.
 */
export function string(
  description: string,
  constraints?: StringConstraintsInput,
): StringType {
  const normalized = normalizeStringConstraints(constraints);
  return new StringType({
    type: 'string',
    description,
    streaming: true,
    ...normalized,
  });
}

/**
 * Create a streaming object schema that emits fields incrementally.
 */
export function object<Shape extends Record<string, any>>(
  description: string,
  shape: Shape,
): ObjectType<CleanInterfaceShape<Shape>> {
  return new ObjectType({
    type: 'object',
    description,
    streaming: true,
    shape,
  }) as any;
}

function normalizeStringConstraints(constraints?: StringConstraintsInput): {
  pattern?: string;
  format?: StringConstraintsInput['format'];
} {
  if (!constraints) {
    return {};
  }

  const pattern =
    constraints.pattern instanceof RegExp
      ? constraints.pattern.source
      : constraints.pattern;

  return {
    pattern,
    format: constraints.format,
  };
}

/**
 * Create a streaming array schema that emits elements incrementally.
 */
export function array<Item extends SchemaType>(
  description: string,
  item: Item,
  constraints?: { minItems?: number; maxItems?: number },
): ArrayType<Item> {
  return new ArrayType({
    type: 'array',
    description,
    streaming: true,
    element: item,
    ...constraints,
  }) as any;
}
