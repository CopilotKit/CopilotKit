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
 *
 * ─── Removal criteria ────────────────────────────────────────────────────
 * When CopilotKit drops React 17 support:
 *   1. Delete this file.
 *   2. Remove the `reactHasNoExportsField` conditionals in both
 *      packages/react-core/vitest.config.mjs and
 *      packages/a2ui-renderer/vitest.config.mjs (including the
 *      setupFiles entry, the deps.inline: true branch, and the
 *      react/jsx-runtime aliases).
 *   3. Drop the react-version matrix axis in .github/workflows/test_unit.yml.
 *   4. Remove the `use-sync-external-store/shim` usages in:
 *        react-core/src/v2/hooks/{use-render-tool-call,use-threads}.tsx
 *        a2ui-renderer/src/react-renderer/a2ui-react/{adapter,A2uiSurface}.tsx
 *      and their package.json `use-sync-external-store` deps.
 *   5. Revert the version-gated assertions in
 *        src/v2/hooks/__tests__/use-human-in-the-loop.e2e.test.tsx
 *        src/v2/providers/__tests__/CopilotKitProvider.renderCustomMessages.e2e.test.tsx
 *   6. Drop src/test-helpers/render-hook.ts (tests can re-import
 *      renderHook from @testing-library/react v13+) and
 *      src/test-helpers/stub-window-location.ts (inline back to beforeEach).
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
  // NOTE: this polyfill is NOT semantically equivalent to React 18's useId.
  // - The module-scoped counter is never reset between tests, so ids are
  //   stable per mount but not reproducible across runs. Tests must not
  //   assert on specific generated id values when running under R17.
  // - React 18's useId is tree-position-based and SSR-safe; this counter is
  //   mount-order-based and would produce hydration mismatches in SSR. Do
  //   not copy this polyfill into library source.
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
