import React, {
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

/**
 * Internal helpers shared by the tool registration hooks (`useFrontendTool`,
 * `useHumanInTheLoop`, `useComponent`, `useFrontendTools`, `useRenderTool`).
 * Not part of the public API.
 */

const EMPTY_DEPS: ReadonlyArray<unknown> = [];

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Plain data (primitives, plain objects, arrays, dates) compares by value.
 * Everything else (functions, class instances, maps, sets) compares by
 * identity. A cycle inside plain data is safe: a pair already being compared
 * counts as equal for that branch.
 */
function depEqual(a: unknown, b: unknown, seen: Map<object, object>): boolean {
  if (Object.is(a, b)) return true;
  if (
    typeof a !== "object" ||
    typeof b !== "object" ||
    a === null ||
    b === null
  ) {
    return false;
  }
  if (a instanceof Date && b instanceof Date) {
    return Object.is(a.getTime(), b.getTime());
  }
  const aIsArray = Array.isArray(a);
  if (aIsArray !== Array.isArray(b)) return false;
  if (!aIsArray && !(isPlainObject(a) && isPlainObject(b))) return false;

  if (seen.get(a) === b) return true;
  seen.set(a, b);

  if (aIsArray) {
    const left = a as unknown[];
    const right = b as unknown[];
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i++) {
      if (!depEqual(left[i], right[i], seen)) return false;
    }
    return true;
  }

  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  for (const key of leftKeys) {
    if (!Object.prototype.hasOwnProperty.call(right, key)) return false;
    if (!depEqual(left[key], right[key], seen)) return false;
  }
  return true;
}

/** Whether two deps arrays are equal. A change in length is always a change. */
export function depsEqual(
  prev: ReadonlyArray<unknown>,
  next: ReadonlyArray<unknown>,
): boolean {
  if (prev.length !== next.length) return false;
  const seen = new Map<object, object>();
  for (let i = 0; i < prev.length; i++) {
    if (!depEqual(prev[i], next[i], seen)) return false;
  }
  return true;
}

/**
 * Turns a caller's `deps` array into a number that changes exactly when the
 * deps change, by the rules of {@link depsEqual}. Put the number, not the
 * array, in the registration effect's dependency list: that keeps the list a
 * constant length and never serializes a value.
 */
export function useDepsVersion(deps?: ReadonlyArray<unknown>): number {
  const next = deps ?? EMPTY_DEPS;
  const ref = useRef({ deps: next, version: 0 });
  if (ref.current.deps !== next && !depsEqual(ref.current.deps, next)) {
    ref.current = { deps: next, version: ref.current.version + 1 };
  }
  return ref.current.version;
}

type RenderFunction<P> = (props: P) => React.ReactNode;
type AnyRender<P> = React.ComponentType<P> | RenderFunction<P>;

function isClassComponent(render: unknown): boolean {
  return (
    typeof render === "function" &&
    Boolean(
      (render as { prototype?: { isReactComponent?: unknown } }).prototype
        ?.isReactComponent,
    )
  );
}

const InvokeRender: React.FC<{
  render: AnyRender<any>;
  renderProps: any;
}> = ({ render, renderProps }) => {
  if (typeof render === "function" && !isClassComponent(render)) {
    return <>{(render as RenderFunction<unknown>)(renderProps)}</>;
  }
  return React.createElement(render as React.ComponentType<any>, renderProps);
};

/**
 * Renders a caller-supplied `render` without letting a new function identity
 * remount it. An inline `render: () => ...` is a new function on every parent
 * render; mounting it as a component type would throw away its state (a typed
 * value, focus) each time. A plain function is called instead, so its hooks
 * live in this stable slot.
 *
 * The slot remounts only when the function's source changes, which is when a
 * caller switches to a genuinely different component whose hooks may differ.
 */
export function ToolRenderSlot<P>({
  render,
  renderProps,
}: {
  render: AnyRender<P>;
  renderProps: P;
}): React.ReactElement {
  const ref = useRef<{
    render: unknown;
    source: string;
    generation: number;
  } | null>(null);
  if (ref.current === null) {
    ref.current = { render, source: sourceOf(render), generation: 0 };
  } else if (ref.current.render !== render) {
    const source = sourceOf(render);
    ref.current = {
      render,
      source,
      generation:
        source === ref.current.source
          ? ref.current.generation
          : ref.current.generation + 1,
    };
  }
  return (
    <InvokeRender
      key={ref.current.generation}
      render={render}
      renderProps={renderProps}
    />
  );
}

function sourceOf(render: unknown): string {
  if (typeof render !== "function" || isClassComponent(render)) {
    // Objects (memo, forwardRef) and classes are mounted as components; their
    // identity is the right key.
    return `#${identityKey(render)}`;
  }
  return Function.prototype.toString.call(render);
}

const identityKeys = new WeakMap<object, number>();
let nextIdentityKey = 0;
function identityKey(value: unknown): number {
  if (typeof value !== "object" && typeof value !== "function") return -1;
  if (value === null) return -1;
  let key = identityKeys.get(value);
  if (key === undefined) {
    key = nextIdentityKey++;
    identityKeys.set(value, key);
  }
  return key;
}

type RefreshStore = {
  version: number;
  listeners: Set<() => void>;
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => number;
  refresh: () => void;
};

function createRefreshStore(): RefreshStore {
  const store: RefreshStore = {
    version: 0,
    listeners: new Set(),
    subscribe: (listener) => {
      store.listeners.add(listener);
      return () => store.listeners.delete(listener);
    },
    getSnapshot: () => store.version,
    refresh: () => {
      store.version++;
      for (const listener of store.listeners) listener();
    },
  };
  return store;
}

/**
 * Gives a hook one renderer identity for its whole lifetime. The returned
 * component reads the latest `render` from a ref, so registering it again after
 * a deps change never remounts a tool card that is on screen. Call `refresh`
 * after each registration: every mounted card then re-renders with the latest
 * `render`.
 *
 * Call this before the registration effect, so the ref is current when that
 * effect runs.
 */
export function useStableToolRender<P>(render: AnyRender<P> | undefined): {
  render: React.ComponentType<P> | undefined;
  refresh: () => void;
} {
  const latest = useRef(render);
  useLayoutEffect(() => {
    latest.current = render;
  });

  const [stable] = useState(() => {
    const store = createRefreshStore();
    function StableToolRender(props: P) {
      useSyncExternalStore(
        store.subscribe,
        store.getSnapshot,
        store.getSnapshot,
      );
      const current = latest.current;
      if (!current) return null;
      return <ToolRenderSlot render={current} renderProps={props} />;
    }
    return { Component: StableToolRender, refresh: store.refresh };
  });

  return {
    render: render ? (stable.Component as React.ComponentType<P>) : undefined,
    refresh: stable.refresh,
  };
}
