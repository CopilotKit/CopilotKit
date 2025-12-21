import React from "react";

/** Existing union (unchanged) */
export type SlotValue<C extends React.ComponentType<any>> =
  | C
  | string
  | Partial<React.ComponentProps<C>>;

/**
 * Shallow equality comparison for objects.
 */
export function shallowEqual<T extends Record<string, unknown>>(obj1: T, obj2: T): boolean {
  const keys1 = Object.keys(obj1);
  const keys2 = Object.keys(obj2);

  if (keys1.length !== keys2.length) return false;

  for (const key of keys1) {
    if (obj1[key] !== obj2[key]) return false;
  }

  return true;
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
 * Internal function to render a slot value as a React element (non-memoized).
 */
function renderSlotElement(
  slot: SlotValue<React.ComponentType<any>> | undefined,
  DefaultComponent: React.ComponentType<any>,
  props: Record<string, unknown>
): React.ReactElement {
  if (typeof slot === "string") {
    return React.createElement(DefaultComponent, {
      ...props,
      className: slot,
    });
  }
  if (typeof slot === "function") {
    return React.createElement(slot as React.ComponentType<any>, props);
  }

  if (slot && typeof slot === "object" && !React.isValidElement(slot)) {
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
    const propsWithRef: Record<string, unknown> = ref !== null ? { ...rest, ref } : rest;
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
      nextRest as Record<string, unknown>
    );
  }
);

/**
 * Renders a slot value as a memoized React element.
 * Automatically prevents unnecessary re-renders using shallow prop comparison.
 * Supports ref forwarding.
 *
 * @example
 * renderSlot(customInput, CopilotChatInput, { onSubmit: handleSubmit })
 */
export function renderSlot<C extends React.ComponentType<any>, P = React.ComponentProps<C>>(
  slot: SlotValue<C> | undefined,
  DefaultComponent: C,
  props: P
): React.ReactElement {
  return React.createElement(MemoizedSlotWrapper, {
    ...props,
    $slot: slot,
    $component: DefaultComponent,
  } as any);
}
