import { expectTypeOf } from "vitest";
import type {
  CopilotRuntimeOptions,
  OpenGenerativeUIConfig,
  OpenGenerativeUIOptions,
} from "../../index";

// Checked by check-types through the public v2 entry point.
expectTypeOf<OpenGenerativeUIOptions>().toEqualTypeOf<{
  agents?: string[];
}>();
expectTypeOf<OpenGenerativeUIConfig>().toEqualTypeOf<
  boolean | OpenGenerativeUIOptions
>();
expectTypeOf<
  CopilotRuntimeOptions["openGenerativeUI"]
>().toEqualTypeOf<OpenGenerativeUIConfig>();
