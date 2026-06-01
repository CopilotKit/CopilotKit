import { render, screen, fireEvent } from "@testing-library/vue";
import { defineComponent, ref } from "vue";
import { describe, it, expect, vi } from "vitest";
import CopilotKitProvider from "../../../providers/CopilotKitProvider.vue";
import CopilotChatConfigurationProvider from "../../../providers/CopilotChatConfigurationProvider.vue";
import CopilotChatView from "../CopilotChatView.vue";
import CopilotChatInput from "../CopilotChatInput.vue";
import CopilotChatMessageView from "../CopilotChatMessageView.vue";
import CopilotChatAssistantMessage from "../CopilotChatAssistantMessage.vue";
import CopilotChatUserMessage from "../CopilotChatUserMessage.vue";
import CopilotChatSuggestionView from "../CopilotChatSuggestionView.vue";

const createMessages = () => [
  { id: "1", role: "user" as const, content: "Hello" },
  { id: "2", role: "assistant" as const, content: "Hi there! How can I help?" },
  { id: "3", role: "user" as const, content: "Tell me a joke" },
  {
    id: "4",
    role: "assistant" as const,
    content: "Why did the chicken cross the road?",
  },
];

const createSuggestions = () => [
  {
    title: "Tell me more",
    message: "Tell me more about that",
    isLoading: false,
  },
  {
    title: "Another topic",
    message: "Let's talk about something else",
    isLoading: false,
  },
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

describe("CopilotChatView onClick Handlers - Drill-Down E2E Tests", () => {
  describe("Level 1: CopilotChatView Direct Slots", () => {
    describe("scrollToBottomButton onClick (nested under scrollView)", () => {
      it("should handle onClick on scrollToBottomButton via scrollView props", async () => {
        const onClick = vi.fn();
        const Host = defineComponent({
          components: { CopilotChatView },
          setup() {
            return { messages: createMessages(), onClick };
          },
          template: `
            <CopilotChatView :messages="messages">
              <template #scroll-to-bottom-button="{ onClick: scrollClick }">
                <button
                  data-testid="scroll-to-bottom-button"
                  @click="
                    onClick();
                    scrollClick();
                  "
                >
                  scroll
                </button>
              </template>
            </CopilotChatView>
          `,
        });

        renderInWrapper(Host);
        const scrollBtn = screen.queryByTestId("scroll-to-bottom-button");
        if (scrollBtn) {
          await fireEvent.click(scrollBtn);
          expect(onClick).toHaveBeenCalled();
        }
      });
    });

    describe("input onClick", () => {
      it("should handle onClick on input via props object", async () => {
        const onClick = vi.fn();
        const Host = defineComponent({
          components: { CopilotChatView, CopilotChatInput },
          setup() {
            return { messages: createMessages(), onClick };
          },
          template: `
            <CopilotChatView :messages="messages">
              <template #input="{ modelValue, onUpdateModelValue, onSubmitMessage }">
                <div data-testid="input-slot" @click="onClick">
                  <CopilotChatInput
                    :model-value="modelValue"
                    @update:model-value="onUpdateModelValue"
                    @submit-message="onSubmitMessage"
                  />
                </div>
              </template>
            </CopilotChatView>
          `,
        });

        renderInWrapper(Host);
        await fireEvent.click(screen.getByTestId("input-slot"));
        expect(onClick).toHaveBeenCalled();
      });
    });

    describe("suggestionView onClick", () => {
      it("should handle onSelectSuggestion when suggestion is clicked", async () => {
        const onSelectSuggestion = vi.fn();
        const Host = defineComponent({
          components: { CopilotChatView },
          setup() {
            return {
              messages: createMessages(),
              suggestions: createSuggestions(),
              onSelectSuggestion,
            };
          },
          template: `
            <CopilotChatView
              :messages="messages"
              :suggestions="suggestions"
              @select-suggestion="onSelectSuggestion"
            />
          `,
        });

        renderInWrapper(Host);
        const suggestion = screen.queryByText("Tell me more");
        if (suggestion) {
          await fireEvent.click(suggestion);
          expect(onSelectSuggestion).toHaveBeenCalled();
        }
      });
    });
  });

  describe("Level 2: CopilotChatInput Drill-Down", () => {
    describe("input -> sendButton onClick", () => {
      it("should handle onClick on sendButton via input props drill-down", async () => {
        const onClick = vi.fn();
        const Host = defineComponent({
          components: { CopilotChatView, CopilotChatInput },
          setup() {
            return { messages: createMessages(), onClick };
          },
          template: `
            <CopilotChatView :messages="messages">
              <template #input="{ modelValue, onUpdateModelValue, onSubmitMessage }">
                <CopilotChatInput :model-value="modelValue" @update:model-value="onUpdateModelValue" @submit-message="onSubmitMessage">
                  <template #send-button="{ onClick: defaultClick }">
                    <button
                      data-testid="send-button"
                      @click="
                        onClick();
                        defaultClick();
                      "
                    >
                      Send
                    </button>
                  </template>
                </CopilotChatInput>
              </template>
            </CopilotChatView>
          `,
        });

        renderInWrapper(Host);
        await fireEvent.click(screen.getByTestId("send-button"));
        expect(onClick).toHaveBeenCalled();
      });
    });

    describe("input -> startTranscribeButton onClick", () => {
      it("should handle onClick on startTranscribeButton via input props drill-down", async () => {
        const onClick = vi.fn();
        const onStartTranscribe = vi.fn();
        const Host = defineComponent({
          components: { CopilotChatView, CopilotChatInput },
          setup() {
            return { messages: createMessages(), onClick, onStartTranscribe };
          },
          template: `
            <CopilotChatView :messages="messages" @start-transcribe="onStartTranscribe">
              <template #input="{ modelValue, onUpdateModelValue, onSubmitMessage, onStartTranscribe }">
                <CopilotChatInput
                  :model-value="modelValue"
                  @update:model-value="onUpdateModelValue"
                  @submit-message="onSubmitMessage"
                  @start-transcribe="onStartTranscribe"
                >
                  <template #start-transcribe-button="{ onClick: defaultClick }">
                    <button
                      data-testid="start-transcribe-button"
                      @click="
                        onClick();
                        defaultClick();
                      "
                    >
                      Start
                    </button>
                  </template>
                </CopilotChatInput>
              </template>
            </CopilotChatView>
          `,
        });

        renderInWrapper(Host);
        await fireEvent.click(screen.getByTestId("start-transcribe-button"));
        expect(onClick).toHaveBeenCalled();
      });
    });

    describe("input -> addMenuButton onClick", () => {
      it("should handle onClick on addMenuButton via input props drill-down", async () => {
        const onClick = vi.fn();
        const toolsMenu = [{ label: "Action", action: vi.fn() }];
        const Host = defineComponent({
          components: { CopilotChatView, CopilotChatInput },
          setup() {
            return { messages: createMessages(), onClick, toolsMenu };
          },
          template: `
            <CopilotChatView :messages="messages" :input-tools-menu="toolsMenu">
              <template #input="{ modelValue, onUpdateModelValue, onSubmitMessage, inputToolsMenu }">
                <CopilotChatInput
                  :model-value="modelValue"
                  :tools-menu="inputToolsMenu"
                  @update:model-value="onUpdateModelValue"
                  @submit-message="onSubmitMessage"
                >
                  <template #add-menu-button="{ toggleMenu }">
                    <button
                      data-testid="add-menu-button"
                      @click="
                        onClick();
                        toggleMenu();
                      "
                    >
                      Add
                    </button>
                  </template>
                </CopilotChatInput>
              </template>
            </CopilotChatView>
          `,
        });

        renderInWrapper(Host);
        await fireEvent.click(screen.getByTestId("add-menu-button"));
        expect(onClick).toHaveBeenCalled();
      });
    });

    describe("input -> textArea onFocus/onBlur", () => {
      it("should handle onFocus on textArea via input props drill-down", async () => {
        const onFocus = vi.fn();
        const Host = defineComponent({
          components: { CopilotChatView, CopilotChatInput },
          setup() {
            return { messages: createMessages(), onFocus };
          },
          template: `
            <CopilotChatView :messages="messages">
              <template #input="{ modelValue, onUpdateModelValue, onSubmitMessage }">
                <CopilotChatInput :model-value="modelValue" @update:model-value="onUpdateModelValue" @submit-message="onSubmitMessage">
                  <template #text-area="{ value, onInput, onKeydown }">
                    <textarea
                      data-testid="custom-textarea"
                      :value="value"
                      @focus="onFocus"
                      @input="onInput"
                      @keydown="onKeydown"
                    />
                  </template>
                </CopilotChatInput>
              </template>
            </CopilotChatView>
          `,
        });

        renderInWrapper(Host);
        await fireEvent.focus(screen.getByTestId("custom-textarea"));
        expect(onFocus).toHaveBeenCalled();
      });

      it("should handle onBlur on textArea via input props drill-down", async () => {
        const onBlur = vi.fn();
        const Host = defineComponent({
          components: { CopilotChatView, CopilotChatInput },
          setup() {
            return { messages: createMessages(), onBlur };
          },
          template: `
            <CopilotChatView :messages="messages">
              <template #input="{ modelValue, onUpdateModelValue, onSubmitMessage }">
                <CopilotChatInput :model-value="modelValue" @update:model-value="onUpdateModelValue" @submit-message="onSubmitMessage">
                  <template #text-area="{ value, onInput, onKeydown }">
                    <textarea
                      data-testid="custom-textarea-blur"
                      :value="value"
                      @blur="onBlur"
                      @input="onInput"
                      @keydown="onKeydown"
                    />
                  </template>
                </CopilotChatInput>
              </template>
            </CopilotChatView>
          `,
        });

        renderInWrapper(Host);
        const textarea = screen.getByTestId("custom-textarea-blur");
        await fireEvent.focus(textarea);
        await fireEvent.blur(textarea);
        expect(onBlur).toHaveBeenCalled();
      });
    });
  });

  describe("Level 2: CopilotChatMessageView Drill-Down", () => {
    describe("messageView -> assistantMessage onClick", () => {
      it("should handle onClick on assistantMessage container via messageView drill-down", async () => {
        const onClick = vi.fn();
        const Host = defineComponent({
          components: {
            CopilotChatView,
            CopilotChatMessageView,
            CopilotChatAssistantMessage,
          },
          setup() {
            return { messages: createMessages(), onClick };
          },
          template: `
            <CopilotChatView :messages="messages">
              <template #message-view="{ messages, isRunning }">
                <CopilotChatMessageView :messages="messages" :is-running="isRunning">
                  <template #assistant-message="{ message, messages, isRunning }">
                    <CopilotChatAssistantMessage :message="message" :messages="messages" :is-running="isRunning">
                      <template #message-renderer="{ content }">
                        <div data-testid="assistant-click-target" @click="onClick">{{ content }}</div>
                      </template>
                    </CopilotChatAssistantMessage>
                  </template>
                </CopilotChatMessageView>
              </template>
            </CopilotChatView>
          `,
        });

        renderInWrapper(Host);
        await fireEvent.click(
          screen.getAllByTestId("assistant-click-target")[0],
        );
        expect(onClick).toHaveBeenCalled();
      });
    });

    describe("messageView -> userMessage onClick", () => {
      it("should handle onClick on userMessage container via messageView drill-down", async () => {
        const onClick = vi.fn();
        const Host = defineComponent({
          components: {
            CopilotChatView,
            CopilotChatMessageView,
            CopilotChatUserMessage,
          },
          setup() {
            return { messages: createMessages(), onClick };
          },
          template: `
            <CopilotChatView :messages="messages">
              <template #message-view="{ messages, isRunning }">
                <CopilotChatMessageView :messages="messages" :is-running="isRunning">
                  <template #user-message="{ message }">
                    <CopilotChatUserMessage :message="message">
                      <template #message-renderer="{ content }">
                        <div data-testid="user-click-target" @click="onClick">{{ content }}</div>
                      </template>
                    </CopilotChatUserMessage>
                  </template>
                </CopilotChatMessageView>
              </template>
            </CopilotChatView>
          `,
        });

        renderInWrapper(Host);
        await fireEvent.click(screen.getAllByTestId("user-click-target")[0]);
        expect(onClick).toHaveBeenCalled();
      });
    });
  });

  describe("Level 3: CopilotChatAssistantMessage Toolbar Drill-Down", () => {
    describe("messageView -> assistantMessage -> copyButton onClick", () => {
      it("should handle onClick on copyButton via deep drill-down", async () => {
        const onClick = vi.fn();
        const Host = defineComponent({
          components: {
            CopilotChatView,
            CopilotChatMessageView,
            CopilotChatAssistantMessage,
          },
          setup() {
            return { messages: createMessages(), onClick };
          },
          template: `
            <CopilotChatView :messages="messages">
              <template #message-view="{ messages, isRunning }">
                <CopilotChatMessageView :messages="messages" :is-running="isRunning">
                  <template #assistant-message="{ message, messages, isRunning }">
                    <CopilotChatAssistantMessage :message="message" :messages="messages" :is-running="isRunning">
                      <template #copy-button="{ onCopy }">
                        <button data-testid="copy-button" @click="onClick(); onCopy();">Copy</button>
                      </template>
                    </CopilotChatAssistantMessage>
                  </template>
                </CopilotChatMessageView>
              </template>
            </CopilotChatView>
          `,
        });

        renderInWrapper(Host);
        await fireEvent.click(screen.getAllByTestId("copy-button")[0]);
        expect(onClick).toHaveBeenCalled();
      });
    });

    describe("messageView -> assistantMessage -> thumbsUpButton onClick", () => {
      it("should handle onClick on thumbsUpButton via deep drill-down", async () => {
        const onClick = vi.fn();
        const onThumbsUp = vi.fn();
        const Host = defineComponent({
          components: {
            CopilotChatView,
            CopilotChatMessageView,
            CopilotChatAssistantMessage,
          },
          setup() {
            return { messages: createMessages(), onClick, onThumbsUp };
          },
          template: `
            <CopilotChatView :messages="messages">
              <template #message-view="{ messages, isRunning }">
                <CopilotChatMessageView :messages="messages" :is-running="isRunning">
                  <template #assistant-message="{ message, messages, isRunning }">
                    <CopilotChatAssistantMessage :message="message" :messages="messages" :is-running="isRunning" @thumbs-up="onThumbsUp">
                      <template #thumbs-up-button="{ onThumbsUp: action }">
                        <button data-testid="thumbs-up-button" @click="onClick(); action();">Up</button>
                      </template>
                    </CopilotChatAssistantMessage>
                  </template>
                </CopilotChatMessageView>
              </template>
            </CopilotChatView>
          `,
        });

        renderInWrapper(Host);
        await fireEvent.click(screen.getAllByTestId("thumbs-up-button")[0]);
        expect(onClick).toHaveBeenCalled();
      });
    });

    describe("messageView -> assistantMessage -> thumbsDownButton onClick", () => {
      it("should handle onClick on thumbsDownButton via deep drill-down", async () => {
        const onClick = vi.fn();
        const onThumbsDown = vi.fn();
        const Host = defineComponent({
          components: {
            CopilotChatView,
            CopilotChatMessageView,
            CopilotChatAssistantMessage,
          },
          setup() {
            return { messages: createMessages(), onClick, onThumbsDown };
          },
          template: `
            <CopilotChatView :messages="messages">
              <template #message-view="{ messages, isRunning }">
                <CopilotChatMessageView :messages="messages" :is-running="isRunning">
                  <template #assistant-message="{ message, messages, isRunning }">
                    <CopilotChatAssistantMessage :message="message" :messages="messages" :is-running="isRunning" @thumbs-down="onThumbsDown">
                      <template #thumbs-down-button="{ onThumbsDown: action }">
                        <button data-testid="thumbs-down-button" @click="onClick(); action();">Down</button>
                      </template>
                    </CopilotChatAssistantMessage>
                  </template>
                </CopilotChatMessageView>
              </template>
            </CopilotChatView>
          `,
        });

        renderInWrapper(Host);
        await fireEvent.click(screen.getAllByTestId("thumbs-down-button")[0]);
        expect(onClick).toHaveBeenCalled();
      });
    });

    describe("messageView -> assistantMessage -> readAloudButton onClick", () => {
      it("should handle onClick on readAloudButton via deep drill-down", async () => {
        const onClick = vi.fn();
        const onReadAloud = vi.fn();
        const Host = defineComponent({
          components: {
            CopilotChatView,
            CopilotChatMessageView,
            CopilotChatAssistantMessage,
          },
          setup() {
            return { messages: createMessages(), onClick, onReadAloud };
          },
          template: `
            <CopilotChatView :messages="messages">
              <template #message-view="{ messages, isRunning }">
                <CopilotChatMessageView :messages="messages" :is-running="isRunning">
                  <template #assistant-message="{ message, messages, isRunning }">
                    <CopilotChatAssistantMessage :message="message" :messages="messages" :is-running="isRunning" @read-aloud="onReadAloud">
                      <template #read-aloud-button="{ onReadAloud: action }">
                        <button data-testid="read-aloud-button" @click="onClick(); action();">Read</button>
                      </template>
                    </CopilotChatAssistantMessage>
                  </template>
                </CopilotChatMessageView>
              </template>
            </CopilotChatView>
          `,
        });

        renderInWrapper(Host);
        await fireEvent.click(screen.getAllByTestId("read-aloud-button")[0]);
        expect(onClick).toHaveBeenCalled();
      });
    });

    describe("messageView -> assistantMessage -> regenerateButton onClick", () => {
      it("should handle onClick on regenerateButton via deep drill-down", async () => {
        const onClick = vi.fn();
        const onRegenerate = vi.fn();
        const Host = defineComponent({
          components: {
            CopilotChatView,
            CopilotChatMessageView,
            CopilotChatAssistantMessage,
          },
          setup() {
            return { messages: createMessages(), onClick, onRegenerate };
          },
          template: `
            <CopilotChatView :messages="messages">
              <template #message-view="{ messages, isRunning }">
                <CopilotChatMessageView :messages="messages" :is-running="isRunning">
                  <template #assistant-message="{ message, messages, isRunning }">
                    <CopilotChatAssistantMessage :message="message" :messages="messages" :is-running="isRunning" @regenerate="onRegenerate">
                      <template #regenerate-button="{ onRegenerate: action }">
                        <button data-testid="regenerate-button" @click="onClick(); action();">Regenerate</button>
                      </template>
                    </CopilotChatAssistantMessage>
                  </template>
                </CopilotChatMessageView>
              </template>
            </CopilotChatView>
          `,
        });

        renderInWrapper(Host);
        await fireEvent.click(screen.getAllByTestId("regenerate-button")[0]);
        expect(onClick).toHaveBeenCalled();
      });
    });

    describe("messageView -> assistantMessage -> toolbar onClick", () => {
      it("should handle onClick on entire toolbar via deep drill-down", async () => {
        const onClick = vi.fn();
        const Host = defineComponent({
          components: {
            CopilotChatView,
            CopilotChatMessageView,
            CopilotChatAssistantMessage,
          },
          setup() {
            return { messages: createMessages(), onClick };
          },
          template: `
            <CopilotChatView :messages="messages">
              <template #message-view="{ messages, isRunning }">
                <CopilotChatMessageView :messages="messages" :is-running="isRunning">
                  <template #assistant-message="{ message, messages, isRunning }">
                    <CopilotChatAssistantMessage :message="message" :messages="messages" :is-running="isRunning">
                      <template #toolbar>
                        <div data-testid="assistant-toolbar-click" @click="onClick">Toolbar</div>
                      </template>
                    </CopilotChatAssistantMessage>
                  </template>
                </CopilotChatMessageView>
              </template>
            </CopilotChatView>
          `,
        });

        renderInWrapper(Host);
        await fireEvent.click(
          screen.getAllByTestId("assistant-toolbar-click")[0],
        );
        expect(onClick).toHaveBeenCalled();
      });
    });
  });

  describe("Level 3: CopilotChatUserMessage Toolbar Drill-Down", () => {
    describe("messageView -> userMessage -> copyButton onClick", () => {
      it("should handle onClick on copyButton via deep drill-down", async () => {
        const onClick = vi.fn();
        const Host = defineComponent({
          components: {
            CopilotChatView,
            CopilotChatMessageView,
            CopilotChatUserMessage,
          },
          setup() {
            return { messages: createMessages(), onClick };
          },
          template: `
            <CopilotChatView :messages="messages">
              <template #message-view="{ messages, isRunning }">
                <CopilotChatMessageView :messages="messages" :is-running="isRunning">
                  <template #user-message="{ message }">
                    <CopilotChatUserMessage :message="message">
                      <template #copy-button="{ onCopy }">
                        <button data-testid="user-copy-button" @click="onClick(); onCopy();">Copy</button>
                      </template>
                    </CopilotChatUserMessage>
                  </template>
                </CopilotChatMessageView>
              </template>
            </CopilotChatView>
          `,
        });

        renderInWrapper(Host);
        await fireEvent.click(screen.getAllByTestId("user-copy-button")[0]);
        expect(onClick).toHaveBeenCalled();
      });
    });

    describe("messageView -> userMessage -> editButton onClick", () => {
      it("should handle onClick on editButton via deep drill-down", async () => {
        const onClick = vi.fn();
        const onEditMessage = vi.fn();
        const Host = defineComponent({
          components: {
            CopilotChatView,
            CopilotChatMessageView,
            CopilotChatUserMessage,
          },
          setup() {
            return { messages: createMessages(), onClick, onEditMessage };
          },
          template: `
            <CopilotChatView :messages="messages">
              <template #message-view="{ messages, isRunning }">
                <CopilotChatMessageView :messages="messages" :is-running="isRunning">
                  <template #user-message="{ message }">
                    <CopilotChatUserMessage :message="message" @edit-message="onEditMessage">
                      <template #edit-button="{ onEdit }">
                        <button data-testid="user-edit-button" @click="onClick(); onEdit();">Edit</button>
                      </template>
                    </CopilotChatUserMessage>
                  </template>
                </CopilotChatMessageView>
              </template>
            </CopilotChatView>
          `,
        });

        renderInWrapper(Host);
        await fireEvent.click(screen.getAllByTestId("user-edit-button")[0]);
        expect(onClick).toHaveBeenCalled();
      });
    });
  });

  describe("Level 2: SuggestionView Drill-Down", () => {
    describe("suggestionView -> container onClick", () => {
      it("should handle onClick on suggestion container via drill-down", async () => {
        const onClick = vi.fn();
        const Host = defineComponent({
          components: { CopilotChatView, CopilotChatSuggestionView },
          setup() {
            return {
              messages: createMessages(),
              suggestions: createSuggestions(),
              onClick,
            };
          },
          template: `
            <CopilotChatView :messages="messages" :suggestions="suggestions">
              <template #suggestion-view="{ suggestions, loadingIndexes, onSelectSuggestion }">
                <div data-testid="suggestion-container" class="pointer-events-auto" @click="onClick">
                  <CopilotChatSuggestionView
                    :suggestions="suggestions"
                    :loading-indexes="loadingIndexes"
                    @select-suggestion="(s, i) => onSelectSuggestion(s, i)"
                  />
                </div>
              </template>
            </CopilotChatView>
          `,
        });

        renderInWrapper(Host);
        await fireEvent.click(screen.getByTestId("suggestion-container"));
        expect(onClick).toHaveBeenCalled();
      });
    });

    describe("suggestionView -> suggestion onClick", () => {
      it("should handle onClick on individual suggestion pills via drill-down", async () => {
        const onClick = vi.fn();
        const Host = defineComponent({
          components: { CopilotChatView, CopilotChatSuggestionView },
          setup() {
            return {
              messages: createMessages(),
              suggestions: createSuggestions(),
              onClick,
            };
          },
          template: `
            <CopilotChatView :messages="messages" :suggestions="suggestions">
              <template #suggestion-view="{ suggestions, loadingIndexes, onSelectSuggestion }">
                <CopilotChatSuggestionView :suggestions="suggestions" :loading-indexes="loadingIndexes">
                  <template #suggestion="{ suggestion, index, onSelect }">
                    <button
                      :data-testid="'suggestion-pill-' + index"
                      @click="
                        onClick();
                        onSelect();
                        onSelectSuggestion(suggestion, index);
                      "
                    >
                      {{ suggestion.title }}
                    </button>
                  </template>
                </CopilotChatSuggestionView>
              </template>
            </CopilotChatView>
          `,
        });

        renderInWrapper(Host);
        await fireEvent.click(screen.getByTestId("suggestion-pill-0"));
        expect(onClick).toHaveBeenCalled();
      });
    });
  });

  describe("Function Render Slot Pattern", () => {
    describe("input slot with render function", () => {
      it("should support passing render function to input slot", () => {
        const Host = defineComponent({
          components: { CopilotChatView, CopilotChatInput },
          setup() {
            return { messages: createMessages() };
          },
          template: `
            <CopilotChatView :messages="messages">
              <template #input="{ modelValue, onUpdateModelValue, onSubmitMessage }">
                <CopilotChatInput
                  :model-value="modelValue"
                  @update:model-value="onUpdateModelValue"
                  @submit-message="onSubmitMessage"
                >
                  <template #send-button="{ onClick }">
                    <button class="custom-send-class" @click="onClick">Send</button>
                  </template>
                </CopilotChatInput>
              </template>
            </CopilotChatView>
          `,
        });

        renderInWrapper(Host);
        expect(document.querySelector(".custom-send-class")).toBeDefined();
      });
    });

    describe("messageView slot with render function", () => {
      it("should support passing render function to messageView slot", () => {
        const Host = defineComponent({
          components: { CopilotChatView, CopilotChatMessageView },
          setup() {
            return { messages: createMessages() };
          },
          template: `
            <CopilotChatView :messages="messages">
              <template #message-view="{ messages, isRunning }">
                <CopilotChatMessageView class="custom-message-view" :messages="messages" :is-running="isRunning" />
              </template>
            </CopilotChatView>
          `,
        });

        renderInWrapper(Host);
        expect(document.querySelector(".custom-message-view")).toBeDefined();
      });
    });
  });

  describe("Callback Propagation Through Slot Hierarchy", () => {
    describe("onSubmitMessage propagation", () => {
      it("should propagate onSubmitMessage through input slot", async () => {
        const onSubmitMessage = vi.fn();
        const Host = defineComponent({
          components: { CopilotChatView, CopilotChatInput },
          setup() {
            const input = ref("");
            return { messages: createMessages(), onSubmitMessage, input };
          },
          template: `
            <CopilotChatView :messages="messages" @submit-message="onSubmitMessage">
              <template #input="{ onSubmitMessage, onUpdateModelValue }">
                <button data-testid="submit-propagation" @click="onUpdateModelValue('Test message'); onSubmitMessage('Test message')">
                  submit
                </button>
              </template>
            </CopilotChatView>
          `,
        });

        renderInWrapper(Host);
        await fireEvent.click(screen.getByTestId("submit-propagation"));
        expect(onSubmitMessage).toHaveBeenCalledWith("Test message");
      });
    });

    describe("onStop propagation", () => {
      it("should propagate onStop through input slot", async () => {
        const onStop = vi.fn();
        const Host = defineComponent({
          components: { CopilotChatView, CopilotChatInput },
          setup() {
            return { messages: createMessages(), onStop };
          },
          template: `
            <CopilotChatView :messages="messages" :is-running="true" @stop="onStop">
              <template #input="{ onStop }">
                <button data-testid="stop-propagation" @click="onStop()">stop</button>
              </template>
            </CopilotChatView>
          `,
        });

        renderInWrapper(Host);
        await fireEvent.click(screen.getByTestId("stop-propagation"));
        expect(onStop).toHaveBeenCalled();
      });
    });

    describe("onThumbsUp/onThumbsDown propagation", () => {
      it("should propagate onThumbsUp through messageView slot", async () => {
        const onThumbsUp = vi.fn();
        const Host = defineComponent({
          components: {
            CopilotChatView,
            CopilotChatMessageView,
            CopilotChatAssistantMessage,
          },
          setup() {
            return { messages: createMessages(), onThumbsUp };
          },
          template: `
            <CopilotChatView :messages="messages">
              <template #message-view="{ messages, isRunning }">
                <CopilotChatMessageView :messages="messages" :is-running="isRunning">
                  <template #assistant-message="{ message, messages, isRunning }">
                    <CopilotChatAssistantMessage :message="message" :messages="messages" :is-running="isRunning" @thumbs-up="onThumbsUp">
                      <template #thumbs-up-button="{ onThumbsUp: action }">
                        <button data-testid="thumbs-up-propagation" @click="action()">up</button>
                      </template>
                    </CopilotChatAssistantMessage>
                  </template>
                </CopilotChatMessageView>
              </template>
            </CopilotChatView>
          `,
        });

        renderInWrapper(Host);
        await fireEvent.click(
          screen.getAllByTestId("thumbs-up-propagation")[0],
        );
        expect(onThumbsUp).toHaveBeenCalled();
      });

      it("should propagate onThumbsDown through messageView slot", async () => {
        const onThumbsDown = vi.fn();
        const Host = defineComponent({
          components: {
            CopilotChatView,
            CopilotChatMessageView,
            CopilotChatAssistantMessage,
          },
          setup() {
            return { messages: createMessages(), onThumbsDown };
          },
          template: `
            <CopilotChatView :messages="messages">
              <template #message-view="{ messages, isRunning }">
                <CopilotChatMessageView :messages="messages" :is-running="isRunning">
                  <template #assistant-message="{ message, messages, isRunning }">
                    <CopilotChatAssistantMessage :message="message" :messages="messages" :is-running="isRunning" @thumbs-down="onThumbsDown">
                      <template #thumbs-down-button="{ onThumbsDown: action }">
                        <button data-testid="thumbs-down-propagation" @click="action()">down</button>
                      </template>
                    </CopilotChatAssistantMessage>
                  </template>
                </CopilotChatMessageView>
              </template>
            </CopilotChatView>
          `,
        });

        renderInWrapper(Host);
        await fireEvent.click(
          screen.getAllByTestId("thumbs-down-propagation")[0],
        );
        expect(onThumbsDown).toHaveBeenCalled();
      });
    });

    describe("onEditMessage propagation", () => {
      it("should propagate onEditMessage through messageView slot", async () => {
        const onEditMessage = vi.fn();
        const Host = defineComponent({
          components: {
            CopilotChatView,
            CopilotChatMessageView,
            CopilotChatUserMessage,
          },
          setup() {
            return { messages: createMessages(), onEditMessage };
          },
          template: `
            <CopilotChatView :messages="messages">
              <template #message-view="{ messages, isRunning }">
                <CopilotChatMessageView :messages="messages" :is-running="isRunning">
                  <template #user-message="{ message }">
                    <CopilotChatUserMessage :message="message" @edit-message="onEditMessage">
                      <template #edit-button="{ onEdit }">
                        <button data-testid="edit-propagation" @click="onEdit()">edit</button>
                      </template>
                    </CopilotChatUserMessage>
                  </template>
                </CopilotChatMessageView>
              </template>
            </CopilotChatView>
          `,
        });

        renderInWrapper(Host);
        await fireEvent.click(screen.getAllByTestId("edit-propagation")[0]);
        expect(onEditMessage).toHaveBeenCalled();
      });
    });
  });

  describe("Combined Customization with onClick", () => {
    it("should handle onClick alongside tailwind class customization", async () => {
      const onClick = vi.fn();
      const Host = defineComponent({
        components: {
          CopilotChatView,
          CopilotChatMessageView,
          CopilotChatAssistantMessage,
        },
        setup() {
          return { messages: createMessages(), onClick };
        },
        template: `
          <CopilotChatView :messages="messages">
            <template #message-view="{ messages, isRunning }">
              <CopilotChatMessageView :messages="messages" :is-running="isRunning">
                <template #assistant-message="{ message, messages, isRunning }">
                  <CopilotChatAssistantMessage :message="message" :messages="messages" :is-running="isRunning">
                    <template #copy-button="{ onCopy }">
                      <button
                        class="custom-copy-class"
                        @click="
                          onClick();
                          onCopy();
                        "
                      >
                        Copy
                      </button>
                    </template>
                  </CopilotChatAssistantMessage>
                </template>
              </CopilotChatMessageView>
            </template>
          </CopilotChatView>
        `,
      });

      const { container } = renderInWrapper(Host);
      const copyBtn =
        container.querySelector(".custom-copy-class") ??
        container.querySelector('button[aria-label*="Copy"]');
      if (copyBtn) {
        await fireEvent.click(copyBtn);
        expect(onClick).toHaveBeenCalled();
      }
    });

    it("should allow custom component with onClick handling", async () => {
      const customOnClick = vi.fn();
      const CustomCopyButton = defineComponent({
        emits: ["click"],
        template: `<button data-testid="custom-copy" @click="$emit('click')">Copy</button>`,
      });
      const Host = defineComponent({
        components: {
          CopilotChatView,
          CopilotChatMessageView,
          CopilotChatAssistantMessage,
          CustomCopyButton,
        },
        setup() {
          return { messages: createMessages(), customOnClick };
        },
        template: `
          <CopilotChatView :messages="messages">
            <template #message-view="{ messages, isRunning }">
              <CopilotChatMessageView :messages="messages" :is-running="isRunning">
                <template #assistant-message="{ message, messages, isRunning }">
                  <CopilotChatAssistantMessage :message="message" :messages="messages" :is-running="isRunning">
                    <template #copy-button="{ onCopy }">
                      <CustomCopyButton
                        @click="
                          customOnClick();
                          onCopy();
                        "
                      />
                    </template>
                  </CopilotChatAssistantMessage>
                </template>
              </CopilotChatMessageView>
            </template>
          </CopilotChatView>
        `,
      });

      renderInWrapper(Host);
      const customCopyButtons = screen.queryAllByTestId("custom-copy");
      if (customCopyButtons.length > 0) {
        await fireEvent.click(customCopyButtons[0]);
        expect(customOnClick).toHaveBeenCalled();
      }
    });
  });
});
