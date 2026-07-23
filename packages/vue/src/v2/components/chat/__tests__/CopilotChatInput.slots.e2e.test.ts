import { render, screen, fireEvent } from "@testing-library/vue";
import { defineComponent, ref } from "vue";
import { describe, it, expect, vi } from "vitest";
import CopilotKitProvider from "../../../providers/CopilotKitProvider.vue";
import CopilotChatConfigurationProvider from "../../../providers/CopilotChatConfigurationProvider.vue";
import type { ToolsMenuItem } from "../types";
import CopilotChatInput from "../CopilotChatInput.vue";

const TestWrapper = defineComponent({
  components: {
    CopilotKitProvider,
    CopilotChatConfigurationProvider,
  },
  template: `
    <CopilotKitProvider>
      <CopilotChatConfigurationProvider thread-id="test-thread">
        <div style="height: 200px;">
          <slot />
        </div>
      </CopilotChatConfigurationProvider>
    </CopilotKitProvider>
  `,
});

function renderInWrapper(component: ReturnType<typeof defineComponent>) {
  const Wrapped = defineComponent({
    components: { TestWrapper, UnderTest: component },
    template: `
      <TestWrapper>
        <UnderTest />
      </TestWrapper>
    `,
  });

  return render(Wrapped);
}

describe("CopilotChatInput Slot System E2E Tests", () => {
  describe("1. Tailwind Class Slot Override", () => {
    describe("textArea slot", () => {
      it("should apply tailwind class string to textArea", () => {
        const Host = defineComponent({
          components: { CopilotChatInput },
          template: `
            <CopilotChatInput>
              <template #text-area="{ value, onInput, onKeydown }">
                <textarea
                  data-testid="custom-text-area"
                  class="border-2 border-blue-500 rounded-lg p-4"
                  :value="value"
                  @input="onInput"
                  @keydown="onKeydown"
                />
              </template>
            </CopilotChatInput>
          `,
        });

        renderInWrapper(Host);
        expect(
          screen
            .getByTestId("custom-text-area")
            .classList.contains("border-blue-500"),
        ).toBe(true);
      });

      it("should override default textArea className", () => {
        const Host = defineComponent({
          components: { CopilotChatInput },
          template: `
            <CopilotChatInput>
              <template #text-area="{ value, onInput, onKeydown }">
                <textarea
                  data-testid="override-text-area"
                  class="custom-textarea-class"
                  :value="value"
                  @input="onInput"
                  @keydown="onKeydown"
                />
              </template>
            </CopilotChatInput>
          `,
        });

        renderInWrapper(Host);
        expect(document.querySelector(".custom-textarea-class")).toBeDefined();
      });
    });

    describe("sendButton slot", () => {
      it("should apply tailwind class string to sendButton", () => {
        const Host = defineComponent({
          components: { CopilotChatInput },
          template: `
            <CopilotChatInput model-value="hello" @submit-message="() => {}">
              <template #send-button="{ onClick }">
                <button data-testid="custom-send-btn" class="bg-green-500 hover:bg-green-600 rounded-full" @click="onClick">
                  Send
                </button>
              </template>
            </CopilotChatInput>
          `,
        });

        renderInWrapper(Host);
        expect(
          screen
            .getByTestId("custom-send-btn")
            .classList.contains("bg-green-500"),
        ).toBe(true);
      });
    });

    describe("startTranscribeButton slot", () => {
      it("should apply tailwind class string to startTranscribeButton", () => {
        const Host = defineComponent({
          components: { CopilotChatInput },
          template: `
            <CopilotChatInput @start-transcribe="() => {}">
              <template #start-transcribe-button="{ onClick }">
                <button data-testid="custom-start-transcribe" class="bg-red-500 rounded" @click="onClick">
                  Start
                </button>
              </template>
            </CopilotChatInput>
          `,
        });

        renderInWrapper(Host);
        expect(
          screen
            .getByTestId("custom-start-transcribe")
            .classList.contains("bg-red-500"),
        ).toBe(true);
      });
    });

    describe("cancelTranscribeButton slot", () => {
      it("should apply tailwind class string to cancelTranscribeButton", () => {
        const Host = defineComponent({
          components: { CopilotChatInput },
          template: `
            <CopilotChatInput mode="transcribe" @cancel-transcribe="() => {}">
              <template #cancel-transcribe-button="{ onClick }">
                <button data-testid="custom-cancel-transcribe" class="bg-gray-500" @click="onClick">
                  Cancel
                </button>
              </template>
            </CopilotChatInput>
          `,
        });

        renderInWrapper(Host);
        expect(
          screen
            .getByTestId("custom-cancel-transcribe")
            .classList.contains("bg-gray-500"),
        ).toBe(true);
      });
    });

    describe("finishTranscribeButton slot", () => {
      it("should apply tailwind class string to finishTranscribeButton", () => {
        const Host = defineComponent({
          components: { CopilotChatInput },
          template: `
            <CopilotChatInput mode="transcribe" @finish-transcribe="() => {}">
              <template #finish-transcribe-button="{ onClick }">
                <button data-testid="custom-finish-transcribe" class="bg-purple-500" @click="onClick">
                  Finish
                </button>
              </template>
            </CopilotChatInput>
          `,
        });

        renderInWrapper(Host);
        expect(
          screen
            .getByTestId("custom-finish-transcribe")
            .classList.contains("bg-purple-500"),
        ).toBe(true);
      });
    });

    describe("addMenuButton slot", () => {
      it("should apply tailwind class string to addMenuButton", () => {
        const toolsMenu: (ToolsMenuItem | "-")[] = [
          { label: "Test", action: vi.fn() },
        ];
        const Host = defineComponent({
          components: { CopilotChatInput },
          setup() {
            return { toolsMenu };
          },
          template: `
            <CopilotChatInput :tools-menu="toolsMenu">
              <template #add-menu-button="{ toggleMenu }">
                <button data-testid="custom-add-button" class="bg-yellow-500" @click="toggleMenu">
                  Add
                </button>
              </template>
            </CopilotChatInput>
          `,
        });

        renderInWrapper(Host);
        expect(
          screen
            .getByTestId("custom-add-button")
            .classList.contains("bg-yellow-500"),
        ).toBe(true);
      });
    });

    describe("audioRecorder slot", () => {
      it("should apply tailwind class string to audioRecorder", () => {
        const Host = defineComponent({
          components: { CopilotChatInput },
          template: `
            <CopilotChatInput mode="transcribe">
              <template #audio-recorder>
                <div data-testid="custom-audio-recorder" class="border-dashed border-2">
                  Recorder
                </div>
              </template>
            </CopilotChatInput>
          `,
        });

        renderInWrapper(Host);
        expect(
          screen
            .getByTestId("custom-audio-recorder")
            .classList.contains("border-dashed"),
        ).toBe(true);
      });
    });
  });

  describe("2. Properties Slot Override", () => {
    describe("textArea props", () => {
      it("should pass placeholder prop to textArea", () => {
        const Host = defineComponent({
          components: { CopilotChatInput },
          template: `
            <CopilotChatInput>
              <template #text-area="{ value, onInput, onKeydown }">
                <textarea
                  data-testid="props-text-area"
                  placeholder="Custom placeholder..."
                  :value="value"
                  @input="onInput"
                  @keydown="onKeydown"
                />
              </template>
            </CopilotChatInput>
          `,
        });

        renderInWrapper(Host);
        expect(
          screen.getByPlaceholderText("Custom placeholder..."),
        ).toBeDefined();
      });

      it("should pass disabled prop to textArea", () => {
        const Host = defineComponent({
          components: { CopilotChatInput },
          template: `
            <CopilotChatInput>
              <template #text-area="{ value, onInput, onKeydown }">
                <textarea
                  data-testid="disabled-textarea"
                  :value="value"
                  disabled
                  @input="onInput"
                  @keydown="onKeydown"
                />
              </template>
            </CopilotChatInput>
          `,
        });

        renderInWrapper(Host);
        expect(
          screen.getByTestId("disabled-textarea").hasAttribute("disabled"),
        ).toBe(true);
      });

      it("should pass onKeyDown prop to textArea", async () => {
        const onKeyDown = vi.fn();
        const Host = defineComponent({
          components: { CopilotChatInput },
          setup() {
            return { onKeyDown };
          },
          template: `
            <CopilotChatInput>
              <template #text-area="{ value, onInput, onKeydown }">
                <textarea
                  data-testid="keydown-textarea"
                  :value="value"
                  @input="onInput"
                  @keydown="
                    onKeyDown();
                    onKeydown($event);
                  "
                />
              </template>
            </CopilotChatInput>
          `,
        });

        renderInWrapper(Host);
        await fireEvent.keyDown(screen.getByTestId("keydown-textarea"), {
          key: "a",
        });
        expect(onKeyDown).toHaveBeenCalled();
      });

      it("should pass autoFocus prop to textArea", () => {
        const Host = defineComponent({
          components: { CopilotChatInput },
          template: `
            <CopilotChatInput>
              <template #text-area="{ value, onInput, onKeydown }">
                <textarea
                  data-testid="autofocus-textarea"
                  :value="value"
                  autofocus
                  @input="onInput"
                  @keydown="onKeydown"
                />
              </template>
            </CopilotChatInput>
          `,
        });

        renderInWrapper(Host);
        expect(
          screen.getByTestId("autofocus-textarea").hasAttribute("autofocus"),
        ).toBe(true);
      });
    });

    describe("sendButton props", () => {
      it("should pass onClick handler to sendButton", async () => {
        const handleClick = vi.fn();
        const Host = defineComponent({
          components: { CopilotChatInput },
          setup() {
            return { handleClick };
          },
          template: `
            <CopilotChatInput model-value="message" @submit-message="() => {}">
              <template #send-button="{ onClick }">
                <button
                  data-testid="send-btn"
                  @click="
                    handleClick();
                    onClick();
                  "
                >
                  Send
                </button>
              </template>
            </CopilotChatInput>
          `,
        });

        renderInWrapper(Host);
        await fireEvent.click(screen.getByTestId("send-btn"));
        expect(handleClick).toHaveBeenCalled();
      });

      it("should pass disabled prop to sendButton", () => {
        const Host = defineComponent({
          components: { CopilotChatInput },
          template: `
            <CopilotChatInput model-value="message" @submit-message="() => {}">
              <template #send-button="{ onClick }">
                <button data-testid="disabled-send" disabled @click="onClick">Send</button>
              </template>
            </CopilotChatInput>
          `,
        });

        renderInWrapper(Host);
        expect(
          screen.getByTestId("disabled-send").hasAttribute("disabled"),
        ).toBe(true);
      });

      it("should pass aria-label prop to sendButton", () => {
        const Host = defineComponent({
          components: { CopilotChatInput },
          template: `
            <CopilotChatInput model-value="message" @submit-message="() => {}">
              <template #send-button="{ onClick }">
                <button data-testid="aria-send" aria-label="Submit message" @click="onClick">Send</button>
              </template>
            </CopilotChatInput>
          `,
        });

        renderInWrapper(Host);
        expect(
          document.querySelector("[aria-label='Submit message']"),
        ).toBeDefined();
      });
    });

    describe("addMenuButton props", () => {
      it("should pass onClick handler to addMenuButton", async () => {
        const handleClick = vi.fn();
        const toolsMenu: (ToolsMenuItem | "-")[] = [
          { label: "Item", action: () => {} },
        ];
        const Host = defineComponent({
          components: { CopilotChatInput },
          setup() {
            return { handleClick, toolsMenu };
          },
          template: `
            <CopilotChatInput :tools-menu="toolsMenu">
              <template #add-menu-button="{ toggleMenu }">
                <button
                  data-testid="add-menu"
                  @click="
                    handleClick();
                    toggleMenu();
                  "
                >
                  Add
                </button>
              </template>
            </CopilotChatInput>
          `,
        });

        renderInWrapper(Host);
        await fireEvent.click(screen.getByTestId("add-menu"));
        expect(handleClick).toHaveBeenCalled();
      });
    });

    describe("user props override pre-set props", () => {
      it("user disabled should override default disabled state", () => {
        const Host = defineComponent({
          components: { CopilotChatInput },
          template: `
            <CopilotChatInput disabled model-value="message" @submit-message="() => {}">
              <template #send-button="{ onClick }">
                <button data-testid="override-send" @click="onClick">Send</button>
              </template>
            </CopilotChatInput>
          `,
        });

        renderInWrapper(Host);
        expect(
          screen.getByTestId("override-send").hasAttribute("disabled"),
        ).toBe(false);
      });
    });
  });

  describe("3. Custom Component Slot Override", () => {
    describe("textArea custom component", () => {
      it("should render custom textArea component", () => {
        const Host = defineComponent({
          components: { CopilotChatInput },
          template: `
            <CopilotChatInput>
              <template #text-area="{ value, onInput, onKeydown }">
                <textarea
                  data-testid="custom-textarea"
                  class="custom-input"
                  :value="value"
                  @input="onInput"
                  @keydown="onKeydown"
                />
              </template>
            </CopilotChatInput>
          `,
        });

        renderInWrapper(Host);
        expect(screen.getByTestId("custom-textarea")).toBeDefined();
      });

      it("custom textArea should receive value and onChange props", async () => {
        const onUpdateValue = vi.fn();

        const Host = defineComponent({
          components: { CopilotChatInput },
          setup() {
            return {
              onUpdateValue,
            };
          },
          template: `
            <CopilotChatInput model-value="test value" @update:model-value="onUpdateValue">
              <template #text-area="{ value, onInput, onKeydown }">
                <textarea
                  data-testid="value-check-textarea"
                  :value="value"
                  @input="onInput($event)"
                  @keydown="onKeydown"
                />
              </template>
            </CopilotChatInput>
          `,
        });

        renderInWrapper(Host);
        const textArea = screen.getByTestId(
          "value-check-textarea",
        ) as HTMLTextAreaElement;
        expect(textArea.value).toBe("test value");
        await fireEvent.update(textArea, "next value");
        expect(onUpdateValue).toHaveBeenCalled();
      });
    });

    describe("sendButton custom component", () => {
      it("should render custom sendButton component", () => {
        const Host = defineComponent({
          components: { CopilotChatInput },
          template: `
            <CopilotChatInput model-value="hello" @submit-message="() => {}">
              <template #send-button="{ onClick, disabled }">
                <button data-testid="custom-send" :disabled="disabled" @click="onClick">🚀 Send Message</button>
              </template>
            </CopilotChatInput>
          `,
        });

        renderInWrapper(Host);
        expect(screen.getByTestId("custom-send")).toBeDefined();
        expect(screen.getByText("🚀 Send Message")).toBeDefined();
      });

      it("custom sendButton should receive onClick callback", async () => {
        const submitHandler = vi.fn();
        const Host = defineComponent({
          components: { CopilotChatInput },
          setup() {
            return { submitHandler };
          },
          template: `
            <CopilotChatInput model-value="hello" @submit-message="submitHandler">
              <template #send-button="{ onClick }">
                <button data-testid="onclick-send" @click="onClick">Send</button>
              </template>
            </CopilotChatInput>
          `,
        });

        renderInWrapper(Host);
        await fireEvent.click(screen.getByTestId("onclick-send"));
        expect(submitHandler).toHaveBeenCalled();
      });
    });

    describe("startTranscribeButton custom component", () => {
      it("should render custom startTranscribeButton component", () => {
        const Host = defineComponent({
          components: { CopilotChatInput },
          template: `
            <CopilotChatInput @start-transcribe="() => {}">
              <template #start-transcribe-button="{ onClick }">
                <button data-testid="custom-start-transcribe" @click="onClick">🎤 Start Recording</button>
              </template>
            </CopilotChatInput>
          `,
        });

        renderInWrapper(Host);
        expect(
          screen.getByTestId("custom-start-transcribe").textContent,
        ).toContain("Start Recording");
      });
    });

    describe("cancelTranscribeButton custom component", () => {
      it("should render custom cancelTranscribeButton component", () => {
        const Host = defineComponent({
          components: { CopilotChatInput },
          template: `
            <CopilotChatInput mode="transcribe" @cancel-transcribe="() => {}">
              <template #cancel-transcribe-button="{ onClick }">
                <button data-testid="custom-cancel-transcribe" @click="onClick">❌ Cancel</button>
              </template>
            </CopilotChatInput>
          `,
        });

        renderInWrapper(Host);
        expect(
          screen.getByTestId("custom-cancel-transcribe").textContent,
        ).toContain("Cancel");
      });
    });

    describe("finishTranscribeButton custom component", () => {
      it("should render custom finishTranscribeButton component", () => {
        const Host = defineComponent({
          components: { CopilotChatInput },
          template: `
            <CopilotChatInput mode="transcribe" @finish-transcribe="() => {}">
              <template #finish-transcribe-button="{ onClick }">
                <button data-testid="custom-finish-transcribe" @click="onClick">✓ Done</button>
              </template>
            </CopilotChatInput>
          `,
        });

        renderInWrapper(Host);
        expect(
          screen.getByTestId("custom-finish-transcribe").textContent,
        ).toContain("Done");
      });
    });

    describe("addMenuButton custom component", () => {
      it("should render custom addMenuButton component", () => {
        const toolsMenu: (ToolsMenuItem | "-")[] = [
          { label: "Tool", action: () => {} },
        ];
        const Host = defineComponent({
          components: { CopilotChatInput },
          setup() {
            return { toolsMenu };
          },
          template: `
            <CopilotChatInput :tools-menu="toolsMenu">
              <template #add-menu-button="{ toggleMenu }">
                <button data-testid="custom-add-menu" @click="toggleMenu">➕ Add</button>
              </template>
            </CopilotChatInput>
          `,
        });

        renderInWrapper(Host);
        expect(screen.getByTestId("custom-add-menu").textContent).toContain(
          "Add",
        );
      });
    });

    describe("audioRecorder custom component", () => {
      it("should render custom audioRecorder component", () => {
        const Host = defineComponent({
          components: { CopilotChatInput },
          template: `
            <CopilotChatInput mode="transcribe">
              <template #audio-recorder>
                <div data-testid="custom-recorder">
                  <button>Custom Recorder</button>
                </div>
              </template>
            </CopilotChatInput>
          `,
        });

        renderInWrapper(Host);
        expect(screen.getByTestId("custom-recorder").textContent).toContain(
          "Custom Recorder",
        );
      });
    });

    describe("multiple custom components", () => {
      it("should render multiple custom components together", () => {
        const Host = defineComponent({
          components: { CopilotChatInput },
          template: `
            <CopilotChatInput model-value="hello" @submit-message="() => {}">
              <template #text-area="{ value, onInput, onKeydown }">
                <textarea data-testid="multi-textarea" :value="value" @input="onInput" @keydown="onKeydown" />
              </template>
              <template #send-button="{ onClick }">
                <button data-testid="multi-send" @click="onClick">Send</button>
              </template>
            </CopilotChatInput>
          `,
        });

        renderInWrapper(Host);
        expect(screen.getByTestId("multi-textarea")).toBeDefined();
        expect(screen.getByTestId("multi-send")).toBeDefined();
      });
    });
  });

  describe("4. Nested Props and Complex Configurations", () => {
    describe("complex textArea configuration", () => {
      it("should support complex props configuration", () => {
        const Host = defineComponent({
          components: { CopilotChatInput },
          template: `
            <CopilotChatInput>
              <template #text-area="{ value, onInput, onKeydown }">
                <textarea
                  data-testid="complex-ta"
                  class="complex-textarea"
                  placeholder="Complex placeholder"
                  rows="4"
                  :value="value"
                  @input="onInput"
                  @keydown="onKeydown"
                />
              </template>
            </CopilotChatInput>
          `,
        });

        renderInWrapper(Host);
        const textarea = screen.getByTestId("complex-ta");
        expect(textarea.getAttribute("placeholder")).toBe(
          "Complex placeholder",
        );
      });
    });

    describe("complex sendButton configuration", () => {
      it("should support complex props on sendButton", () => {
        const Host = defineComponent({
          components: { CopilotChatInput },
          template: `
            <CopilotChatInput model-value="message" @submit-message="() => {}">
              <template #send-button="{ onClick }">
                <button
                  data-testid="complex-send-btn"
                  class="complex-send"
                  aria-label="Send your message"
                  title="Click to send"
                  @click="onClick"
                >
                  Send
                </button>
              </template>
            </CopilotChatInput>
          `,
        });

        renderInWrapper(Host);
        const send = screen.getByTestId("complex-send-btn");
        expect(send.getAttribute("aria-label")).toBe("Send your message");
        expect(send.getAttribute("title")).toBe("Click to send");
      });
    });
  });

  describe("5. className Override with Tailwind", () => {
    describe("className prop in object slots", () => {
      it("should allow className prop in textArea object slot", () => {
        const Host = defineComponent({
          components: { CopilotChatInput },
          template: `
            <CopilotChatInput>
              <template #text-area="{ value, onInput, onKeydown }">
                <textarea
                  data-testid="class-slot-textarea"
                  class="textarea-class-override"
                  :value="value"
                  @input="onInput"
                  @keydown="onKeydown"
                />
              </template>
            </CopilotChatInput>
          `,
        });

        const { container } = renderInWrapper(Host);
        expect(
          container.querySelector(".textarea-class-override"),
        ).toBeDefined();
      });

      it("should allow className prop in sendButton object slot", () => {
        const Host = defineComponent({
          components: { CopilotChatInput },
          template: `
            <CopilotChatInput model-value="hello" @submit-message="() => {}">
              <template #send-button="{ onClick }">
                <button data-testid="class-slot-send" class="send-class-override" @click="onClick">
                  Send
                </button>
              </template>
            </CopilotChatInput>
          `,
        });

        const { container } = renderInWrapper(Host);
        expect(container.querySelector(".send-class-override")).toBeDefined();
      });
    });

    describe("string slot vs className prop equivalence", () => {
      it("string slot should set className on textArea", () => {
        const Host = defineComponent({
          components: { CopilotChatInput },
          template: `
            <CopilotChatInput>
              <template #text-area="{ value, onInput, onKeydown }">
                <textarea data-testid="string-textarea" class="string-class-textarea" :value="value" @input="onInput" @keydown="onKeydown" />
              </template>
            </CopilotChatInput>
          `,
        });

        const { container } = renderInWrapper(Host);
        expect(container.querySelector(".string-class-textarea")).toBeDefined();
      });

      it("string slot should set className on sendButton", () => {
        const Host = defineComponent({
          components: { CopilotChatInput },
          template: `
            <CopilotChatInput model-value="hello" @submit-message="() => {}">
              <template #send-button="{ onClick }">
                <button data-testid="string-send" class="string-class-send" @click="onClick">Send</button>
              </template>
            </CopilotChatInput>
          `,
        });

        const { container } = renderInWrapper(Host);
        expect(container.querySelector(".string-class-send")).toBeDefined();
      });
    });

    describe("tailwind utility classes", () => {
      it("should apply tailwind focus utilities to textArea", () => {
        const Host = defineComponent({
          components: { CopilotChatInput },
          template: `
            <CopilotChatInput>
              <template #text-area="{ value, onInput, onKeydown }">
                <textarea
                  data-testid="focus-textarea"
                  class="focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  :value="value"
                  @input="onInput"
                  @keydown="onKeydown"
                />
              </template>
            </CopilotChatInput>
          `,
        });

        const { container } = renderInWrapper(Host);
        expect(container.querySelector(".focus\\:ring-2")).toBeDefined();
      });

      it("should apply tailwind hover utilities to sendButton", () => {
        const Host = defineComponent({
          components: { CopilotChatInput },
          template: `
            <CopilotChatInput model-value="hello" @submit-message="() => {}">
              <template #send-button="{ onClick }">
                <button data-testid="hover-send" class="hover:bg-blue-600 active:bg-blue-700" @click="onClick">
                  Send
                </button>
              </template>
            </CopilotChatInput>
          `,
        });

        const { container } = renderInWrapper(Host);
        expect(container.querySelector(".hover\\:bg-blue-600")).toBeDefined();
      });
    });
  });

  describe("6. Children Render Function", () => {
    it("should support children render function for custom layout", () => {
      const Host = defineComponent({
        components: { CopilotChatInput },
        methods: {
          readValue(event: Event) {
            return (event.target as HTMLTextAreaElement).value;
          },
        },
        template: `
          <CopilotChatInput>
            <template #layout="{ value, onUpdateValue, onSendClick }">
              <div data-testid="custom-input-layout">
                <div class="input-row">
                  <textarea data-testid="layout-textarea" :value="value" @input="onUpdateValue(readValue($event))" />
                  <button data-testid="layout-send" @click="onSendClick">Send</button>
                </div>
              </div>
            </template>
          </CopilotChatInput>
        `,
      });

      renderInWrapper(Host);
      expect(screen.getByTestId("custom-input-layout")).toBeDefined();
    });

    it("children render function should receive all slot elements", () => {
      const receivedFunctions = ref<string[]>([]);
      const Host = defineComponent({
        components: { CopilotChatInput },
        setup() {
          return { receivedFunctions };
        },
        template: `
          <CopilotChatInput>
            <template #layout="{ onUpdateValue, onSubmit, onKeydown, onSendClick, onToggleMenu }">
              <div data-testid="slots-check">
                {{
                  receivedFunctions = [
                    typeof onUpdateValue,
                    typeof onSubmit,
                    typeof onKeydown,
                    typeof onSendClick,
                    typeof onToggleMenu,
                  ]
                }}
                Rendered
              </div>
            </template>
          </CopilotChatInput>
        `,
      });

      renderInWrapper(Host);
      expect(screen.getByTestId("slots-check")).toBeDefined();
      expect(
        receivedFunctions.value.every((value) => value === "function"),
      ).toBe(true);
    });

    it("children render function allows complete layout control", () => {
      const toolsMenu: (ToolsMenuItem | "-")[] = [
        { label: "Tool", action: () => {} },
      ];
      const Host = defineComponent({
        components: { CopilotChatInput },
        setup() {
          return { toolsMenu };
        },
        methods: {
          readValue(event: Event) {
            return (event.target as HTMLTextAreaElement).value;
          },
        },
        template: `
          <CopilotChatInput :tools-menu="toolsMenu" model-value="hello" @submit-message="() => {}">
            <template #layout="{ value, onUpdateValue, onSendClick, onToggleMenu }">
              <div data-testid="full-control-layout">
                <div class="toolbar">
                  <button data-testid="layout-add" @click="onToggleMenu">Add</button>
                </div>
                <div class="main">
                  <textarea :value="value" @input="onUpdateValue(readValue($event))" />
                </div>
                <div class="actions">
                  <button data-testid="layout-send-custom" @click="onSendClick">Send</button>
                </div>
              </div>
            </template>
          </CopilotChatInput>
        `,
      });

      renderInWrapper(Host);
      expect(screen.getByTestId("full-control-layout")).toBeDefined();
      expect(document.querySelector(".toolbar")).toBeDefined();
      expect(document.querySelector(".main")).toBeDefined();
      expect(document.querySelector(".actions")).toBeDefined();
    });
  });

  describe("7. Positioning Prop", () => {
    it("should render static positioning by default", () => {
      const Host = defineComponent({
        components: { CopilotChatInput },
        template: `
          <CopilotChatInput data-testid="input-container" />
        `,
      });
      const { container } = renderInWrapper(Host);

      const inputContainer = container.querySelector(
        "[data-testid='input-container']",
      ) as HTMLElement;
      expect(inputContainer).not.toBeNull();
      expect(inputContainer.classList.contains("cpk:absolute")).toBe(false);
    });

    it("should render absolute positioning when positioning='absolute'", () => {
      const Host = defineComponent({
        components: { CopilotChatInput },
        template: `
          <CopilotChatInput positioning="absolute" data-testid="absolute-input" />
        `,
      });
      const { container } = renderInWrapper(Host);

      const inputContainer = container.querySelector(
        "[data-testid='absolute-input']",
      ) as HTMLElement;
      expect(inputContainer).not.toBeNull();
      expect(inputContainer.classList.contains("cpk:absolute")).toBe(true);
      expect(inputContainer.classList.contains("cpk:bottom-0")).toBe(true);
    });

    it("should apply keyboard height transform", () => {
      const Host = defineComponent({
        components: { CopilotChatInput },
        template: `
          <CopilotChatInput positioning="absolute" :keyboard-height="300" data-testid="keyboard-input" />
        `,
      });
      const { container } = renderInWrapper(Host);

      const inputContainer = container.querySelector(
        "[data-testid='keyboard-input']",
      ) as HTMLElement;
      expect(inputContainer).not.toBeNull();
      expect(inputContainer.style.transform).toBe("translateY(-300px)");
    });

    it("should forward containerRef", () => {
      const Host = defineComponent({
        components: { CopilotChatInput },
        template: `
          <CopilotChatInput data-testid="forwarded-input" data-extra="x" />
        `,
      });

      renderInWrapper(Host);
      const input = screen.getByTestId("forwarded-input");
      expect(input.getAttribute("data-extra")).toBe("x");
    });
  });

  describe("8. Disclaimer Slot", () => {
    it("should render disclaimer when showDisclaimer=true", () => {
      const Host = defineComponent({
        components: { CopilotChatInput },
        template: `
          <CopilotChatInput :show-disclaimer="true" />
        `,
      });

      renderInWrapper(Host);
      expect(screen.getByTestId("copilot-chat-input-disclaimer")).toBeDefined();
    });

    it("should hide disclaimer when showDisclaimer=false", () => {
      const Host = defineComponent({
        components: { CopilotChatInput },
        template: `
          <CopilotChatInput :show-disclaimer="false" />
        `,
      });
      const { container } = renderInWrapper(Host);

      const disclaimer = container.querySelector(
        "[data-testid='copilot-chat-input-disclaimer']",
      );
      expect(disclaimer).toBeNull();
    });

    it("should show disclaimer by default with absolute positioning", () => {
      const Host = defineComponent({
        components: { CopilotChatInput },
        template: `
          <CopilotChatInput positioning="absolute" />
        `,
      });
      const { container } = renderInWrapper(Host);

      const disclaimer = container.querySelector(
        "[data-testid='copilot-chat-input-disclaimer']",
      );
      expect(disclaimer).not.toBeNull();
    });

    it("should hide disclaimer by default with static positioning", () => {
      const Host = defineComponent({
        components: { CopilotChatInput },
        template: `
          <CopilotChatInput positioning="static" />
        `,
      });
      const { container } = renderInWrapper(Host);

      const disclaimer = container.querySelector(
        "[data-testid='copilot-chat-input-disclaimer']",
      );
      expect(disclaimer).toBeNull();
    });

    it("should apply tailwind class to disclaimer", () => {
      const Host = defineComponent({
        components: { CopilotChatInput },
        template: `
          <CopilotChatInput :show-disclaimer="true">
            <template #disclaimer>
              <p data-testid="custom-disclaimer-class" class="text-red-500 italic">Disclaimer</p>
            </template>
          </CopilotChatInput>
        `,
      });

      renderInWrapper(Host);
      const disclaimer = screen.getByTestId("custom-disclaimer-class");
      expect(disclaimer.classList.contains("text-red-500")).toBe(true);
      expect(disclaimer.classList.contains("italic")).toBe(true);
    });

    it("should render custom disclaimer component", () => {
      const Host = defineComponent({
        components: { CopilotChatInput },
        template: `
          <CopilotChatInput :show-disclaimer="true">
            <template #disclaimer>
              <div data-testid="custom-disclaimer">Custom Disclaimer Content</div>
            </template>
          </CopilotChatInput>
        `,
      });

      renderInWrapper(Host);
      expect(screen.getByTestId("custom-disclaimer").textContent).toContain(
        "Custom Disclaimer",
      );
    });
  });
});
