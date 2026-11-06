// Type-only assertions. A return-type widening cannot be observed by a runtime
// test — TypeScript types are erased, so a `null`-returning render forwards
// identically before and after the widening — which makes this file the only
// real guard. Same mechanism as `v2/__tests__/headless-type-exports.test-d.ts`:
// the `.test-d.ts` basename is outside vitest's `include` globs and the package
// configures no `test.typecheck`, so nothing here executes. `tsc --noEmit`
// (`check-types`) is what reads it, and an `expectTypeOf` failure is a compile
// error.
//
// The assertion is `toEqualTypeOf` — EXACT identity, never assignability. A
// function returning `React.ReactElement` IS assignable to one returning
// `React.ReactElement | null`, so an assignability check would pass against the
// un-widened type and assert nothing.
import { expectTypeOf } from "vitest";
import type React from "react";
import type { useDefaultRenderTool } from "../use-default-render-tool";
import type { DefaultRenderProps } from "../use-default-render-tool";

type DefaultRenderToolConfig = NonNullable<
  Parameters<typeof useDefaultRenderTool>[0]
>;

// A custom catch-all renderer must be allowed to render nothing, so that a
// caller can suppress the built-in default for tool calls it does not handle.
expectTypeOf<DefaultRenderToolConfig["render"]>().toEqualTypeOf<
  ((props: DefaultRenderProps) => React.ReactElement | null) | undefined
>();
