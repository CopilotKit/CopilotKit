// Type-only assertions. `tsc --noEmit` (`check-types`) is the only reader.
// Same mechanism as `v2/__tests__/headless-type-exports.test-d.ts`.
//
// Pins two contracts:
// 1. The agent generic defaults to `AgentId` / `string`, not `… | undefined`.
//    Optionality lives on `agentId?`, so callers who pass only the args type
//    (`ReactFrontendTool<Args>`, `useFrontendTool<Args>(…)`) still type
//    `agentId` as `AgentId`.
// 2. Indexed access on that optional field is `AgentId | undefined` because of
//    `?`, not because the generic itself includes `undefined`.
import { expectTypeOf } from "vitest";
import type { FrontendTool } from "@copilotkit/core";
import type { AgentId } from "../copilotkit-types";
import type { ReactFrontendTool } from "../frontend-tool";
import type { ReactHumanInTheLoop } from "../human-in-the-loop";
import type { ReactToolCallRenderer } from "../react-tool-call-renderer";
import type { ReactActivityMessageRenderer } from "../react-activity-message-renderer";
import type { ReactCustomMessageRenderer } from "../react-custom-message-renderer";

type Args = { city: string };

type DefaultReactA =
  ReactFrontendTool<Args> extends ReactFrontendTool<infer _T, infer A>
    ? A
    : never;
expectTypeOf<DefaultReactA>().toEqualTypeOf<AgentId>();

type DefaultHitlA =
  ReactHumanInTheLoop<Args> extends ReactHumanInTheLoop<infer _T, infer A>
    ? A
    : never;
expectTypeOf<DefaultHitlA>().toEqualTypeOf<AgentId>();

type DefaultRendererA =
  ReactToolCallRenderer<Args> extends ReactToolCallRenderer<infer _T, infer A>
    ? A
    : never;
expectTypeOf<DefaultRendererA>().toEqualTypeOf<AgentId>();

type DefaultActivityA =
  ReactActivityMessageRenderer<Args> extends ReactActivityMessageRenderer<
    infer _T,
    infer A
  >
    ? A
    : never;
expectTypeOf<DefaultActivityA>().toEqualTypeOf<AgentId>();

type DefaultCustomA =
  ReactCustomMessageRenderer extends ReactCustomMessageRenderer<infer A>
    ? A
    : never;
expectTypeOf<DefaultCustomA>().toEqualTypeOf<AgentId>();

// Manual args type (`ReactFrontendTool<Args>`, `useFrontendTool<Args>(…)`)
// still types agentId as AgentId. The extra `| undefined` is only from `?`.
expectTypeOf<ReactFrontendTool<Args>["agentId"]>().toEqualTypeOf<
  AgentId | undefined
>();
expectTypeOf<FrontendTool<Args>["agentId"]>().toEqualTypeOf<
  string | undefined
>();

expectTypeOf<{
  name: string;
  agentId: string;
}>().toExtend<ReactFrontendTool<Args>>();

expectTypeOf<{
  name: string;
}>().toExtend<ReactFrontendTool<Args>>();
