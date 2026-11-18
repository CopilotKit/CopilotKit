import {
  defineComponent,
  h,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  watch,
} from "vue";
import type { PropType } from "vue";
import {
  OPEN_GENERATIVE_UI_ACTIVITY_TYPE,
  ToolCallStatus,
  ɵGENERATE_SANDBOXED_UI_ARGS_SCHEMA,
  ɵOPEN_GENERATIVE_UI_CONTENT_SCHEMA,
  ɵOpenGenerativeUIController,
  ɵPlaceholderCycler,
} from "@copilotkit/core";
import type {
  GenerateSandboxedUiArgs,
  OpenGenerativeUIContent,
} from "@copilotkit/core";
import { useSandboxFunctions } from "../providers/SandboxFunctionsContext";

export type { GenerateSandboxedUiArgs, OpenGenerativeUIContent };

export const OpenGenerativeUIActivityType = OPEN_GENERATIVE_UI_ACTIVITY_TYPE;

/** Validates Open Generative UI activity content (shared with React and Angular). */
export const OpenGenerativeUIContentSchema = ɵOPEN_GENERATIVE_UI_CONTENT_SCHEMA;

/**
 * Schema for the generateSandboxedUi tool call arguments (shared with React
 * and Angular). It also describes the arguments to the model as JSON Schema.
 */
export const GenerateSandboxedUiArgsSchema = ɵGENERATE_SANDBOXED_UI_ARGS_SCHEMA;

/**
 * Renders Open Generative UI content. The core controller throttles the
 * content and runs the websandbox iframes inside the container div.
 */
export const OpenGenerativeUIRenderer = defineComponent({
  name: "OpenGenerativeUIRenderer",
  props: {
    content: {
      type: Object as PropType<OpenGenerativeUIContent>,
      required: true,
    },
  },
  setup(props) {
    const sandboxFunctions = useSandboxFunctions();
    const containerRef = ref<HTMLElement | null>(null);
    const controller = new ɵOpenGenerativeUIController();
    controller.setContent(props.content);
    const state = shallowRef(controller.getState());
    const unsubscribe = controller.subscribe(() => {
      state.value = controller.getState();
    });

    watch(
      () => props.content,
      (content) => controller.setContent(content),
    );
    watch(
      sandboxFunctions,
      (functions) => controller.setSandboxFunctions(functions),
      { immediate: true },
    );
    onMounted(() => controller.setHost(containerRef.value));
    onBeforeUnmount(() => {
      unsubscribe();
      controller.destroy();
    });

    return () => {
      const { phase, height, showSpinner, showOverlay } = state.value;
      const hasVisibleSandbox = phase !== "placeholder";
      return h(
        "div",
        {
          ref: containerRef,
          "data-testid": "open-generative-ui-renderer",
          style: {
            position: "relative",
            width: "100%",
            height: `${height}px`,
            borderRadius: "8px",
            backgroundColor: hasVisibleSandbox ? "transparent" : "#f5f5f5",
            border: hasVisibleSandbox ? "none" : "1px solid #e0e0e0",
            overflow: "hidden",
            display: hasVisibleSandbox ? "block" : "flex",
            alignItems: hasVisibleSandbox ? undefined : "center",
            justifyContent: hasVisibleSandbox ? undefined : "center",
          },
        },
        [
          showOverlay
            ? h(
                "div",
                {
                  "data-testid": "open-generative-ui-progress-overlay",
                  style: {
                    position: "absolute",
                    inset: 0,
                    zIndex: 10,
                    pointerEvents: "all",
                    backgroundColor: "rgba(255, 255, 255, 0.5)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  },
                },
                showSpinner
                  ? [
                      h(
                        "svg",
                        {
                          "data-testid": "open-generative-ui-spinner",
                          width: "48",
                          height: "48",
                          viewBox: "0 0 24 24",
                          fill: "none",
                          style: { animation: "ck-spin 1s linear infinite" },
                        },
                        [
                          h("circle", {
                            cx: "12",
                            cy: "12",
                            r: "10",
                            stroke: "#e0e0e0",
                            "stroke-width": "3",
                          }),
                          h("path", {
                            d: "M12 2a10 10 0 0 1 10 10",
                            stroke: "#999",
                            "stroke-width": "3",
                            "stroke-linecap": "round",
                          }),
                        ],
                      ),
                      h(
                        "style",
                        "@keyframes ck-spin { to { transform: rotate(360deg) } }",
                      ),
                    ]
                  : [],
              )
            : null,
        ],
      );
    };
  },
});

export const OpenGenerativeUIActivityRenderer = defineComponent({
  name: "OpenGenerativeUIActivityRenderer",
  props: {
    activityType: { type: String, required: true },
    content: {
      type: Object as PropType<OpenGenerativeUIContent>,
      required: true,
    },
    message: { type: Object as PropType<unknown>, required: true },
    agent: {
      type: Object as PropType<unknown>,
      required: false,
      default: undefined,
    },
  },
  setup(props) {
    return () => h(OpenGenerativeUIRenderer, { content: props.content });
  },
});

export const OpenGenerativeUIToolRenderer = defineComponent({
  name: "OpenGenerativeUIToolRenderer",
  props: {
    name: { type: String, required: true },
    args: {
      type: Object as PropType<Partial<GenerateSandboxedUiArgs>>,
      required: true,
    },
    status: { type: String as PropType<ToolCallStatus>, required: true },
    result: { type: String as PropType<string | undefined>, required: false },
  },
  setup(props) {
    const cycler = new ɵPlaceholderCycler();
    const message = shallowRef(cycler.getSnapshot().message);
    const unsubscribe = cycler.subscribe(() => {
      message.value = cycler.getSnapshot().message;
    });
    watch(
      () =>
        [
          props.args.placeholderMessages,
          props.status === ToolCallStatus.Complete,
        ] as const,
      ([messages, complete]) => cycler.update(messages, complete),
      { immediate: true },
    );
    onBeforeUnmount(() => {
      unsubscribe();
      cycler.dispose();
    });

    return () => {
      // Nothing once complete — the activity renderer handles the UI.
      if (message.value === undefined) return null;
      return h(
        "div",
        {
          style: { padding: "8px 12px", color: "#999", fontSize: "14px" },
          "data-testid": "open-generative-ui-tool-placeholder",
        },
        message.value,
      );
    };
  },
});
