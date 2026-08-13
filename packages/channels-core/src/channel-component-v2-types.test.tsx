import { Button, Section } from "@copilotkit/channels-ui";
import { object, schema, string, streaming } from "@copilotkit/schema";
import { z } from "zod";
import { expect, expectTypeOf, test } from "vitest";
import { defineChannelComponent } from "./channel-component.js";

test("stateful components infer props, state, callback arguments, and binders", () => {
  const component = defineChannelComponent({
    name: "show_order",
    description: "Show one order",
    parameters: z.object({ orderId: z.string() }),
    getInitialState: () => ({ approved: false, attempts: 0 }),
    callbacks: {
      approve(args: { reason: string }, context) {
        expectTypeOf(args).toEqualTypeOf<{ reason: string }>();
        expectTypeOf(context.state).toEqualTypeOf<{
          approved: boolean;
          attempts: number;
        }>();
        expectTypeOf(context.props.orderId).toEqualTypeOf<string>();
        return context.setState((state) => ({
          ...state,
          approved: true,
          attempts: state.attempts + 1,
        }));
      },
    },
    render(context) {
      if (context.phase === "ready") {
        expectTypeOf(context.props.orderId).toEqualTypeOf<string>();
        const onClick = context.callbacks.approve({ reason: "confirmed" });
        return (
          <Button onClick={onClick}>Approve {context.props.orderId}</Button>
        );
      }
      if (context.phase === "failed") {
        // @ts-expect-error failed renders cannot create interactive bindings
        context.callbacks.approve({ reason: "invalid" });
        return <Section>{context.error.message}</Section>;
      }
      throw new Error("Zod schemas use the final-only path");
    },
  });

  expect(component.getInitialState()).toEqual({ approved: false, attempts: 0 });
  expectTypeOf(component.callbacks.approve).parameter(0).toEqualTypeOf<{
    reason: string;
  }>();
});

test("stateless component callbacks do not receive setState", () => {
  const component = defineChannelComponent({
    name: "show_notice",
    description: "Show one notice",
    parameters: z.object({ message: z.string() }),
    callbacks: {
      dismiss(_args: null, context) {
        expectTypeOf(context.state).toEqualTypeOf<undefined>();
        // @ts-expect-error stateless callbacks cannot update component state
        context.setState(undefined);
      },
    },
    render(context) {
      if (context.phase !== "ready") return <Section>Unavailable</Section>;
      return (
        <Button onClick={context.callbacks.dismiss(null)}>
          {context.props.message}
        </Button>
      );
    },
  });

  expect(component.name).toBe("show_notice");
});

test("component render rejects asynchronous output at typecheck time", () => {
  defineChannelComponent({
    name: "invalid_async_render",
    description: "Invalid async render",
    parameters: z.object({ message: z.string() }),
    // @ts-expect-error component rendering is synchronous
    async render() {
      return <Section>Invalid</Section>;
    },
  });

  expect(true).toBe(true);
});

test("CopilotKit schemas infer streamed props without weakening final props", () => {
  defineChannelComponent({
    name: "stream_notice",
    description: "Stream one notice",
    parameters: schema(
      object({
        title: schema(string(), streaming()),
        body: string(),
      }),
      streaming(),
    ),
    render(context) {
      if (context.phase === "streaming") {
        expectTypeOf(context.props.title).toEqualTypeOf<string | undefined>();
        expectTypeOf(context.props.body).toEqualTypeOf<string | undefined>();
        return <Section>{context.props.title ?? "Loading"}</Section>;
      }
      if (context.phase === "ready") {
        expectTypeOf(context.props.title).toEqualTypeOf<string>();
        expectTypeOf(context.props.body).toEqualTypeOf<string>();
        return <Section>{context.props.body}</Section>;
      }
      return <Section>{context.error.message}</Section>;
    },
  });

  expect(true).toBe(true);
});

test("component state and callback arguments reject known non-JSON types", () => {
  // @ts-expect-error component state must be JSON-safe
  defineChannelComponent({
    name: "invalid_state",
    description: "Reject invalid state",
    parameters: z.object({}),
    getInitialState: () => new Date(),
    callbacks: {},
    render: () => <Section>Invalid</Section>,
  });

  expect(true).toBe(true);
});
