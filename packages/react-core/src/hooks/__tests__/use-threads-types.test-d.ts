// Type-only assertions, read by `tsc --noEmit` (`check-types`); vitest does
// not run `.test-d.ts` files here. See `use-default-render-tool-types.test-d.ts`.
//
// React's public `Thread` is core's thread summary, the one Angular exposes,
// so the hooks cannot drift apart. `toEqualTypeOf` checks exact
// identity: a field added to only one side fails to compile.
import { expectTypeOf } from "vitest";
import type { ɵThreadSummary } from "@copilotkit/core";
import type { Thread, UseThreadsResult } from "../use-threads";

expectTypeOf<Thread>().toEqualTypeOf<ɵThreadSummary>();
expectTypeOf<UseThreadsResult["threads"]>().toEqualTypeOf<ɵThreadSummary[]>();
