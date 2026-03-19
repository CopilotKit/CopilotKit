// Based on design from hashbrown/packages/core/src/utils/types.ts
// Original: https://github.com/liveloveapp/hashbrown
// License: MIT (see LICENSE-THIRD-PARTY)

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * A utility type that returns the type it receives as input.
 */
export type Identity<T> = T;

/**
 * A utility type that flattens a given type `T`.
 */
export type Flatten<T> = Identity<{ [k in keyof T]: T[k] }>;

/**
 * Cleans getter-based interface shapes for correct printing.
 */
export type CleanInterfaceShape<T extends object> = Identity<{
  [k in keyof T as k extends `${infer K}?`
    ? K
    : k extends `?${infer K}`
      ? K
      : k]: T[k];
}>;

/**
 * Checks if a type `T` is a union.
 */
export type IsUnion<T, U = T> = T extends any
  ? [U] extends [T]
    ? false
    : true
  : never;

/**
 * Checks if a type is a union of strings.
 */
export type IsStringUnion<T> =
  IsUnion<T> extends true ? (T extends string ? true : false) : false;

/**
 * Converts a union type to an intersection type.
 */
export type UnionToIntersection<U> = (
  U extends any ? (x: U) => any : never
) extends (x: infer I) => any
  ? I
  : never;

/**
 * Returns the last element of a union type.
 */
export type LastOf<T> =
  UnionToIntersection<T extends any ? (x: T) => any : never> extends (
    x: infer L,
  ) => any
    ? L
    : never;

/**
 * Converts a union type to a tuple.
 */
export type UnionToTuple<T, L = LastOf<T>> = [T] extends [never]
  ? []
  : [...UnionToTuple<Exclude<T, L>>, L];
