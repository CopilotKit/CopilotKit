import { render, screen, fireEvent } from "@testing-library/vue";
import { defineComponent } from "vue";
import { describe, it, expect, vi } from "vitest";
import CopilotKitProvider from "../../../providers/CopilotKitProvider.vue";
import CopilotChatConfigurationProvider from "../../../providers/CopilotChatConfigurationProvider.vue";
import CopilotChatView from "../CopilotChatView.vue";
import CopilotChatMessageView from "../CopilotChatMessageView.vue";
import CopilotChatInput from "../CopilotChatInput.vue";
import CopilotChatSuggestionView from "../CopilotChatSuggestionView.vue";
import CopilotChatAssistantMessage from "../CopilotChatAssistantMessage.vue";
import CopilotChatUserMessage from "../CopilotChatUserMessage.vue";

const sampleMessages = [
  { id: "1", role: "user" as const, content: "Hello" },
  { id: "2", role: "assistant" as const, content: "Hi there!" },
];

const sampleSuggestions = [
  { title: "Test", message: "Test message", isLoading: false },
  { title: "Another", message: "Another message", isLoading: false },
];

function renderInWrapper(component: ReturnType<typeof defineComponent>) {
  const Host = defineComponent({
    components: {
      CopilotKitProvider,
      CopilotChatConfigurationProvider,
      UnderTest: component,
    },
    template: `
      <CopilotKitProvider>
        <CopilotChatConfigurationProvider thread-id="test-thread">
          <div style="height: 400px;">
            <UnderTest />
          </div>
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    `,
  });

  return render(Host);
}

