import {
  afterEach,
  beforeEach,
  describe,
  expect,
  expectTypeOf,
  it,
  vi,
} from "vitest";
import { defineComponent, h, toRaw } from "vue";
import { z } from "zod";
import type { ActivityMessage } from "@ag-ui/core";
import { useRenderActivityMessage } from "../use-render-activity-message";
import type {
  VueActivityMessageRenderer,
  VueActivityMessageRendererProps,
} from "../../types";
import { renderWithCopilotKit } from "../../__tests__/utils/mount";

const ProgressRenderer = defineComponent({
  props: { content: { type: Object, required: true } },
  setup: () => () => null,
});

const progressSchema = z.object({
  label: z.string(),
  percent: z.number().default(0),
});

// A zod schema is a Standard Schema, so it fits the `content` field, and the
// renderer's content type is the schema's output type.
const progressRenderer = {
  activityType: "progress",
  content: progressSchema,
  render: ProgressRenderer,
} satisfies VueActivityMessageRenderer<z.output<typeof progressSchema>>;

function activityMessage(content: Record<string, unknown>): ActivityMessage {
  return {
    id: "activity-1",
    role: "activity",
    activityType: "progress",
    content,
  };
}

function renderWithProgressRenderer() {
  let helpers: ReturnType<typeof useRenderActivityMessage> | undefined;
  const Probe = defineComponent({
    setup() {
      helpers = useRenderActivityMessage();
      return () => null;
    },
  });

  renderWithCopilotKit(() => h(Probe), {
    providerProps: { renderActivityMessages: [progressRenderer] },
  });

  if (!helpers) throw new Error("useRenderActivityMessage did not run");
  return helpers;
}

describe("useRenderActivityMessage", () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
  });

  it("types a zod content schema's output as the render props content", () => {
    type Props = VueActivityMessageRendererProps<
      z.output<typeof progressSchema>
    >;
    expectTypeOf<Props["content"]>().toEqualTypeOf<{
      label: string;
      percent: number;
    }>();
  });

  it("passes the zod schema's parsed output to the renderer", () => {
    const { renderActivityMessage } = renderWithProgressRenderer();

    const result = renderActivityMessage(activityMessage({ label: "Upload" }));

    // The provider stores renderers in reactive state, so compare the raw value.
    expect(toRaw(result?.renderer)).toBe(ProgressRenderer);
    expect(result?.props.content).toEqual({ label: "Upload", percent: 0 });
  });

  it("returns null and warns when the content fails the schema", () => {
    const { renderActivityMessage } = renderWithProgressRenderer();

    const result = renderActivityMessage(activityMessage({ label: 42 }));

    expect(result).toBeNull();
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      "Failed to validate content for activity message 'progress'.",
    );
  });
});
