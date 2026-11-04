// Type-only assertions, read by `vue-tsc --noEmit` (`check-types`).
//
// Vue's public `Thread` is core's thread summary, the one React and Angular
// expose, so the hooks cannot drift apart. `toEqualTypeOf` checks exact
// identity: a field added to only one side fails to compile.
import { expectTypeOf } from "vitest";
import type { Ref } from "vue";
import type { ɵThreadSummary } from "@copilotkit/core";
import type { Thread, UseThreadsResult } from "../use-threads";

expectTypeOf<Thread>().toEqualTypeOf<ɵThreadSummary>();
expectTypeOf<UseThreadsResult["threads"]>().toEqualTypeOf<
  Ref<ɵThreadSummary[]>
>();
