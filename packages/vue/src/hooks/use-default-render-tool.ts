import { defineComponent, h, ref } from "vue";
import type { WatchSource } from "vue";
import type { Component, VNodeChild } from "vue";
import { useRenderTool } from "./use-render-tool";

type DefaultRenderProps = {
  name: string;
  toolCallId: string;
  parameters: unknown;
  status: "inProgress" | "executing" | "complete";
  result: string | undefined;
};

const DefaultToolCallRenderer = defineComponent({
  props: {
    name: {
      type: String,
      required: true,
    },
    toolCallId: {
      type: String,
      required: true,
    },
    parameters: {
      type: null,
      required: false,
      default: undefined,
    },
    status: {
      type: String as () => "inProgress" | "executing" | "complete",
      required: true,
    },
    result: {
      type: String,
      required: false,
      default: undefined,
    },
  },
  setup(props) {
    const isExpanded = ref(false);

    return () => {
      const isActive =
        props.status === "inProgress" || props.status === "executing";
      const isComplete = props.status === "complete";
      const statusLabel = isActive
        ? "Running"
        : isComplete
          ? "Done"
          : props.status;

      return h("div", { style: { marginTop: "8px", paddingBottom: "8px" } }, [
        h(
          "div",
          {
            style: {
              borderRadius: "12px",
              border: "1px solid #e4e4e7",
              backgroundColor: "#fafafa",
              padding: "14px 16px",
            },
          },
          [
            h(
              "button",
              {
                type: "button",
                onClick: () => {
                  isExpanded.value = !isExpanded.value;
                },
                style: {
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "10px",
                  cursor: "pointer",
                  border: "none",
                  padding: 0,
                  margin: 0,
                  background: "transparent",
                  textAlign: "left",
                },
              },
              [
                h("span", { style: { fontWeight: "600" } }, props.name),
                h("span", statusLabel),
              ],
            ),
            isExpanded.value
              ? h("div", { style: { marginTop: "12px" } }, [
                  h("div", "Arguments"),
                  h("pre", JSON.stringify(props.parameters ?? {}, null, 2)),
                  props.result !== undefined
                    ? h("div", [h("div", "Result"), h("pre", props.result)])
                    : null,
                ])
              : null,
          ],
        ),
      ]);
    };
  },
});

export function useDefaultRenderTool(
  config?: {
    render?:
      | ((props: DefaultRenderProps) => VNodeChild)
      | Component<DefaultRenderProps>;
  },
  deps?: WatchSource<unknown>[],
): void {
  useRenderTool(
    {
      name: "*",
      render:
        config?.render ??
        ((props: DefaultRenderProps) =>
          h(DefaultToolCallRenderer, {
            name: props.name,
            toolCallId: props.toolCallId,
            parameters: props.parameters,
            status: props.status,
            result: props.result,
          })),
    },
    deps,
  );
}
