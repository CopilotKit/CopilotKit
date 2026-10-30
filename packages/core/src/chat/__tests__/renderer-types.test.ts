import { describe, it, expect, expectTypeOf } from "vitest";
import { z } from "zod";
import type { Interrupt, RunAgentResult } from "@ag-ui/client";
import { ɵanySchema } from "@copilotkit/shared";
import type { ToolCallStatus } from "../../types";
import type { ɵInterruptEvent } from "../../interrupt-state";
import type {
  ActivityMessageRendererDef,
  CustomMessageRenderProps,
  HumanInTheLoopRenderProps,
  ToolCallRenderProps,
  ToolCallRendererDef,
} from "../renderer-types";
import { INTERRUPT_EVENT_NAME } from "../interrupt-types";
import type { InterruptEvent, InterruptRenderProps } from "../interrupt-types";

interface Weather {
  city: string;
  days: number;
}

const weatherSchema = z.object({ city: z.string(), days: z.number() });

/** The member of a render-props union for one tool call status. */
type PropsAt<TProps, TStatus extends ToolCallStatus> = Extract<
  TProps,
  { status: TStatus }
>;

type WeatherProps = ToolCallRenderProps<Weather>;
type WeatherHitlProps = HumanInTheLoopRenderProps<Weather>;

describe("ToolCallRenderProps", () => {
  it("gives partial args and no result while the call streams", () => {
    type Streaming = PropsAt<WeatherProps, ToolCallStatus.InProgress>;

    expectTypeOf<Streaming["args"]>().toEqualTypeOf<Partial<Weather>>();
    expectTypeOf<Streaming["result"]>().toEqualTypeOf<undefined>();
  });

  it("gives full args and no result while the tool executes", () => {
    type Running = PropsAt<WeatherProps, ToolCallStatus.Executing>;

    expectTypeOf<Running["args"]>().toEqualTypeOf<Weather>();
    expectTypeOf<Running["result"]>().toEqualTypeOf<undefined>();
  });

  it("gives full args and a string result once complete", () => {
    type Done = PropsAt<WeatherProps, ToolCallStatus.Complete>;

    expectTypeOf<Done["args"]>().toEqualTypeOf<Weather>();
    expectTypeOf<Done["result"]>().toEqualTypeOf<string>();
  });
});

describe("HumanInTheLoopRenderProps", () => {
  it("only offers respond while the tool executes", () => {
    type Streaming = PropsAt<WeatherHitlProps, ToolCallStatus.InProgress>;
    type Running = PropsAt<WeatherHitlProps, ToolCallStatus.Executing>;
    type Done = PropsAt<WeatherHitlProps, ToolCallStatus.Complete>;

    expectTypeOf<Streaming["respond"]>().toEqualTypeOf<undefined>();
    expectTypeOf<Running["respond"]>().toEqualTypeOf<
      (result: unknown) => Promise<void>
    >();
    expectTypeOf<Done["respond"]>().toEqualTypeOf<undefined>();
  });

  it("carries the tool description and the registered agent id", () => {
    expectTypeOf<WeatherHitlProps["description"]>().toEqualTypeOf<string>();
    expectTypeOf<WeatherHitlProps["agentId"]>().toEqualTypeOf<
      string | undefined
    >();
  });
});

describe("ToolCallRendererDef", () => {
  it("accepts a schema whose output matches the args type", () => {
    expectTypeOf({
      name: "getWeather",
      args: weatherSchema,
      render: "weather-card",
    }).toExtend<ToolCallRendererDef<Weather, string>>();
  });

  it("rejects a schema whose output does not match the args type", () => {
    const wrongSchema = z.object({ city: z.number() });

    expectTypeOf({
      name: "getWeather",
      args: wrongSchema,
      render: "weather-card",
    }).not.toExtend<ToolCallRendererDef<Weather, string>>();
  });

  it("accepts ɵanySchema as the args of a wildcard renderer", () => {
    expectTypeOf({
      name: "*",
      args: ɵanySchema,
      render: "fallback-card",
    }).toExtend<ToolCallRendererDef<unknown, string>>();
  });

  it("keeps the framework's render type", () => {
    type ComponentLike = (props: ToolCallRenderProps<Weather>) => string;

    expectTypeOf<
      ToolCallRendererDef<Weather, ComponentLike>["render"]
    >().toEqualTypeOf<ComponentLike>();
  });
});

describe("ActivityMessageRendererDef", () => {
  it("ties the content schema output to the content type", () => {
    const planSchema = z.object({ steps: z.array(z.string()) });

    expectTypeOf({
      activityType: "plan",
      content: planSchema,
      render: "plan-card",
    }).toExtend<ActivityMessageRendererDef<{ steps: string[] }, string>>();
    expectTypeOf({
      activityType: "plan",
      content: planSchema,
      render: "plan-card",
    }).not.toExtend<ActivityMessageRendererDef<{ steps: number[] }, string>>();
  });
});

describe("CustomMessageRenderProps", () => {
  it("types the state snapshot as unknown", () => {
    expectTypeOf<
      CustomMessageRenderProps["stateSnapshot"]
    >().toEqualTypeOf<unknown>();
  });
});

describe("interrupt types", () => {
  it("names the legacy interrupt event on_interrupt", () => {
    expect(INTERRUPT_EVENT_NAME).toBe("on_interrupt");
  });

  it("uses the same event shape as the interrupt state machine", () => {
    expectTypeOf<InterruptEvent<Weather>>().toEqualTypeOf<
      ɵInterruptEvent<Weather>
    >();
  });

  it("passes the handler result and both actions to the renderer", () => {
    type Props = InterruptRenderProps<Weather, string>;

    expectTypeOf<Props["result"]>().toEqualTypeOf<string>();
    expectTypeOf<Props["interrupt"]>().toEqualTypeOf<Interrupt | null>();
    expectTypeOf<Props["resolve"]>().returns.toEqualTypeOf<
      Promise<RunAgentResult | void>
    >();
    expectTypeOf<Props["cancel"]>().parameters.toEqualTypeOf<
      [interruptId?: string]
    >();
  });
});
