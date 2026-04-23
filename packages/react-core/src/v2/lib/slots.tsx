import React, { useRef } from "react";
import { twMerge } from "tailwind-merge";

/** Existing union (unchanged) */
export type SlotValue<C extends React.ComponentType<any>> =
  | C
  | string
  | Partial<React.ComponentProps<C>>;

/**
 * Shallow equality comparison for objects.
 */
export function shallowEqual<T extends Record<string, unknown>>(
  obj1: T,
  obj2: T,
): boolean {
  const keys1 = Object.keys(obj1);
  const keys2 = Object.keys(obj2);

  if (keys1.length !== keys2.length) return false;

  for (const key of keys1) {
    if (obj1[key] !== obj2[key]) return false;
  }

  return true;
}

/**
 * Returns true only for plain JS objects (`{}`), excluding arrays, Dates,
 * class instances, and other exotic objects that happen to have typeof "object".
 */
function isPlainObject(obj: unknown): obj is Record<string, unknown> {
  return (
    obj !== null &&
    typeof obj === "object" &&
    Object.prototype.toString.call(obj) === "[object Object]"
  );
}

/**
 * Returns the same reference as long as the value is shallowly equal to the
 * previous render's value.
 *
 * - Identical references bail out immediately (O(1)).
 * - Plain objects ({}) are shallow-compared key-by-key.
 * - Arrays, Dates, class instances, functions, and primitives are compared by
 *   reference only — shallowEqual is never called on non-plain objects, which
 *   avoids incorrect equality for e.g. [1,2] vs [1,2] (different arrays).
 *
 * Typical use: stabilize inline slot props so MemoizedSlotWrapper's shallow
 * equality check isn't defeated by a new object reference on every render.
 */
export function useShallowStableRef<T>(value: T): T {
  const ref = useRef(value);

  // 1. Identical reference — bail early, no comparison needed.
  if (ref.current === value) return ref.current;

  // 2. Both are plain objects — shallow-compare to detect structural equality.
  if (isPlainObject(ref.current) && isPlainObject(value)) {
    if (shallowEqual(ref.current, value)) return ref.current;
  }

  // 3. Different values (or non-comparable types) — update the ref.
  ref.current = value;
  return ref.current;
}

/** Utility: concrete React elements for every slot */
type SlotElements<S> = { [K in keyof S]: React.ReactElement };

export type WithSlots<
  S extends Record<string, React.ComponentType<any>>,
  Rest = {},
> = {
  /** Per‑slot overrides */
  [K in keyof S]?: SlotValue<S[K]>;
} & {
  children?: (props: SlotElements<S> & Rest) => React.ReactNode;
} & Omit<Rest, "children">;

/**
 * Check if a value is a React component type (function, class, forwardRef, memo, etc.)
 */
export function isReactComponentType(
  value: unknown,
): value is React.ComponentType<any> {
  if (typeof value === "function") {
    return true;
  }
  // forwardRef, memo, lazy have $$typeof but are not valid elements
  if (
    value &&
    typeof value === "object" &&
    "$$typeof" in value &&
    !React.isValidElement(value)
  ) {
    return true;
  }
  return false;
}

/**
 * Internal function to render a slot value as a React element (non-memoized).
 */
function renderSlotElement(
  slot: SlotValue<React.ComponentType<any>> | undefined,
  DefaultComponent: React.ComponentType<any>,
  props: Record<string, unknown>,
): React.ReactElement {
  if (typeof slot === "string") {
    // When slot is a string, treat it as a className and merge with existing className
    const existingClassName = props.className as string | undefined;
    return React.createElement(DefaultComponent, {
      ...props,
      className: twMerge(existingClassName, slot),
    });
  }

  // Check if slot is a React component type (function, forwardRef, memo, etc.)
  if (isReactComponentType(slot)) {
    return React.createElement(slot, props);
  }

  // If slot is a plain object (not a React element), treat it as props override
  if (slot && typeof slot === "object" && !React.isValidElement(slot)) {
    const slotKeys = Object.keys(slot);
    const defaultPropKeys = Object.keys(props);
    const recognizedKeys = new Set([...defaultPropKeys, "className", "style", "children", "id"]);
    const hasValidKeys =
      slotKeys.length === 0 || slotKeys.some((key) => recognizedKeys.has(key));

    if (!hasValidKeys) {
      if (process.env.NODE_ENV !== "production") {
        console.warn(
          `[CopilotKit] Slot received a plain object with unrecognized keys: [${slotKeys.join(", ")}]. ` +
            `Expected a React element, component, string, or partial props object. Falling back to defaults.`,
        );
      }
      return React.createElement(DefaultComponent, props);
    }

    return React.createElement(DefaultComponent, {
      ...props,
      ...slot,
    });
  }

  return React.createElement(DefaultComponent, props);
}

/**
 * Internal memoized wrapper component for renderSlot.
 * Uses forwardRef to support ref forwarding.
 */
const MemoizedSlotWrapper = React.memo(
  React.forwardRef<unknown, any>(function MemoizedSlotWrapper(props, ref) {
    const { $slot, $component, ...rest } = props;
    const propsWithRef: Record<string, unknown> =
      ref !== null ? { ...rest, ref } : rest;
    return renderSlotElement($slot, $component, propsWithRef);
  }),
  (prev: any, next: any) => {
    // Compare slot and component references
    if (prev.$slot !== next.$slot) return false;
    if (prev.$component !== next.$component) return false;

    // Shallow compare remaining props (ref is handled separately by React)
    const { $slot: _ps, $component: _pc, ...prevRest } = prev;
    const { $slot: _ns, $component: _nc, ...nextRest } = next;
    return shallowEqual(
      prevRest as Record<string, unknown>,
      nextRest as Record<string, unknown>,
    );
  },
);

/**
 * Renders a slot value as a memoized React element.
 * Automatically prevents unnecessary re-renders using shallow prop comparison.
 * Supports ref forwarding.
 *
 * @example
 * renderSlot(customInput, CopilotChatInput, { onSubmit: handleSubmit })
 */
export function renderSlot<
  C extends React.ComponentType<any>,
  P = React.ComponentProps<C>,
>(
  slot: SlotValue<C> | undefined,
  DefaultComponent: C,
  props: P,
): React.ReactElement {
  return React.createElement(MemoizedSlotWrapper, {
    ...props,
    $slot: slot,
    $component: DefaultComponent,
  } as any);
}
