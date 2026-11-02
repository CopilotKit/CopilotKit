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
import { z } from "zod";
import {
  OPEN_GENERATIVE_UI_ACTIVITY_TYPE,
  ToolCallStatus,
  ɵOpenGenerativeUIController,
} from "@copilotkit/core";
import type {
  GenerateSandboxedUiArgs,
  OpenGenerativeUIContent,
} from "@copilotkit/core";
import { useSandboxFunctions } from "../providers/SandboxFunctionsContext";

export type { GenerateSandboxedUiArgs, OpenGenerativeUIContent };

export const OpenGenerativeUIActivityType = OPEN_GENERATIVE_UI_ACTIVITY_TYPE;

export const OpenGenerativeUIContentSchema = z.object({
  initialHeight: z.number().optional(),
  generating: z.boolean().optional(),
  css: z.string().optional(),
  cssComplete: z.boolean().optional(),
  html: z.array(z.string()).optional(),
  htmlComplete: z.boolean().optional(),
  jsFunctions: z.string().optional(),
  jsFunctionsComplete: z.boolean().optional(),
  jsExpressions: z.array(z.string()).optional(),
  jsExpressionsComplete: z.boolean().optional(),
}) satisfies z.ZodType<OpenGenerativeUIContent>;

export const GenerateSandboxedUiArgsSchema = z.object({
  initialHeight: z.number().optional(),
  placeholderMessages: z.array(z.string()).optional(),
  css: z.string().optional(),
  html: z.string().optional(),
  jsFunctions: z.string().optional(),
  jsExpressions: z.array(z.string()).optional(),
}) satisfies z.ZodType<GenerateSandboxedUiArgs>;

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
      const { phase, generating, height } = state.value;
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
          !hasVisibleSandbox
            ? h("div", { "data-testid": "open-generative-ui-placeholder" }, [
                h(
                  "svg",
                  {
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
              ])
            : null,
          generating
            ? h("div", {
                "data-testid": "open-generative-ui-progress-overlay",
                style: {
                  position: "absolute",
                  inset: 0,
                  backgroundColor: "rgba(255,255,255,0.45)",
                },
              })
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
    const visibleMessageIndex = ref(0);

    watch(
      () => props.args.placeholderMessages,
      (messages, _, onCleanup) => {
        if (!messages?.length || props.status === ToolCallStatus.Complete)
          return;
        visibleMessageIndex.value = Math.max(messages.length - 1, 0);
        const timer = window.setInterval(() => {
          visibleMessageIndex.value =
            (visibleMessageIndex.value + 1) % Math.max(messages.length, 1);
        }, 5000);
        onCleanup(() => window.clearInterval(timer));
      },
      { immediate: true },
    );

    return () => {
      if (props.status === ToolCallStatus.Complete) return null;
      const messages = props.args.placeholderMessages;
      if (!messages?.length) return null;
      const currentMessage = messages[visibleMessageIndex.value] ?? messages[0];
      return h(
        "div",
        {
          style: { padding: "8px 12px", color: "#999", fontSize: "14px" },
          "data-testid": "open-generative-ui-tool-placeholder",
        },
        currentMessage,
      );
    };
  },
});
