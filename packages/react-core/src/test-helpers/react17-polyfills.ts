/**
 * React 17 test-environment polyfills.
 *
 * React 17 doesn't ship these APIs, but third-party deps (streamdown, etc.)
 * and some of our own source files call them unconditionally. Polyfill them
 * on the React module so both `React.useId()` and `import { useId } from
 * "react"` resolve at test time.
 *
 * This file is loaded as a vitest `setupFiles` entry only when the installed
 * React has no package `exports` field (i.e. React 17).
 */
import * as React from "react";

type ReactWithMissingApis = typeof React & {
  useId?: () => string;
  useTransition?: () => [boolean, (cb: () => void) => void];
  useDeferredValue?: <T>(value: T) => T;
  useInsertionEffect?: typeof React.useLayoutEffect;
  useSyncExternalStore?: <T>(
    subscribe: (onChange: () => void) => () => void,
    getSnapshot: () => T,
    getServerSnapshot?: () => T,
  ) => T;
};

const ReactAny = React as ReactWithMissingApis;

if (typeof ReactAny.useId !== "function") {
  let counter = 0;
  ReactAny.useId = function useIdPolyfill() {
    const [id] = React.useState(() => `:r${(++counter).toString(36)}:`);
    return id;
  };
}

if (typeof ReactAny.useTransition !== "function") {
  ReactAny.useTransition = function useTransitionPolyfill() {
    return [false, (cb: () => void) => cb()];
  };
}

if (typeof ReactAny.useDeferredValue !== "function") {
  ReactAny.useDeferredValue = function useDeferredValuePolyfill<T>(value: T) {
    return value;
  };
}

if (typeof ReactAny.useInsertionEffect !== "function") {
  // React 17 has no insertion phase; useLayoutEffect is the closest match.
  ReactAny.useInsertionEffect = React.useLayoutEffect;
}

if (typeof ReactAny.useSyncExternalStore !== "function") {
  // Delegate to the official shim which React's own team ships for 17 compat.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const shim = require("use-sync-external-store/shim") as {
    useSyncExternalStore: ReactWithMissingApis["useSyncExternalStore"];
  };
  ReactAny.useSyncExternalStore = shim.useSyncExternalStore;
}
