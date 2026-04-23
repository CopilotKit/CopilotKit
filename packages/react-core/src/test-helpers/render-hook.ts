import { createRequire } from "node:module";
import * as rtl from "@testing-library/react";

type RtlWithRenderHook = typeof rtl & {
  renderHook?: unknown;
};

const rtlWithMaybeRenderHook = rtl as RtlWithRenderHook;

const nativeRenderHook = rtlWithMaybeRenderHook.renderHook as
  | NonNullable<RtlWithRenderHook["renderHook"]>
  | undefined;

type HookResult = { result: { current: unknown; error?: unknown } };

const legacyRenderHook:
  | NonNullable<RtlWithRenderHook["renderHook"]>
  | undefined = nativeRenderHook
  ? undefined
  : (() => {
      // @testing-library/react@12 (React 17 matrix leg) does not export
      // renderHook — that moved into the main package in v13. Fall back to
      // the legacy @testing-library/react-hooks package (already a devDep).
      const localRequire = createRequire(import.meta.url);
      const rth = localRequire("@testing-library/react-hooks") as {
        renderHook: (
          callback: (props: unknown) => unknown,
          options?: unknown,
        ) => HookResult & Record<string, unknown>;
      };
      // Normalize rth.renderHook's behaviour to match RTL v13+: re-throw
      // errors caught during render, so `expect(() => renderHook(...))
      // .toThrow()` still works in the R17 leg.
      const legacy = function legacyRenderHookShim(
        callback: (props: unknown) => unknown,
        options?: unknown,
      ) {
        const hookResult = rth.renderHook(callback, options);
        const err = hookResult.result.error;
        if (err) {
          throw err;
        }
        return hookResult;
      };
      return legacy as NonNullable<RtlWithRenderHook["renderHook"]>;
    })();

export const renderHook = (nativeRenderHook ?? legacyRenderHook) as NonNullable<
  RtlWithRenderHook["renderHook"]
>;
