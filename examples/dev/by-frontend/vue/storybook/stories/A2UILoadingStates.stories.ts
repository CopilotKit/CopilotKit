import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { defineComponent, h } from "vue";
import { createA2UIMessageRenderer } from "@copilotkit/vue";

/**
 * The pre-paint states of an `a2ui-surface` activity, as React shows them:
 * the A2UI middleware stamps `status` onto the activity content until the
 * surface paints. Each story renders the built-in A2UI activity renderer with
 * one content snapshot.
 */
const renderer = createA2UIMessageRenderer({ theme: {} });

const A2UILifecycle = defineComponent({
  name: "A2UILifecycle",
  props: {
    content: { type: Object, required: true },
  },
  setup(props) {
    return () =>
      // In a chat the renderer sits inside `[data-copilotkit]`, which sets the
      // font and theme; render it the same way here.
      h(
        "div",
        {
          "data-copilotkit": "",
          style: { padding: "1.5rem", maxWidth: "42rem" },
        },
        [
          h(renderer.render as any, {
            activityType: "a2ui-surface",
            content: props.content,
            message: {
              id: "a2ui-story",
              role: "activity",
              activityType: "a2ui-surface",
              content: props.content,
            },
            agent: undefined,
          }),
        ],
      );
  },
});

const meta = {
  title: "A2UI/Loading states",
  component: A2UILifecycle,
} satisfies Meta<typeof A2UILifecycle>;

export default meta;
type Story = StoryObj<typeof meta>;

/** building: the skeleton and a live token count. */
export const Building: Story = {
  args: { content: { status: "building", progressTokens: 240 } },
};

/** retrying: past `showAfterAttempts`, the label says which attempt it is. */
export const Retrying: Story = {
  args: {
    content: {
      status: "retrying",
      attempt: 2,
      maxAttempts: 3,
      progressTokens: 120,
      errors: [{ code: "missing_required_prop", path: "/components/0" }],
    },
  },
};

/** failed: a failure card, with the developer detail in an expander. */
export const Failed: Story = {
  args: {
    content: {
      status: "failed",
      error: "Failed to generate valid A2UI after 3 attempt(s)",
      attempts: [
        { attempt: 1, ok: false, errors: [{ code: "missing_required_prop" }] },
      ],
    },
  },
};