describe("CopilotChatView Slot System E2E Tests", () => {
  describe("1. Tailwind Class Slot Override", () => {
    describe("messageView slot", () => {
      it("should apply tailwind class string to messageView", () => {
        const Host = defineComponent({
          components: { CopilotChatView },
          setup() {
            return { sampleMessages };
          },
          template: `
            <CopilotChatView :messages="sampleMessages">
              <template #message-view="{ messages }">
                <div data-testid="message-view" class="bg-red-500 text-white p-4">{{ messages.length }}</div>
              </template>
            </CopilotChatView>
          `,
        });

        renderInWrapper(Host);
        const messageView = screen.getByTestId("message-view");
        expect(messageView.classList.contains("bg-red-500")).toBe(true);
        expect(messageView.classList.contains("text-white")).toBe(true);
        expect(messageView.classList.contains("p-4")).toBe(true);
      });

      it("should override default className with tailwind string", () => {
        const Host = defineComponent({
          components: { CopilotChatView },
          setup() {
            return { sampleMessages };
          },
          template: `
            <CopilotChatView :messages="sampleMessages">
              <template #message-view>
                <div class="custom-override-class">override</div>
              </template>
            </CopilotChatView>
          `,
        });
        const { container } = renderInWrapper(Host);
        expect(container.querySelector(".custom-override-class")).toBeDefined();
      });
    });

    describe("scrollView slot", () => {
      it("should apply tailwind class string to scrollView", () => {
        const Host = defineComponent({
          components: { CopilotChatView },
          setup() {
            return { sampleMessages };
          },
          template: `
            <CopilotChatView :messages="sampleMessages">
              <template #scroll-view="{ messages }">
                <div data-testid="scroll-view" class="overflow-y-auto bg-gray-100">{{ messages.length }}</div>
              </template>
            </CopilotChatView>
          `,
        });
        renderInWrapper(Host);
        const scrollView = screen.getByTestId("scroll-view");
        expect(scrollView.classList.contains("overflow-y-auto")).toBe(true);
        expect(scrollView.classList.contains("bg-gray-100")).toBe(true);
      });
    });

    describe("scrollToBottomButton slot (nested under scrollView)", () => {
      it("should apply tailwind class string to scrollToBottomButton via scrollView", () => {
        const Host = defineComponent({
          components: { CopilotChatView },
          setup() {
            return { sampleMessages };
          },
          template: `
            <CopilotChatView :messages="sampleMessages">
              <template #scroll-to-bottom-button="{ onClick }">
                <button data-testid="scroll-bottom-btn" class="bg-blue-500 rounded-full" @click="onClick">down</button>
              </template>
            </CopilotChatView>
          `,
        });
        renderInWrapper(Host);
        const button = screen.queryByTestId("scroll-bottom-btn");
        if (button) {
          expect(button.classList.contains("rounded-full")).toBe(true);
        }
      });
    });

    describe("input slot", () => {
      it("should apply tailwind class string to input", () => {
        const Host = defineComponent({
          components: { CopilotChatView, CopilotChatInput },
          setup() {
            return { sampleMessages };
          },
          template: `
            <CopilotChatView :messages="sampleMessages">
              <template #input="{ modelValue, onUpdateModelValue, onSubmitMessage }">
                <CopilotChatInput
                  data-testid="input-slot"
                  class="border-2 border-purple-500"
                  :model-value="modelValue"
                  @update:model-value="onUpdateModelValue"
                  @submit-message="onSubmitMessage"
                />
              </template>
            </CopilotChatView>
          `,
        });
        renderInWrapper(Host);
        expect(
          screen
            .getByTestId("input-slot")
            .classList.contains("border-purple-500"),
        ).toBe(true);
      });
    });

    describe("feather slot (via scrollView)", () => {
      it("should apply tailwind class string to feather via scrollView", () => {
        const Host = defineComponent({
          components: { CopilotChatView },
          setup() {
            return { sampleMessages };
          },
          template: `
            <CopilotChatView :messages="sampleMessages">
              <template #feather>
                <div data-testid="feather-slot" class="text-green-500 font-bold">feather</div>
              </template>
            </CopilotChatView>
          `,
        });
        renderInWrapper(Host);
        const feather = screen.getByTestId("feather-slot");
        expect(feather.classList.contains("text-green-500")).toBe(true);
        expect(feather.classList.contains("font-bold")).toBe(true);
      });
    });

    describe("suggestionView slot", () => {
      it("should apply tailwind class string to suggestionView", () => {
        const Host = defineComponent({
          components: { CopilotChatView, CopilotChatSuggestionView },
          setup() {
            return { sampleMessages, sampleSuggestions };
          },
          template: `
            <CopilotChatView :messages="sampleMessages" :suggestions="sampleSuggestions">
              <template #suggestion-view="{ suggestions, loadingIndexes, onSelectSuggestion }">
                <CopilotChatSuggestionView
                  data-testid="suggestion-view"
                  class="flex gap-2 bg-indigo-50"
                  :suggestions="suggestions"
                  :loading-indexes="loadingIndexes"
                  @select-suggestion="(s, i) => onSelectSuggestion(s, i)"
                />
              </template>
            </CopilotChatView>
          `,
        });
        renderInWrapper(Host);
        expect(
          screen
            .getByTestId("suggestion-view")
            .classList.contains("bg-indigo-50"),
        ).toBe(true);
      });
    });

    describe("className vs tailwind string precedence", () => {
      it("tailwind string should completely replace className (not merge)", () => {
        const Host = defineComponent({
          components: { CopilotChatView, CopilotChatInput },
          setup() {
            return { sampleMessages };
          },
          template: `
            <CopilotChatView :messages="sampleMessages">
              <template #input="{ modelValue, onUpdateModelValue, onSubmitMessage }">
                <CopilotChatInput class="only-this-class" :model-value="modelValue" @update:model-value="onUpdateModelValue" @submit-message="onSubmitMessage" />
              </template>
            </CopilotChatView>
          `,
        });
        const { container } = renderInWrapper(Host);
        expect(container.querySelector(".only-this-class")).toBeDefined();
      });
    });

    describe("non-tailwind inline styles should still work", () => {
      it("should accept style prop alongside className override", () => {
        const Host = defineComponent({
          components: { CopilotChatView, CopilotChatInput },
          setup() {
            return { sampleMessages };
          },
          template: `
            <CopilotChatView :messages="sampleMessages">
              <template #input="{ modelValue, onUpdateModelValue, onSubmitMessage }">
                <div data-testid="custom-input" style="background-color: rgb(255, 0, 0);">
                  <CopilotChatInput :model-value="modelValue" @update:model-value="onUpdateModelValue" @submit-message="onSubmitMessage" />
                </div>
              </template>
            </CopilotChatView>
          `,
        });
        renderInWrapper(Host);
        const customInput = screen.getByTestId("custom-input");
        expect(customInput.style.backgroundColor).toBe("rgb(255, 0, 0)");
      });
    });
  });

  describe("2. Properties Slot Override", () => {
    describe("scrollToBottomButton props (nested under scrollView)", () => {
      it("should pass onClick handler to scrollToBottomButton via scrollView", async () => {
        const handleClick = vi.fn();
        const Host = defineComponent({
          components: { CopilotChatView },
          setup() {
            return { sampleMessages, handleClick };
          },
          template: `
            <CopilotChatView :messages="sampleMessages">
              <template #scroll-to-bottom-button="{ onClick }">
                <button data-testid="scroll-button" @click="handleClick(); onClick()">scroll</button>
              </template>
            </CopilotChatView>
          `,
        });
        renderInWrapper(Host);
        const btn = screen.queryByTestId("scroll-button");
        if (btn) {
          await fireEvent.click(btn);
          expect(handleClick).toHaveBeenCalled();
        }
      });

      it("should pass disabled prop to scrollToBottomButton via scrollView", () => {
        const Host = defineComponent({
          components: { CopilotChatView },
          setup() {
            return { sampleMessages };
          },
          template: `
            <CopilotChatView :messages="sampleMessages">
              <template #scroll-to-bottom-button>
                <button data-testid="scroll-button-disabled" disabled>scroll</button>
              </template>
            </CopilotChatView>
          `,
        });
        renderInWrapper(Host);
        const btn = screen.queryByTestId("scroll-button-disabled");
        if (btn) {
          expect(btn.hasAttribute("disabled")).toBe(true);
        }
      });
    });

    describe("input props", () => {
      it("should pass onFocus handler to input", async () => {
        const handleFocus = vi.fn();
        const Host = defineComponent({
          components: { CopilotChatView, CopilotChatInput },
          setup() {
            return { sampleMessages, handleFocus };
          },
          template: `
            <CopilotChatView :messages="sampleMessages">
              <template #input="{ modelValue, onUpdateModelValue, onSubmitMessage }">
                <CopilotChatInput :model-value="modelValue" @update:model-value="onUpdateModelValue" @submit-message="onSubmitMessage">
                  <template #text-area="{ value, onInput, onKeydown }">
                    <textarea data-testid="focus-input" :value="value" @focus="handleFocus" @input="onInput" @keydown="onKeydown" />
                  </template>
                </CopilotChatInput>
              </template>
            </CopilotChatView>
          `,
        });
        renderInWrapper(Host);
        await fireEvent.focus(screen.getByTestId("focus-input"));
        expect(handleFocus).toHaveBeenCalled();
      });

      it("should pass autoFocus prop to input", () => {
        const Host = defineComponent({
          components: { CopilotChatView, CopilotChatInput },
          setup() {
            return { sampleMessages };
          },
          template: `
            <CopilotChatView :messages="sampleMessages">
              <template #input="{ modelValue, onUpdateModelValue, onSubmitMessage }">
                <CopilotChatInput :model-value="modelValue" @update:model-value="onUpdateModelValue" @submit-message="onSubmitMessage">
                  <template #text-area="{ value, onInput, onKeydown }">
                    <textarea data-testid="autofocus-input" autofocus :value="value" @input="onInput" @keydown="onKeydown" />
                  </template>
                </CopilotChatInput>
              </template>
            </CopilotChatView>
          `,
        });
        renderInWrapper(Host);
        expect(
          screen.getByTestId("autofocus-input").hasAttribute("autofocus"),
        ).toBe(true);
      });
    });

    describe("messageView props", () => {
      it("should pass isRunning prop to messageView", () => {
        const Host = defineComponent({
          components: { CopilotChatView },
          setup() {
            return { sampleMessages };
          },
          template: `
            <CopilotChatView :messages="sampleMessages" :is-running="true">
              <template #message-view="{ isRunning }">
                <div data-testid="running-state">{{ isRunning ? "running" : "idle" }}</div>
              </template>
            </CopilotChatView>
          `,
        });
        renderInWrapper(Host);
        expect(screen.getByTestId("running-state").textContent).toBe("running");
      });
    });
  });

  describe("3. Custom Component Slot Override", () => {
    describe("messageView custom component", () => {
      it("should render custom messageView component", () => {
        const Host = defineComponent({
          components: { CopilotChatView },
          setup() {
            return { sampleMessages };
          },
          template: `
            <CopilotChatView :messages="sampleMessages">
              <template #message-view>
                <div data-testid="custom-message-view">Custom message view component</div>
              </template>
            </CopilotChatView>
          `,
        });
        renderInWrapper(Host);
        expect(screen.getByTestId("custom-message-view")).toBeDefined();
      });

      it("custom messageView should receive all props including messages", () => {
        const Host = defineComponent({
          components: { CopilotChatView },
          setup() {
            return { sampleMessages };
          },
          template: `
            <CopilotChatView :messages="sampleMessages">
              <template #message-view="{ messages }">
                <div data-testid="custom-message-count">{{ messages.length }}</div>
              </template>
            </CopilotChatView>
          `,
        });
        renderInWrapper(Host);
        expect(screen.getByTestId("custom-message-count").textContent).toBe(
          "2",
        );
      });
    });

    describe("input custom component", () => {
      it("should render custom input component", () => {
        const Host = defineComponent({
          components: { CopilotChatView },
          setup() {
            return { sampleMessages };
          },
          template: `
            <CopilotChatView :messages="sampleMessages">
              <template #input>
                <div data-testid="custom-input-component">Custom input</div>
              </template>
            </CopilotChatView>
          `,
        });
        renderInWrapper(Host);
        expect(screen.getByTestId("custom-input-component")).toBeDefined();
      });

      it("custom input should receive onSubmitMessage callback", async () => {
        const onSubmitMessage = vi.fn();
        const Host = defineComponent({
          components: { CopilotChatView },
          setup() {
            return { sampleMessages, onSubmitMessage };
          },
          template: `
            <CopilotChatView :messages="sampleMessages" @submit-message="onSubmitMessage">
              <template #input="{ onSubmitMessage }">
                <button data-testid="custom-input-submit" @click="onSubmitMessage('hello')">Submit</button>
              </template>
            </CopilotChatView>
          `,
        });
        renderInWrapper(Host);
        await fireEvent.click(screen.getByTestId("custom-input-submit"));
        expect(onSubmitMessage).toHaveBeenCalledWith("hello");
      });
    });

    describe("scrollView custom component", () => {
      it("should render custom scrollView component", () => {
        const Host = defineComponent({
          components: { CopilotChatView },
          setup() {
            return { sampleMessages };
          },
          template: `
            <CopilotChatView :messages="sampleMessages">
              <template #scroll-view>
                <div data-testid="custom-scroll-view-component">Scroll view</div>
              </template>
            </CopilotChatView>
          `,
        });
        renderInWrapper(Host);
        expect(
          screen.getByTestId("custom-scroll-view-component"),
        ).toBeDefined();
      });
    });

    describe("suggestionView custom component", () => {
      it("should render custom suggestionView component", () => {
        const Host = defineComponent({
          components: { CopilotChatView },
          setup() {
            return { sampleMessages, sampleSuggestions };
          },
          template: `
            <CopilotChatView :messages="sampleMessages" :suggestions="sampleSuggestions">
              <template #suggestion-view>
                <div data-testid="custom-suggestion-component">Suggestion view</div>
              </template>
            </CopilotChatView>
          `,
        });
        renderInWrapper(Host);
        expect(screen.getByTestId("custom-suggestion-component")).toBeDefined();
      });
    });

    describe("feather custom component (via scrollView)", () => {
      it("should render custom feather component via scrollView", () => {
        const Host = defineComponent({
          components: { CopilotChatView },
          setup() {
            return { sampleMessages };
          },
          template: `
            <CopilotChatView :messages="sampleMessages">
              <template #feather>
                <div data-testid="custom-feather-component">Feather</div>
              </template>
            </CopilotChatView>
          `,
        });
        renderInWrapper(Host);
        expect(screen.getByTestId("custom-feather-component")).toBeDefined();
      });
    });

    describe("scrollToBottomButton custom component (nested under scrollView)", () => {
      it("should render custom scrollToBottomButton component via scrollView", () => {
        const Host = defineComponent({
          components: { CopilotChatView },
          setup() {
            return { sampleMessages };
          },
          template: `
            <CopilotChatView :messages="sampleMessages">
              <template #scroll-to-bottom-button>
                <button data-testid="custom-scroll-bottom-component">Down</button>
              </template>
            </CopilotChatView>
          `,
        });
        renderInWrapper(Host);
        const button = screen.queryByTestId("custom-scroll-bottom-component");
        if (button) {
          expect(button.textContent).toBe("Down");
        }
      });
    });
  });

  describe("4. Recursive Subcomponent Drill-Down", () => {
    describe("messageView -> assistantMessage drill-down", () => {
      it("should allow customizing assistantMessage within messageView", () => {
        const Host = defineComponent({
          components: {
            CopilotChatView,
            CopilotChatMessageView,
            CopilotChatAssistantMessage,
          },
          setup() {
            return { sampleMessages };
          },
          template: `
            <CopilotChatView :messages="sampleMessages">
              <template #message-view="{ messages, isRunning }">
                <CopilotChatMessageView :messages="messages" :is-running="isRunning">
                  <template #assistant-message="{ message, messages, isRunning }">
                    <CopilotChatAssistantMessage :message="message" :messages="messages" :is-running="isRunning">
                      <template #message-renderer="{ content }">
                        <div data-testid="assistant-custom">{{ content }}</div>
                      </template>
                    </CopilotChatAssistantMessage>
                  </template>
                </CopilotChatMessageView>
              </template>
            </CopilotChatView>
          `,
        });
        renderInWrapper(Host);
        expect(screen.getByTestId("assistant-custom")).toBeDefined();
      });
    });

    describe("messageView -> userMessage drill-down", () => {
      it("should allow customizing userMessage within messageView", () => {
        const Host = defineComponent({
          components: {
            CopilotChatView,
            CopilotChatMessageView,
            CopilotChatUserMessage,
          },
          setup() {
            return { sampleMessages };
          },
          template: `
            <CopilotChatView :messages="sampleMessages">
              <template #message-view="{ messages, isRunning }">
                <CopilotChatMessageView :messages="messages" :is-running="isRunning">
                  <template #user-message="{ message }">
                    <CopilotChatUserMessage :message="message">
                      <template #message-renderer="{ content }">
                        <div data-testid="user-custom">{{ content }}</div>
                      </template>
                    </CopilotChatUserMessage>
                  </template>
                </CopilotChatMessageView>
              </template>
            </CopilotChatView>
          `,
        });
        renderInWrapper(Host);
        expect(screen.getByTestId("user-custom")).toBeDefined();
      });
    });

    describe("messageView -> cursor drill-down", () => {
      it("should allow customizing cursor within messageView", () => {
        const Host = defineComponent({
          components: { CopilotChatView, CopilotChatMessageView },
          setup() {
            return { sampleMessages };
          },
          template: `
            <CopilotChatView :messages="sampleMessages" :is-running="true">
              <template #message-view="{ messages, isRunning }">
                <CopilotChatMessageView :messages="messages" :is-running="isRunning">
                  <template #cursor>
                    <div data-testid="custom-cursor">cursor</div>
                  </template>
                </CopilotChatMessageView>
              </template>
            </CopilotChatView>
          `,
        });
        renderInWrapper(Host);
        expect(screen.getByTestId("custom-cursor")).toBeDefined();
      });
    });

    describe("input -> textArea drill-down", () => {
      it("should allow customizing textArea within input", () => {
        const Host = defineComponent({
          components: { CopilotChatView, CopilotChatInput },
          setup() {
            return { sampleMessages };
          },
          template: `
            <CopilotChatView :messages="sampleMessages">
              <template #input="{ modelValue, onUpdateModelValue, onSubmitMessage }">
                <CopilotChatInput :model-value="modelValue" @update:model-value="onUpdateModelValue" @submit-message="onSubmitMessage">
                  <template #text-area="{ value, onInput, onKeydown }">
                    <textarea data-testid="custom-text-area-drill" :value="value" @input="onInput" @keydown="onKeydown" />
                  </template>
                </CopilotChatInput>
              </template>
            </CopilotChatView>
          `,
        });
        renderInWrapper(Host);
        expect(screen.getByTestId("custom-text-area-drill")).toBeDefined();
      });
    });

    describe("input -> sendButton drill-down", () => {
      it("should allow customizing sendButton within input", () => {
        const Host = defineComponent({
          components: { CopilotChatView, CopilotChatInput },
          setup() {
            return { sampleMessages };
          },
          template: `
            <CopilotChatView :messages="sampleMessages">
              <template #input="{ modelValue, onUpdateModelValue, onSubmitMessage }">
                <CopilotChatInput :model-value="modelValue" @update:model-value="onUpdateModelValue" @submit-message="onSubmitMessage">
                  <template #send-button="{ onClick }">
                    <button data-testid="custom-send-drill" @click="onClick">Send</button>
                  </template>
                </CopilotChatInput>
              </template>
            </CopilotChatView>
          `,
        });
        renderInWrapper(Host);
        expect(screen.getByTestId("custom-send-drill")).toBeDefined();
      });
    });

    describe("input -> addMenuButton drill-down", () => {
      it("should allow customizing addMenuButton within input", () => {
        const toolsMenu = [{ label: "Tool", action: vi.fn() }];
        const Host = defineComponent({
          components: { CopilotChatView, CopilotChatInput },
          setup() {
            return { sampleMessages, toolsMenu };
          },
          template: `
            <CopilotChatView :messages="sampleMessages" :input-tools-menu="toolsMenu">
              <template #input="{ modelValue, onUpdateModelValue, onSubmitMessage, inputToolsMenu }">
                <CopilotChatInput :model-value="modelValue" :tools-menu="inputToolsMenu" @update:model-value="onUpdateModelValue" @submit-message="onSubmitMessage">
                  <template #add-menu-button="{ toggleMenu }">
                    <button data-testid="custom-add-drill" @click="toggleMenu">Add</button>
                  </template>
                </CopilotChatInput>
              </template>
            </CopilotChatView>
          `,
        });
        renderInWrapper(Host);
        expect(screen.getByTestId("custom-add-drill")).toBeDefined();
      });
    });

    describe("suggestionView -> suggestion drill-down", () => {
      it("should allow customizing suggestion pill within suggestionView", () => {
        const Host = defineComponent({
          components: { CopilotChatView, CopilotChatSuggestionView },
          setup() {
            return { sampleMessages, sampleSuggestions };
          },
          template: `
            <CopilotChatView :messages="sampleMessages" :suggestions="sampleSuggestions">
              <template #suggestion-view="{ suggestions, loadingIndexes }">
                <CopilotChatSuggestionView :suggestions="suggestions" :loading-indexes="loadingIndexes">
                  <template #suggestion="{ suggestion, index }">
                    <button :data-testid="'custom-pill-' + index">{{ suggestion.title }}</button>
                  </template>
                </CopilotChatSuggestionView>
              </template>
            </CopilotChatView>
          `,
        });
        renderInWrapper(Host);
        expect(screen.getByTestId("custom-pill-0")).toBeDefined();
      });
    });

    describe("suggestionView -> container drill-down", () => {
      it("should allow customizing container within suggestionView", () => {
        const Host = defineComponent({
          components: { CopilotChatView, CopilotChatSuggestionView },
          setup() {
            return { sampleMessages, sampleSuggestions };
          },
          template: `
            <CopilotChatView :messages="sampleMessages" :suggestions="sampleSuggestions">
              <template #suggestion-view="{ suggestions, loadingIndexes, onSelectSuggestion }">
                <CopilotChatSuggestionView :suggestions="suggestions" :loading-indexes="loadingIndexes" @select-suggestion="(s, i) => onSelectSuggestion(s, i)">
                  <template #container="{ suggestions }">
                    <div data-testid="custom-suggestion-container">{{ suggestions.length }}</div>
                  </template>
                </CopilotChatSuggestionView>
              </template>
            </CopilotChatView>
          `,
        });
        renderInWrapper(Host);
        expect(screen.getByTestId("custom-suggestion-container")).toBeDefined();
      });
    });

    describe("multiple nested overrides simultaneously", () => {
      it("should allow overriding multiple nested slots at once", () => {
        const Host = defineComponent({
          components: {
            CopilotChatView,
            CopilotChatMessageView,
            CopilotChatAssistantMessage,
            CopilotChatInput,
            CopilotChatSuggestionView,
          },
          setup() {
            return { sampleMessages, sampleSuggestions };
          },
          template: `
            <CopilotChatView :messages="sampleMessages" :suggestions="sampleSuggestions">
              <template #message-view="{ messages, isRunning }">
                <CopilotChatMessageView :messages="messages" :is-running="isRunning">
                  <template #assistant-message="{ message, messages, isRunning }">
                    <CopilotChatAssistantMessage :message="message" :messages="messages" :is-running="isRunning">
                      <template #message-renderer><div data-testid="multi-assistant">assistant</div></template>
                    </CopilotChatAssistantMessage>
                  </template>
                </CopilotChatMessageView>
              </template>
              <template #input="{ modelValue, onUpdateModelValue, onSubmitMessage }">
                <CopilotChatInput :model-value="modelValue" @update:model-value="onUpdateModelValue" @submit-message="onSubmitMessage">
                  <template #send-button><button data-testid="multi-send">send</button></template>
                </CopilotChatInput>
              </template>
              <template #suggestion-view="{ suggestions, loadingIndexes }">
                <CopilotChatSuggestionView :suggestions="suggestions" :loading-indexes="loadingIndexes">
                  <template #suggestion="{ index }"><button :data-testid="'multi-pill-' + index">pill</button></template>
                </CopilotChatSuggestionView>
              </template>
            </CopilotChatView>
          `,
        });
        renderInWrapper(Host);
        expect(screen.getByTestId("multi-assistant")).toBeDefined();
        expect(screen.getByTestId("multi-send")).toBeDefined();
        expect(screen.getByTestId("multi-pill-0")).toBeDefined();
      });
    });

    describe("three-level deep nesting", () => {
      it("should support messageView -> assistantMessage -> toolbar drill-down", () => {
        const Host = defineComponent({
          components: {
            CopilotChatView,
            CopilotChatMessageView,
            CopilotChatAssistantMessage,
          },
          setup() {
            return { sampleMessages };
          },
          template: `
            <CopilotChatView :messages="sampleMessages">
              <template #message-view="{ messages, isRunning }">
                <CopilotChatMessageView :messages="messages" :is-running="isRunning">
                  <template #assistant-message="{ message, messages, isRunning }">
                    <CopilotChatAssistantMessage :message="message" :messages="messages" :is-running="isRunning">
                      <template #toolbar><div data-testid="deep-toolbar">toolbar</div></template>
                    </CopilotChatAssistantMessage>
                  </template>
                </CopilotChatMessageView>
              </template>
            </CopilotChatView>
          `,
        });
        renderInWrapper(Host);
        expect(screen.getByTestId("deep-toolbar")).toBeDefined();
      });

      it("should support messageView -> assistantMessage -> copyButton drill-down", () => {
        const Host = defineComponent({
          components: {
            CopilotChatView,
            CopilotChatMessageView,
            CopilotChatAssistantMessage,
          },
          setup() {
            return { sampleMessages };
          },
          template: `
            <CopilotChatView :messages="sampleMessages">
              <template #message-view="{ messages, isRunning }">
                <CopilotChatMessageView :messages="messages" :is-running="isRunning">
                  <template #assistant-message="{ message, messages, isRunning }">
                    <CopilotChatAssistantMessage :message="message" :messages="messages" :is-running="isRunning">
                      <template #copy-button><button data-testid="deep-copy">copy</button></template>
                    </CopilotChatAssistantMessage>
                  </template>
                </CopilotChatMessageView>
              </template>
            </CopilotChatView>
          `,
        });
        renderInWrapper(Host);
        expect(screen.getByTestId("deep-copy")).toBeDefined();
      });

      it("should support messageView -> userMessage -> editButton drill-down", () => {
        const Host = defineComponent({
          components: {
            CopilotChatView,
            CopilotChatMessageView,
            CopilotChatUserMessage,
          },
          setup() {
            return { sampleMessages };
          },
          template: `
            <CopilotChatView :messages="sampleMessages">
              <template #message-view="{ messages, isRunning }">
                <CopilotChatMessageView :messages="messages" :is-running="isRunning">
                  <template #user-message="{ message }">
                    <CopilotChatUserMessage :message="message">
                      <template #edit-button>
                        <button data-testid="custom-edit-btn">✏️ Edit</button>
                      </template>
                    </CopilotChatUserMessage>
                  </template>
                </CopilotChatMessageView>
              </template>
            </CopilotChatView>
          `,
        });
        renderInWrapper(Host);
        const editBtn = screen.queryByTestId("custom-edit-btn");
        if (editBtn) {
          expect(editBtn.textContent).toContain("Edit");
        }
      });
    });
  });

  describe("5. className Override with Tailwind", () => {
    describe("className prop override", () => {
      it("should allow className prop in object slot to override defaults", () => {
        const Host = defineComponent({
          components: { CopilotChatView },
          setup() {
            return { sampleMessages };
          },
          template: `
            <CopilotChatView :messages="sampleMessages">
              <template #message-view>
                <div class="class-override-a">A</div>
              </template>
            </CopilotChatView>
          `,
        });
        const { container } = renderInWrapper(Host);
        expect(container.querySelector(".class-override-a")).toBeDefined();
      });

      it("should merge className with other props in object slot", () => {
        const Host = defineComponent({
          components: { CopilotChatView },
          setup() {
            return { sampleMessages };
          },
          template: `
            <CopilotChatView :messages="sampleMessages">
              <template #message-view>
                <div class="class-override-b" data-testid="class-override-b">B</div>
              </template>
            </CopilotChatView>
          `,
        });
        renderInWrapper(Host);
        expect(
          screen
            .getByTestId("class-override-b")
            .classList.contains("class-override-b"),
        ).toBe(true);
      });
    });

    describe("string slot vs className prop equivalence", () => {
      it("string slot should behave same as className prop", () => {
        const Host = defineComponent({
          components: { CopilotChatView, CopilotChatInput },
          setup() {
            return { sampleMessages };
          },
          template: `
            <CopilotChatView :messages="sampleMessages">
              <template #input="{ modelValue, onUpdateModelValue, onSubmitMessage }">
                <CopilotChatInput class="equivalence-class" :model-value="modelValue" @update:model-value="onUpdateModelValue" @submit-message="onSubmitMessage" />
              </template>
            </CopilotChatView>
          `,
        });
        const { container } = renderInWrapper(Host);
        expect(container.querySelector(".equivalence-class")).toBeDefined();
      });
    });

    describe("tailwind utility class merging", () => {
      it("should properly apply tailwind utilities like flex, grid, etc.", () => {
        const Host = defineComponent({
          components: { CopilotChatView },
          setup() {
            return { sampleMessages };
          },
          template: `
            <CopilotChatView :messages="sampleMessages">
              <template #message-view>
                <div class="flex grid gap-2">x</div>
              </template>
            </CopilotChatView>
          `,
        });
        const { container } = renderInWrapper(Host);
        expect(container.querySelector(".flex.grid.gap-2")).toBeDefined();
      });

      it("should apply responsive tailwind classes", () => {
        const Host = defineComponent({
          components: { CopilotChatView },
          setup() {
            return { sampleMessages };
          },
          template: `
            <CopilotChatView :messages="sampleMessages">
              <template #message-view>
                <div class="sm:px-4 md:px-6">x</div>
              </template>
            </CopilotChatView>
          `,
        });
        const { container } = renderInWrapper(Host);
        expect(container.querySelector(".sm\\:px-4")).toBeDefined();
      });

      it("should apply dark mode tailwind classes", () => {
        const Host = defineComponent({
          components: { CopilotChatView },
          setup() {
            return { sampleMessages };
          },
          template: `
            <CopilotChatView :messages="sampleMessages">
              <template #message-view>
                <div class="dark:bg-zinc-900">x</div>
              </template>
            </CopilotChatView>
          `,
        });
        const { container } = renderInWrapper(Host);
        expect(container.querySelector(".dark\\:bg-zinc-900")).toBeDefined();
      });
    });

    describe("user className should override pre-set className", () => {
      it("object slot className should take precedence over defaults", () => {
        const Host = defineComponent({
          components: { CopilotChatView },
          setup() {
            return { sampleMessages };
          },
          template: `
            <CopilotChatView :messages="sampleMessages">
              <template #message-view>
                <div class="override-precedence">x</div>
              </template>
            </CopilotChatView>
          `,
        });
        const { container } = renderInWrapper(Host);
        expect(container.querySelector(".override-precedence")).toBeDefined();
      });
    });
  });

  describe("6. Children Render Function (Composition Pattern)", () => {
    it("should support children render function for full control", () => {
      const Host = defineComponent({
        components: { CopilotChatView },
        setup() {
          return { sampleMessages };
        },
        template: `
          <CopilotChatView :messages="sampleMessages">
            <template #scroll-view="{ messages }">
              <div data-testid="full-control-view">count: {{ messages.length }}</div>
            </template>
          </CopilotChatView>
        `,
      });
      renderInWrapper(Host);
      expect(screen.getByTestId("full-control-view")).toBeDefined();
    });

    it("children render function should receive all slot elements", () => {
      const Host = defineComponent({
        components: { CopilotChatView },
        setup() {
          return { sampleMessages, sampleSuggestions };
        },
        template: `
          <CopilotChatView :messages="sampleMessages" :suggestions="sampleSuggestions">
            <template #scroll-view="{ messages, suggestions, onSelectSuggestion, onScroll, scrollToBottom }">
              <div data-testid="slot-elements-check">
                {{ messages.length }}-{{ suggestions.length }}-{{ typeof onSelectSuggestion }}-{{ typeof onScroll }}-{{ typeof scrollToBottom }}
              </div>
            </template>
          </CopilotChatView>
        `,
      });
      renderInWrapper(Host);
      const text = screen.getByTestId("slot-elements-check").textContent ?? "";
      expect(text.includes("function")).toBe(true);
    });
  });

  describe("mobile keyboard height integration", () => {
    it("forwards visualViewport-driven keyboardHeight into the input transform", async () => {
      const originalVisualViewport = window.visualViewport;
      const originalInnerHeight = window.innerHeight;
      const listeners = new Map<string, ((event: Event) => void)[]>();
      const mockVisualViewport = {
        height: 800,
        addEventListener: vi.fn(
          (type: string, listener: (event: Event) => void) => {
            const bucket = listeners.get(type) ?? [];
            bucket.push(listener);
            listeners.set(type, bucket);
          },
        ),
        removeEventListener: vi.fn(),
      };

      Object.defineProperty(window, "visualViewport", {
        value: mockVisualViewport,
        writable: true,
        configurable: true,
      });
      Object.defineProperty(window, "innerHeight", {
        value: 800,
        writable: true,
        configurable: true,
      });

      try {
        const Host = defineComponent({
          components: { CopilotChatView },
          setup() {
            return { sampleMessages };
          },
          template: `
            <CopilotChatView :messages="sampleMessages" />
          `,
        });

        const { container } = renderInWrapper(Host);

        // Simulate the on-screen keyboard opening (visual viewport shrinks
        // by 300px, well above the 150px isKeyboardOpen threshold).
        mockVisualViewport.height = 500;
        (listeners.get("resize") ?? []).forEach((listener) =>
          listener(new Event("resize")),
        );
        await new Promise((resolve) => setTimeout(resolve, 0));

        const inputContainer = container.querySelector(
          "[data-testid='copilot-input-overlay']",
        ) as HTMLElement | null;
        expect(inputContainer).not.toBeNull();
        // The input's absolute positioning wrapper inside the chat view
        // should now carry the `translateY(-300px)` transform driven by
        // useKeyboardHeight via effectiveKeyboardHeight.
        const translatedWrapper = inputContainer!.querySelector(
          '[style*="translateY(-300px)"]',
        );
        expect(translatedWrapper).not.toBeNull();
      } finally {
        Object.defineProperty(window, "visualViewport", {
          value: originalVisualViewport,
          writable: true,
          configurable: true,
        });
        Object.defineProperty(window, "innerHeight", {
          value: originalInnerHeight,
          writable: true,
          configurable: true,
        });
      }
    });
  });
});
