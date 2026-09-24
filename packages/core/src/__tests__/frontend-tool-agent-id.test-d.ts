// Type-only assertions. `tsc --noEmit` (`check-types`) is the only reader.
// The agent generic on FrontendTool must default to `string`, not
// `string | undefined`. Optionality lives on `agentId?`.
import { expectTypeOf } from "vitest";
import type { FrontendTool } from "../types";

type Args = { city: string };

type DefaultA =
  FrontendTool<Args> extends FrontendTool<infer _T, infer A> ? A : never;
expectTypeOf<DefaultA>().toEqualTypeOf<string>();

expectTypeOf<FrontendTool<Args>["agentId"]>().toEqualTypeOf<
  string | undefined
>();

expectTypeOf<{
  name: string;
  agentId: string;
}>().toExtend<FrontendTool<Args>>();

expectTypeOf<{
  name: string;
}>().toExtend<FrontendTool<Args>>();
