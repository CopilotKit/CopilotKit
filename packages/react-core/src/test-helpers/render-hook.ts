import { createRequire } from "node:module";
import type * as React from "react";
import * as rtl from "@testing-library/react";

/**
 * Public signature for the shimmed renderHook. Matches @testing-library/react
 * v13+ / v16 so call sites keep full inference on `result.current`, `rerender`
 * argument types, etc. We don't import RenderHookResult from
 * @testing-library/react because on the R17 matrix leg we resolve to v12,
 * which doesn't export it.
 */
export interface RenderHookResult<Result, Props> {
  rerender: (props?: Props) => void;
  result: { current: Result; error?: unknown };
  unmount: () => void;
}

export interface RenderHookOptions<Props> {
  initialProps?: Props;
  wrapper?: React.ComponentType<{ children?: React.ReactNode }>;
}

type RenderHookFn = <Result, Props>(
  render: (initialProps: Props) => Result,
  options?: RenderHookOptions<Props>,
) => RenderHookResult<Result, Props>;

// Launder the type: under @testing-library/react v16 (the R18/R19 install)
// the module exports renderHook, but under v12 (the R17 install) it does
// not. The runtime check below handles both; we just force TS to treat the
// access as possibly-undefined so the fallback narrows correctly.
const nativeRenderHook = (rtl as { renderHook?: RenderHookFn }).renderHook as
  | RenderHookFn
  | undefined;

type LegacyRenderHookModule = {
  renderHook: <Result, Props>(
    callback: (props: Props) => Result,
    options?: RenderHookOptions<Props>,
  ) => RenderHookResult<Result, Props>;
};

const legacyRenderHook: RenderHookFn | undefined = nativeRenderHook
  ? undefined
  : (() => {
      // @testing-library/react@12 (React 17 matrix leg) does not export
      // renderHook — that moved into the main package in v13. Fall back to
      // the legacy @testing-library/react-hooks package (already a devDep).
      const localRequire = createRequire(import.meta.url);
      const rth = localRequire(
        "@testing-library/react-hooks",
      ) as LegacyRenderHookModule;
      // Normalize rth.renderHook's behaviour to match RTL v13+: re-throw
      // errors caught during render, so `expect(() => renderHook(...))
      // .toThrow()` still works in the R17 leg.
      return function legacyRenderHookShim<Result, Props>(
        callback: (props: Props) => Result,
        options?: RenderHookOptions<Props>,
      ): RenderHookResult<Result, Props> {
        const hookResult = rth.renderHook(callback, options);
        if (hookResult.result.error) {
          throw hookResult.result.error;
        }
        return hookResult;
      };
    })();

export const renderHook: RenderHookFn = (nativeRenderHook ??
  legacyRenderHook) as RenderHookFn;
