import { expectTypeOf, test } from "vitest";
import { defineComponent, type PropType } from "vue";
import {
  useCopilotAction,
  useCopilotReadable,
  useFrontendTool,
} from "../src";
import type {
  CatchAllFrontendActionRenderProps,
  FrontendAction,
  FrontendActionRenderProps,
  FrontendActionWaitRenderProps,
  UseFrontendToolArgs,
} from "../src";
import type { VueToolCallRendererRenderProps } from "../src/v2/types";

test("exports the React-compatible v1 render prop types", () => {
  type CompleteResult = Extract<
    FrontendActionRenderProps,
    { status: "complete" }
  >["result"];
  type WaitResponse = Parameters<
    Extract<FrontendActionWaitRenderProps, { status: "executing" }>["respond"]
  >[0];
  type CatchAllResult = Extract<
    CatchAllFrontendActionRenderProps,
    { status: "complete" }
  >["result"];

  expectTypeOf<CompleteResult>().toBeAny();
  expectTypeOf<WaitResponse>().toBeAny();
  expectTypeOf<CatchAllResult>().toBeAny();
});

test("infers legacy parameter arrays in handlers and inline render props", () => {
  const parameters: [
    { name: "city"; type: "string" },
    { name: "count"; type: "number" },
  ] = [
    { name: "city", type: "string" },
    { name: "count", type: "number" },
  ];

  useCopilotAction({
    name: "lookup",
    parameters,
    handler: ({ city, count }) => {
      expectTypeOf(city).toBeString();
      expectTypeOf(count).toBeNumber();
      return `${city}:${count}`;
    },
    render: (props) => {
      expectTypeOf(props.status).toEqualTypeOf<
        "inProgress" | "executing" | "complete"
      >();
      if (props.status === "complete") {
        expectTypeOf(props.args.city).toBeString();
        expectTypeOf(props.args.count).toBeNumber();
        expectTypeOf(props.result).toBeAny();
      }
      return null;
    },
  });

  useFrontendTool({
    name: "lookup",
    parameters,
    handler: ({ city, count }) => `${city}:${count}`,
    render: (props) => {
      if (props.status === "executing") {
        expectTypeOf(props.args.city).toBeString();
        expectTypeOf(props.args.count).toBeNumber();
        expectTypeOf(props.result).toEqualTypeOf<undefined>();
      }
      return null;
    },
  });
});

test("infers HITL callback props and preserves the exact wait union", () => {
  useCopilotAction({
    name: "wait-for-response-inferred",
    renderAndWaitForResponse: (props) => {
      expectTypeOf(props.status).toEqualTypeOf<
        "inProgress" | "executing" | "complete"
      >();
      if (props.status === "executing") {
        expectTypeOf(props.respond).toBeFunction();
        expectTypeOf(props.handler).toBeFunction();
        expectTypeOf(props.respond("done")).toEqualTypeOf<void>();
      }
      return null;
    },
  });
});

