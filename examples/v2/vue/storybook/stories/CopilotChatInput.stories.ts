import { onMounted, onUnmounted, ref } from "vue";
import type { Meta, StoryObj } from "@storybook/vue3-vite";
import {
  CopilotChatConfigurationProvider,
  CopilotChatInput,
  type ToolsMenuItem,
} from "@copilotkitnext/vue";

const meta = {
  title: "UI/CopilotChatInput",
  component: CopilotChatInput,
  tags: ["autodocs"],
  decorators: [
    (story) => ({
      components: { story, CopilotChatConfigurationProvider },
      template: `
        <div
          style="
            position: fixed;
            left: 0;
            right: 0;
            bottom: 0;
            display: flex;
            justify-content: center;
            padding: 16px;
          "
        >
          <div style="width: 100%; max-width: 640px">
            <CopilotChatConfigurationProvider thread-id="storybook-thread">
              <story />
            </CopilotChatConfigurationProvider>
          </div>
        </div>
      `,
    }),
  ],
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta<typeof CopilotChatInput>;

export default meta;
type Story = StoryObj<typeof meta>;

const CUSTOM_STYLING_CSS = `
  .custom-chat-input [data-testid='copilot-chat-input-shell'] {
    border: 2px solid #4f46e5 !important;
    border-radius: 14px !important;
    background: linear-gradient(to right, #eef2ff, #ffffff) !important;
    box-shadow: 0 4px 10px rgb(79 70 229 / 0.15) !important;
  }

  .custom-chat-input textarea {
    font-family: 'JetBrains Mono', monospace !important;
    font-size: 14px !important;
  }

  .custom-chat-input [data-testid='copilot-chat-input-add'] {
    border: 1px solid #c7d2fe !important;
    background: #ffffff !important;
    color: #4f46e5 !important;
  }

  .custom-chat-input [data-testid='copilot-chat-input-add']:hover {
    background: #eef2ff !important;
  }

  .custom-chat-input [data-testid='copilot-chat-input-send']:not(:disabled) {
    background: #4f46e5 !important;
    color: #ffffff !important;
  }

  .custom-chat-input [data-testid='copilot-chat-input-send']:not(:disabled):hover {
    background: #4338ca !important;
    opacity: 1 !important;
  }
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
          <div class="mr-2">
            <button
              type="button"
              :disabled="disabled"
              aria-label="Send message"
              class="inline-flex h-10 w-10 items-center justify-center rounded-full bg-indigo-500 text-white transition hover:bg-indigo-600 disabled:opacity-40"
              @click="onClick"
            >
              ✈️
            </button>
          </div>
        </template>
        <template #add-menu-button="{ disabled, toggleMenu }">
          <button
            type="button"
            :disabled="disabled"
            class="ml-1 inline-flex h-9 w-9 items-center justify-center rounded-full border border-indigo-200 bg-white text-indigo-500 hover:bg-indigo-50 disabled:opacity-40"
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
  decorators: [
    (story) => ({
      components: { story },
      setup() {
        let styleElement: HTMLStyleElement | null = null;

        onMounted(() => {
          styleElement = document.createElement("style");
          styleElement.textContent = CUSTOM_STYLING_CSS;
          document.head.appendChild(styleElement);
        });

        onUnmounted(() => {
          styleElement?.remove();
          styleElement = null;
        });
      },
      template: `
        <story />
      `,
    }),
  ],
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
  render: () => ({
    components: { CopilotChatInput },
    setup() {
      const value = ref("");
      const extractValue = (event: Event) =>
        (event.target as HTMLTextAreaElement).value;
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
          <div class="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <div class="flex items-center justify-between">
              <span class="text-sm font-medium text-slate-600">
                {{ isMultiline ? "Multiline message" : "Single line message" }}
              </span>
              <div class="relative">
                <button
                  type="button"
                  class="ml-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-transparent text-[#444444] transition-colors hover:bg-[#f8f8f8] hover:text-[#333333] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent disabled:hover:text-[#444444]"
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
                <div
                  v-if="menuOpen"
                  class="absolute right-0 top-full z-30 mt-2 min-w-[220px] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg"
                >
                  <template v-for="entry in menuItems" :key="entry.key">
                    <div v-if="entry.type === 'separator'" class="my-1 h-px bg-slate-200" />
                    <div
                      v-else-if="entry.type === 'label'"
                      class="px-3 py-1 text-xs font-semibold text-slate-500"
                      :style="{ paddingLeft: (12 + entry.depth * 12) + 'px' }"
                    >
                      {{ entry.label }}
                    </div>
                    <button
                      v-else
                      type="button"
                      class="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
                      :style="{ paddingLeft: (12 + entry.depth * 12) + 'px' }"
                      @click="onMenuAction(entry.action)"
                    >
                      {{ entry.label }}
                    </button>
                  </template>
                </div>
              </div>
            </div>
            <div class="flex items-end gap-2">
              <div class="flex-1">
                <textarea
                  class="w-full resize-none bg-transparent py-3 pr-5 text-[16px] leading-relaxed text-[#171717] antialiased outline-none placeholder:text-[#00000077]"
                  style="overflow: auto"
                  rows="1"
                  :value="currentValue"
                  :disabled="disabled"
                  :placeholder="placeholder"
                  @input="onUpdateValue(extractValue($event))"
                  @keydown="onKeydown"
                />
              </div>
              <button
                type="button"
                class="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-black text-white transition-colors hover:opacity-70 disabled:cursor-not-allowed disabled:opacity-50 disabled:bg-[#00000014] disabled:text-[rgb(13,13,13)] disabled:hover:opacity-100"
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
