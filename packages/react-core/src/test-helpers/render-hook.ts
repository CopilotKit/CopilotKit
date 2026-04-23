import { createRequire } from "node:module";
import * as rtl from "@testing-library/react";

type RtlWithRenderHook = typeof rtl & {
  renderHook?: unknown;
};

const rtlWithMaybeRenderHook = rtl as RtlWithRenderHook;

let resolved: unknown = rtlWithMaybeRenderHook.renderHook;

if (!resolved) {
  const localRequire = createRequire(import.meta.url);
  const rth = localRequire("@testing-library/react-hooks") as {
    renderHook: unknown;
  };
  resolved = rth.renderHook;
}

export const renderHook = resolved as NonNullable<RtlWithRenderHook["renderHook"]>;
