import { ref } from "vue";
import type { Meta, StoryObj } from "@storybook/vue3-vite";
import { CopilotChatInput } from "@copilotkit/vue";
import type { ToolsMenuItem } from "@copilotkit/vue";
import { withFakeMicrophone } from "./support/fake-microphone";
import { withCenteredStage, withStyles } from "./support/layouts";

const extractValue = (event: Event) =>
  (event.target as HTMLTextAreaElement).value;

const meta = {
  title: "UI/CopilotChatInput",
  component: CopilotChatInput,
  tags: ["autodocs"],
  decorators: [withCenteredStage],
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof CopilotChatInput>;

export default meta;
type Story = StoryObj<typeof meta>;

// A distinct brand look that still reads in both themes.
const CUSTOM_STYLING_CSS = `
  .custom-chat-input [data-testid='copilot-chat-input-shell'] {
    --brand: oklch(0.51 0.23 277);
    border: 2px solid var(--brand) !important;
    border-radius: 14px !important;
    background: linear-gradient(to right, color-mix(in oklch, var(--brand) 10%, var(--background)), var(--background)) !important;
    box-shadow: 0 4px 10px color-mix(in oklch, var(--brand) 18%, transparent) !important;
  }

  .dark .custom-chat-input [data-testid='copilot-chat-input-shell'] {
    --brand: oklch(0.68 0.16 277);
  }

  .custom-chat-input textarea {
    font-family: var(--story-mono) !important;
    font-size: 14px !important;
  }

  .custom-chat-input [data-testid='copilot-chat-input-add'] {
    border: 1px solid color-mix(in oklch, var(--brand, oklch(0.51 0.23 277)) 35%, transparent) !important;
    color: oklch(0.51 0.23 277) !important;
  }

  .dark .custom-chat-input [data-testid='copilot-chat-input-add'] {
    color: oklch(0.78 0.12 277) !important;
  }

  .custom-chat-input [data-testid='copilot-chat-input-send']:not(:disabled) {
    background: oklch(0.51 0.23 277) !important;
    color: #fff !important;
  }

  .custom-chat-input [data-testid='copilot-chat-input-send']:not(:disabled):hover {
    background: oklch(0.45 0.23 277) !important;
    opacity: 1 !important;
  }
`;

// Hand-rolled controls for the slot and layout stories.
const CUSTOM_CONTROLS_CSS = `
  .demo-send-button {
    display: inline-flex;
    width: 40px;
    height: 40px;
    margin-right: 8px;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: 999px;
    background: oklch(0.58 0.2 277);
    color: #fff;
    font-size: 16px;
    cursor: pointer;
    transition: opacity 150ms;
  }
  .demo-send-button:disabled { opacity: 0.4; cursor: not-allowed; }
  .demo-add-button {
    display: inline-flex;
    width: 36px;
    height: 36px;
    margin-left: 4px;
    align-items: center;
    justify-content: center;
    border: 1px solid color-mix(in oklch, oklch(0.58 0.2 277) 40%, transparent);
    border-radius: 999px;
    background: transparent;
    color: oklch(0.58 0.2 277);
    cursor: pointer;
  }
  .demo-add-button:hover { background: color-mix(in oklch, oklch(0.58 0.2 277) 10%, transparent); }
  .demo-add-button:disabled { opacity: 0.4; cursor: not-allowed; }

  .demo-layout {
    display: flex;
    flex-direction: column;
    gap: 12px;
    border: 1px solid var(--border);
    border-radius: 16px;
    background: var(--card);
    color: var(--card-foreground);
    padding: 16px;
  }
  .demo-layout__top { display: flex; align-items: center; justify-content: space-between; }
  .demo-layout__label { font-size: 14px; font-weight: 500; color: var(--muted-foreground); }
  .demo-layout__bottom { display: flex; align-items: flex-end; gap: 8px; }
  .demo-layout__textarea {
    flex: 1;
    resize: none;
    border: 0;
    background: transparent;
    color: inherit;
    padding: 12px 20px 12px 0;
    font: inherit;
    font-size: 16px;
    line-height: 1.6;
    outline: none;
    overflow: auto;
  }
  .demo-layout__textarea::placeholder { color: var(--muted-foreground); }
  .demo-layout__menu-anchor { position: relative; }
  .demo-layout__menu {
    position: absolute;
    top: 100%;
    right: 0;
    z-index: 30;
    min-width: 220px;
    margin-top: 8px;
    overflow: hidden;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--card);
    box-shadow: 0 10px 30px rgb(0 0 0 / 0.12);
    padding: 4px 0;
  }
  .demo-layout__menu-separator { height: 1px; margin: 4px 0; background: var(--border); }
  .demo-layout__menu-label { padding: 4px 12px; font-size: 12px; font-weight: 600; color: var(--muted-foreground); }
  .demo-layout__menu-item {
    display: block;
    width: 100%;
    border: 0;
    background: transparent;
    color: var(--foreground);
    padding: 8px 12px;
    text-align: left;
    font: inherit;
    font-size: 14px;
    cursor: pointer;
  }
  .demo-layout__menu-item:hover { background: var(--accent); }
`;

export const Default: Story = {
  render: () => ({
    components: { CopilotChatInput },
    setup() {
      const value = ref("");
      return { value };
    },
    template: `
      <CopilotChatInput
        v-model="value"
        :show-disclaimer="false"
        @submit-message="(submitted) => console.log('[Storybook] Submitted:', submitted)"
        @add-file="() => console.log('[Storybook] Add file clicked')"
        @start-transcribe="() => console.log('[Storybook] Start transcribe')"
        @stop="() => console.log('[Storybook] Stop')"
      />
    `,
  }),
};

/** A run in flight: the send button becomes a stop button. */
export const Running: Story = {
  render: () => ({
    components: { CopilotChatInput },
    setup() {
      const value = ref("");
      return { value };
    },
    template: `
      <CopilotChatInput
        v-model="value"
        :is-running="true"
        :show-disclaimer="false"
        @stop="() => console.log('[Storybook] Stop clicked')"
      />
    `,
  }),
};

export const WithMenuItems: Story = {
  render: () => ({
    components: { CopilotChatInput },
    setup() {
      const value = ref("");
      const toolsMenu: (ToolsMenuItem | "-")[] = [
        {
          label: "Insert template",
          action: () => window.alert("Template inserted"),
        },
        "-",
        {
          label: "Advanced",
          items: [
            {
              label: "Summarize selection",
              action: () => window.alert("Summarize action"),
            },
            {
              label: "Tag teammate",
              action: () => window.alert("Tagging teammate"),
            },
          ],
        },
      ];
      return { value, toolsMenu };
    },
    template: `
      <CopilotChatInput
        v-model="value"
        :tools-menu="toolsMenu"
        :show-disclaimer="false"
        @add-file="() => console.log('[Storybook] Add file clicked')"
        @start-transcribe="() => console.log('[Storybook] Start transcribe')"
      />
    `,
  }),
};

export const TranscribeMode: Story = {
  decorators: [withFakeMicrophone],
  parameters: {
    docs: {
      description: {
        story:
          "Recording state. Storybook feeds the recorder a synthetic tone instead of your microphone.",
      },
    },
  },
  render: () => ({
    components: { CopilotChatInput },
    setup() {
      const value = ref("");
      return { value };
    },
    template: `
      <CopilotChatInput
        v-model="value"
        mode="transcribe"
        :show-disclaimer="false"
        @cancel-transcribe="() => console.log('[Storybook] Cancel transcribe')"
        @finish-transcribe="() => console.log('[Storybook] Finish transcribe')"
        @finish-transcribe-with-audio="() => console.log('[Storybook] Finish transcribe with audio')"
      />
    `,
  }),
};

export const CustomButtons: Story = {
  decorators: [withStyles(CUSTOM_CONTROLS_CSS)],
  render: () => ({
    components: { CopilotChatInput },
    setup() {
      const value = ref("");
      return { value };
    },
    template: `
      <CopilotChatInput
        v-model="value"
        :show-disclaimer="false"
        @submit-message="(submitted) => console.log('[Storybook] Submitted:', submitted)"
        @add-file="() => console.log('[Storybook] Add file clicked')"
        @start-transcribe="() => console.log('[Storybook] Start transcribe')"
      >
        <template #send-button="{ disabled, onClick }">
          <button
            type="button"
            class="demo-send-button"
            :disabled="disabled"
            aria-label="Send message"
            @click="onClick"
          >
            ✈️
          </button>
        </template>
        <template #add-menu-button="{ disabled, toggleMenu }">
          <button
            type="button"
            class="demo-add-button"
            :disabled="disabled"
            aria-label="Add"
            @click.stop="toggleMenu"
          >
            <svg
              viewBox="0 0 24 24"
              width="20"
              height="20"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
              aria-hidden="true"
            >
              <path d="M5 12h14" />
              <path d="M12 5v14" />
            </svg>
          </button>
        </template>
      </CopilotChatInput>
    `,
  }),
};

export const PrefilledText: Story = {
  render: () => ({
    components: { CopilotChatInput },
    setup() {
      const value = ref("Hello, this is a prefilled message!");
      return { value };
    },
    template: `
      <CopilotChatInput
        v-model="value"
        :show-disclaimer="false"
        @submit-message="(submitted) => console.log('[Storybook] Submitted:', submitted)"
        @add-file="() => console.log('[Storybook] Add file clicked')"
        @start-transcribe="() => console.log('[Storybook] Start transcribe')"
      />
    `,
  }),
};

export const ExpandedTextarea: Story = {
  render: () => ({
    components: { CopilotChatInput },
    setup() {
      const value = ref(
        "This is a longer message that will cause the textarea to expand to multiple rows.\n\nThe textarea remains beside the add button until a wrap occurs, then moves above the controls.",
      );
      return { value };
    },
    template: `
      <CopilotChatInput
        v-model="value"
        :max-rows="10"
        :show-disclaimer="false"
        @submit-message="(submitted) => console.log('[Storybook] Submitted:', submitted)"
        @add-file="() => console.log('[Storybook] Add file clicked')"
        @start-transcribe="() => console.log('[Storybook] Start transcribe')"
      />
    `,
  }),
};

export const CustomStyling: Story = {
  decorators: [withStyles(CUSTOM_STYLING_CSS)],
  render: () => ({
    components: { CopilotChatInput },
    setup() {
      const value = ref("");
      return { value };
    },
    template: `
      <CopilotChatInput
        class="custom-chat-input"
        v-model="value"
        :show-disclaimer="false"
        @add-file="() => console.log('[Storybook] Add file clicked')"
        @start-transcribe="() => console.log('[Storybook] Start transcribe')"
      />
    `,
  }),
};

export const CustomLayout: Story = {
  decorators: [withStyles(CUSTOM_CONTROLS_CSS)],
  render: () => ({
    components: { CopilotChatInput },
    setup() {
      const value = ref("");
      return { value, extractValue };
    },
    template: `
      <CopilotChatInput
        v-model="value"
        :show-disclaimer="false"
        @add-file="() => console.log('[Storybook] Add file clicked')"
      >
        <template
          #layout="{
            isMultiline,
            value: currentValue,
            disabled,
            placeholder,
            sendDisabled,
            menuOpen,
            menuItems,
            onToggleMenu,
            onMenuAction,
            onUpdateValue,
            onSendClick,
            onKeydown
          }"
        >
          <div class="demo-layout">
            <div class="demo-layout__top">
              <span class="demo-layout__label">
                {{ isMultiline ? "Multiline message" : "Single line message" }}
              </span>
              <div class="demo-layout__menu-anchor">
                <button
                  type="button"
                  class="demo-add-button"
                  aria-label="Add"
                  :disabled="disabled"
                  @click.stop="onToggleMenu"
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="20"
                    height="20"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M5 12h14" />
                    <path d="M12 5v14" />
                  </svg>
                </button>
                <div v-if="menuOpen" class="demo-layout__menu">
                  <template v-for="entry in menuItems" :key="entry.key">
                    <div v-if="entry.type === 'separator'" class="demo-layout__menu-separator" />
                    <div
                      v-else-if="entry.type === 'label'"
                      class="demo-layout__menu-label"
                      :style="{ paddingLeft: (12 + entry.depth * 12) + 'px' }"
                    >
                      {{ entry.label }}
                    </div>
                    <button
                      v-else
                      type="button"
                      class="demo-layout__menu-item"
                      :style="{ paddingLeft: (12 + entry.depth * 12) + 'px' }"
                      @click="onMenuAction(entry.action)"
                    >
                      {{ entry.label }}
                    </button>
                  </template>
                </div>
              </div>
            </div>
            <div class="demo-layout__bottom">
              <textarea
                class="demo-layout__textarea"
                rows="1"
                :value="currentValue"
                :disabled="disabled"
                :placeholder="placeholder"
                @input="onUpdateValue(extractValue($event))"
                @keydown="onKeydown"
              />
              <button
                type="button"
                class="demo-send-button"
                aria-label="Send message"
                :disabled="sendDisabled"
                @click="onSendClick"
              >
                <svg
                  viewBox="0 0 24 24"
                  width="18"
                  height="18"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  aria-hidden="true"
                >
                  <path d="m5 12 7-7 7 7" />
                  <path d="M12 19V5" />
                </svg>
              </button>
            </div>
          </div>
        </template>
      </CopilotChatInput>
    `,
  }),
};

export const ControlledInputExample: Story = {
  render: () => ({
    components: { CopilotChatInput },
    setup() {
      const value = ref("Draft message ready to send.");
      const handleSubmitMessage = (submitted: string) => {
        if (typeof window !== "undefined") {
          window.alert(`Submitted: ${submitted}`);
        }
        value.value = "";
      };
      return { value, handleSubmitMessage };
    },
    template: `
      <CopilotChatInput
        v-model="value"
        :clear-on-submit="false"
        :show-disclaimer="false"
        @submit-message="handleSubmitMessage"
        @add-file="() => console.log('[Storybook] Add file clicked')"
        @start-transcribe="() => console.log('[Storybook] Start transcribe')"
      />
    `,
  }),
};

const markdownDraft = `Can you review this plan? It covers three things:
- migrate the chat to the v2 hooks
- update the [upgrade guide](https://docs.copilotkit.ai)
- link the demo at https://copilotkit.ai`;

/**
 * The composer styles list markers and links as you type, with the syntax
 * dimmed but still editable. Pass `:highlight-markdown="false"` for plain
 * text.
 */
export const MarkdownDraft: Story = {
  render: () => ({
    components: { CopilotChatInput },
    setup() {
      const value = ref(markdownDraft);
      return { value };
    },
    template: `
      <CopilotChatInput
        v-model="value"
        :show-disclaimer="false"
        @submit-message="(submitted) => console.log('[Storybook] Submitted:', submitted)"
        @add-file="() => console.log('[Storybook] Add file clicked')"
        @start-transcribe="() => console.log('[Storybook] Start transcribe')"
      />
    `,
  }),
};

const CONTAINER_WIDTHS = [280, 340, 400, 520];
const WIDTH_DRAFT =
  "Summarize the launch thread and list owners for each open item";

/**
 * The input sizes itself by its container, not the viewport: a single short
 * row while the text fits, the text on its own full-width row once it wraps,
 * and voice input folded into the "+" menu under ~320px.
 */
export const ContainerWidths: Story = {
  decorators: [],
  parameters: { layout: "fullscreen" },
  render: () => ({
    components: { CopilotChatInput },
    setup() {
      const columns = CONTAINER_WIDTHS.map((width) => ({
        width,
        drafts: [ref(""), ref(WIDTH_DRAFT)],
      }));
      return { columns };
    },
    template: `
      <div class="story-widths">
        <div
          v-for="column in columns"
          :key="column.width"
          class="story-widths-column"
          :style="{ width: column.width + 'px' }"
        >
          <div class="story-widths-label">{{ column.width }}px</div>
          <CopilotChatInput
            v-for="(draft, index) in column.drafts"
            :key="index"
            v-model="draft.value"
            :show-disclaimer="false"
            @submit-message="() => {}"
            @start-transcribe="() => {}"
            @add-file="() => {}"
          />
        </div>
      </div>
    `,
  }),
};