test("accepts correctly typed Vue component renderers", () => {
  type ActionParameters = [
    { name: "city"; type: "string" },
  ];
  type RenderProps = FrontendActionRenderProps<ActionParameters>;
  type WaitProps = FrontendActionWaitRenderProps<ActionParameters>;
  const parameters: ActionParameters = [{ name: "city", type: "string" }];
  const frontendComponent = defineComponent({
    props: {
      args: { type: Object as PropType<RenderProps["args"]>, required: true },
      status: {
        type: String as PropType<RenderProps["status"]>,
        required: true,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- React v1 exposes any results.
      result: { type: null as unknown as PropType<any> },
    },
    setup() {
      return () => null;
    },
  });
  const hitlComponent = defineComponent({
    props: {
      args: { type: Object as PropType<WaitProps["args"]>, required: true },
      status: {
        type: String as PropType<WaitProps["status"]>,
        required: true,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- React v1 exposes any results.
      result: { type: null as unknown as PropType<any> },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- React v1 exposes any callbacks.
      handler: { type: Function as PropType<(result: any) => void> },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- React v1 exposes any callbacks.
      respond: { type: Function as PropType<(result: any) => void> },
    },
    setup() {
      return () => null;
    },
  });

  useCopilotAction({
    name: "component-action",
    available: "enabled",
    parameters,
    render: frontendComponent,
  });
  useCopilotAction({
    name: "component-hitl",
    parameters,
    renderAndWaitForResponse: hitlComponent,
  });
});

test("accepts explicitly typed legacy Vue renderer callbacks", () => {
  type ActionParameters = [{ name: "city"; type: "string" }];
  const parameters: ActionParameters = [{ name: "city", type: "string" }];
  const legacyRender = (
    props: VueToolCallRendererRenderProps<{ city: string }>,
  ) => `${props.name}:${props.toolCallId}`;

  useCopilotAction({
    name: "legacy-renderer",
    available: "enabled",
    parameters,
    handler: ({ city }) => city,
    render: legacyRender,
  });
  useFrontendTool({
    name: "legacy-frontend-tool-renderer",
    parameters,
    render: legacyRender,
  });
});

test("rejects status-specific callback renderers", () => {
  type ExecutingProps = Extract<
    FrontendActionRenderProps,
    { status: "executing" }
  >;
  type ExecutingWaitProps = Extract<
    FrontendActionWaitRenderProps,
    { status: "executing" }
  >;

  const frontendExecutingOnly = (props: ExecutingProps) => {
    expectTypeOf(props.status).toEqualTypeOf<"executing">();
    return null;
  };
  const hitlExecutingOnly = (props: ExecutingWaitProps) => {
    props.respond("done");
    return null;
  };

  useCopilotAction({
    name: "frontend-executing-only",
    available: "enabled",
    // @ts-expect-error render callbacks must accept the complete React union.
    render: frontendExecutingOnly,
  });
  useCopilotAction({
    name: "hitl-executing-only",
    // @ts-expect-error render callbacks must accept the complete React union.
    renderAndWaitForResponse: hitlExecutingOnly,
  });
});

test("rejects Vue components with incompatible v1 props", () => {
  type WrongProps = { requiredByAnotherApi: boolean };
  const wrongComponent = defineComponent<WrongProps>(() => () => null);

  // @ts-expect-error incompatible component props must be rejected.
  useCopilotAction({
    name: "wrong-frontend-component",
    available: "enabled",
    render: wrongComponent,
  });
  // @ts-expect-error incompatible component props must be rejected.
  useCopilotAction({
    name: "wrong-hitl-component",
    renderAndWaitForResponse: wrongComponent,
  });
});

test("accepts the compatibility fields and rejects non-React v1 fields", () => {
  useCopilotAction({
    name: "legacy-action",
    disabled: true,
    pairedAction: "paired",
    handler: () => "done",
  });
  useCopilotReadable({
    description: "legacy-readable",
    value: {},
    parentId: "parent",
    categories: ["category"],
  });

  useCopilotAction({
    name: "agent-action",
    handler: () => "done",
    // @ts-expect-error agentId is not part of the React v1 contract.
    agentId: "agent",
  });
  useFrontendTool({
    name: "agent-tool",
    handler: () => "done",
    // @ts-expect-error agentId is not part of the React v1 contract.
    agentId: "agent",
  });
  // @ts-expect-error HITL actions cannot also provide a handler.
  useCopilotAction({
    name: "invalid-hitl",
    renderAndWaitForResponse: () => null,
    handler: () => "done",
  });

  const undefinedHitl: FrontendAction = {
    name: "undefined-hitl",
    renderAndWaitForResponse: undefined,
    handler: () => "done",
  };
  useCopilotAction(undefinedHitl);

  useCopilotAction({
    name: "invalid-parameterless-handler",
    // @ts-expect-error parameterless handlers cannot require an argument.
    handler: (args: Record<string, unknown>) => args,
  });

  // @ts-expect-error availability is a closed compatibility union.
  useCopilotAction({ name: "invalid-availability", available: "server" });
});

test("preserves structural and generic compatibility around extra fields", () => {
  const structuralAction = {
    name: "structural-action",
    handler: () => "done",
    agentId: "legacy-agent",
  };
  useCopilotAction(structuralAction);
  useFrontendTool(structuralAction);

  function registerAction<A extends FrontendAction>(action: A) {
    useCopilotAction(action);
  }

  function registerTool<A extends UseFrontendToolArgs>(tool: A) {
    useFrontendTool(tool);
  }

  registerAction(structuralAction);
  registerTool(structuralAction);

  const validAction = {
    name: "valid-action",
    handler: () => "done",
  } satisfies FrontendAction;
  useCopilotAction(validAction);

  const intersectedAction: FrontendAction & { tag: string } = {
    name: "intersected-action",
    handler: () => "done",
    tag: "compatibility",
  };
  useCopilotAction(intersectedAction);
});

test("retains the intentional React union constraints", () => {
  type Parameters = [{ name: "city"; type: "string" }];

  // @ts-expect-error FrontendAction is a discriminated union, matching React.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the declaration itself is the compatibility assertion.
  interface ExtendedAction extends FrontendAction<Parameters> {
    tag: string;
  }

  // @ts-expect-error FrontendAction is a discriminated union, matching React.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the declaration itself is the compatibility assertion.
  class ImplementedAction implements FrontendAction<Parameters> {}

  const mutableAction: FrontendAction<Parameters> = {
    name: "mutable-action",
    handler: ({ city }) => city,
  };
  // @ts-expect-error the render route cannot be added after construction.
  mutableAction.renderAndWaitForResponse = () => null;
});

test("preserves readable and HITL callback signatures", () => {
  useCopilotReadable({
    description: "legacy-readable",
    value: { city: "Vienna" },
    convert: (description, value) => {
      expectTypeOf(description).toBeString();
      expectTypeOf(value).toEqualTypeOf<unknown>();
      return JSON.stringify(value);
    },
  });

  useCopilotAction({
    name: "wait-for-response",
    renderAndWaitForResponse: (props: FrontendActionWaitRenderProps) => {
      if (props.status === "executing") {
        const response = props.respond("done");
        expectTypeOf(response).toEqualTypeOf<void>();
      }
      return null;
    },
  });
});
