import { defineComponent } from "vue";
import { render, screen, fireEvent, waitFor } from "@testing-library/vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantMessage } from "@ag-ui/core";
import CopilotKitProvider from "../../../providers/CopilotKitProvider.vue";
import CopilotChatConfigurationProvider from "../../../providers/CopilotChatConfigurationProvider.vue";
import CopilotChatAssistantMessage from "../CopilotChatAssistantMessage.vue";

const TEST_THREAD_ID = "test-thread";

const mockWriteText = vi.fn();
Object.assign(navigator, {
  clipboard: {
    writeText: mockWriteText,
  },
});

const mockOnThumbsUp = vi.fn();
const mockOnThumbsDown = vi.fn();
const mockOnReadAloud = vi.fn();
const mockOnRegenerate = vi.fn();

const basicMessage: AssistantMessage = {
  role: "assistant",
  content: "Hello, this is a test message from the assistant.",
  id: "test-message-1",
};

function renderWithProvider(component: object) {
  return render(component);
}

beforeEach(() => {
  mockWriteText.mockReset();
  mockOnThumbsUp.mockClear();
  mockOnThumbsDown.mockClear();
  mockOnReadAloud.mockClear();
  mockOnRegenerate.mockClear();
});

describe("CopilotChatAssistantMessage", () => {
  describe("Basic rendering", () => {
    it("renders with default components and styling", () => {
      const Host = defineComponent({
        components: {
          CopilotKitProvider,
          CopilotChatConfigurationProvider,
          CopilotChatAssistantMessage,
        },
        setup() {
          return { basicMessage, TEST_THREAD_ID };
        },
        template: `
          <CopilotKitProvider runtime-url="/api/copilotkit">
            <CopilotChatConfigurationProvider :thread-id="TEST_THREAD_ID">
              <CopilotChatAssistantMessage :message="basicMessage" />
            </CopilotChatConfigurationProvider>
          </CopilotKitProvider>
        `,
      });

      renderWithProvider(Host);
      expect(screen.getByRole("button", { name: /copy/i })).toBeDefined();
    });

    it("renders empty message gracefully", () => {
      const emptyMessage: AssistantMessage = {
        role: "assistant",
        content: "",
        id: "empty-message",
      };

      const Host = defineComponent({
        components: {
          CopilotKitProvider,
          CopilotChatConfigurationProvider,
          CopilotChatAssistantMessage,
        },
        setup() {
          return { emptyMessage, TEST_THREAD_ID };
        },
        template: `
          <CopilotKitProvider runtime-url="/api/copilotkit">
            <CopilotChatConfigurationProvider :thread-id="TEST_THREAD_ID">
              <CopilotChatAssistantMessage :message="emptyMessage" />
            </CopilotChatConfigurationProvider>
          </CopilotKitProvider>
        `,
      });

      renderWithProvider(Host);

      const container = document.querySelector(
        '[data-message-id="empty-message"]',
      );
      expect(container).toBeDefined();
      expect(screen.queryByRole("button", { name: /copy/i })).toBeNull();
    });
  });

  describe("Callback functionality", () => {
    it("renders only copy button when no callbacks provided", () => {
      const Host = defineComponent({
        components: {
          CopilotKitProvider,
          CopilotChatConfigurationProvider,
          CopilotChatAssistantMessage,
        },
        setup() {
          return { basicMessage, TEST_THREAD_ID };
        },
        template: `
          <CopilotKitProvider runtime-url="/api/copilotkit">
            <CopilotChatConfigurationProvider :thread-id="TEST_THREAD_ID">
              <CopilotChatAssistantMessage :message="basicMessage" />
            </CopilotChatConfigurationProvider>
          </CopilotKitProvider>
        `,
      });

      renderWithProvider(Host);

      expect(screen.getByRole("button", { name: /copy/i })).toBeDefined();
      expect(
        screen.queryByRole("button", { name: /good response/i }),
      ).toBeNull();
      expect(
        screen.queryByRole("button", { name: /bad response/i }),
      ).toBeNull();
      expect(screen.queryByRole("button", { name: /read aloud/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /regenerate/i })).toBeNull();
    });

    it("renders all buttons when all callbacks provided", () => {
      const Host = defineComponent({
        components: {
          CopilotKitProvider,
          CopilotChatConfigurationProvider,
          CopilotChatAssistantMessage,
        },
        setup() {
          return {
            basicMessage,
            TEST_THREAD_ID,
            onThumbsUp: mockOnThumbsUp,
            onThumbsDown: mockOnThumbsDown,
            onReadAloud: mockOnReadAloud,
            onRegenerate: mockOnRegenerate,
          };
        },
        template: `
          <CopilotKitProvider runtime-url="/api/copilotkit">
            <CopilotChatConfigurationProvider :thread-id="TEST_THREAD_ID">
              <CopilotChatAssistantMessage
                :message="basicMessage"
                @thumbs-up="onThumbsUp"
                @thumbs-down="onThumbsDown"
                @read-aloud="onReadAloud"
                @regenerate="onRegenerate"
              />
            </CopilotChatConfigurationProvider>
          </CopilotKitProvider>
        `,
      });

      renderWithProvider(Host);

      expect(screen.getByRole("button", { name: /copy/i })).toBeDefined();
      expect(
        screen.getByRole("button", { name: /good response/i }),
      ).toBeDefined();
      expect(
        screen.getByRole("button", { name: /bad response/i }),
      ).toBeDefined();
      expect(screen.getByRole("button", { name: /read aloud/i })).toBeDefined();
      expect(screen.getByRole("button", { name: /regenerate/i })).toBeDefined();
    });

    it("calls copy functionality when copy button clicked", async () => {
      const Host = defineComponent({
        components: {
          CopilotKitProvider,
          CopilotChatConfigurationProvider,
          CopilotChatAssistantMessage,
        },
        setup() {
          return { basicMessage, TEST_THREAD_ID };
        },
        template: `
          <CopilotKitProvider runtime-url="/api/copilotkit">
            <CopilotChatConfigurationProvider :thread-id="TEST_THREAD_ID">
              <CopilotChatAssistantMessage :message="basicMessage" />
            </CopilotChatConfigurationProvider>
          </CopilotKitProvider>
        `,
      });

      renderWithProvider(Host);

      fireEvent.click(screen.getByRole("button", { name: /copy/i }));
      await waitFor(() => {
        expect(mockWriteText).toHaveBeenCalledWith(basicMessage.content);
      });
    });

    it("calls thumbs up callback when thumbs up button clicked", () => {
      const Host = defineComponent({
        components: {
          CopilotKitProvider,
          CopilotChatConfigurationProvider,
          CopilotChatAssistantMessage,
        },
        setup() {
          return { basicMessage, TEST_THREAD_ID, onThumbsUp: mockOnThumbsUp };
        },
        template: `
          <CopilotKitProvider runtime-url="/api/copilotkit">
            <CopilotChatConfigurationProvider :thread-id="TEST_THREAD_ID">
              <CopilotChatAssistantMessage :message="basicMessage" @thumbs-up="onThumbsUp" />
            </CopilotChatConfigurationProvider>
          </CopilotKitProvider>
        `,
      });

      renderWithProvider(Host);
      fireEvent.click(screen.getByRole("button", { name: /good response/i }));
      expect(mockOnThumbsUp).toHaveBeenCalledTimes(1);
    });

    it("calls thumbs down callback when thumbs down button clicked", () => {
      const Host = defineComponent({
        components: {
          CopilotKitProvider,
          CopilotChatConfigurationProvider,
          CopilotChatAssistantMessage,
        },
        setup() {
          return {
            basicMessage,
            TEST_THREAD_ID,
            onThumbsDown: mockOnThumbsDown,
          };
        },
        template: `
          <CopilotKitProvider runtime-url="/api/copilotkit">
            <CopilotChatConfigurationProvider :thread-id="TEST_THREAD_ID">
              <CopilotChatAssistantMessage :message="basicMessage" @thumbs-down="onThumbsDown" />
            </CopilotChatConfigurationProvider>
          </CopilotKitProvider>
        `,
      });

      renderWithProvider(Host);
      fireEvent.click(screen.getByRole("button", { name: /bad response/i }));
      expect(mockOnThumbsDown).toHaveBeenCalledTimes(1);
    });

    it("calls read aloud callback when read aloud button clicked", () => {
      const Host = defineComponent({
        components: {
          CopilotKitProvider,
          CopilotChatConfigurationProvider,
          CopilotChatAssistantMessage,
        },
        setup() {
          return { basicMessage, TEST_THREAD_ID, onReadAloud: mockOnReadAloud };
        },
        template: `
          <CopilotKitProvider runtime-url="/api/copilotkit">
            <CopilotChatConfigurationProvider :thread-id="TEST_THREAD_ID">
              <CopilotChatAssistantMessage :message="basicMessage" @read-aloud="onReadAloud" />
            </CopilotChatConfigurationProvider>
          </CopilotKitProvider>
        `,
      });

      renderWithProvider(Host);
      fireEvent.click(screen.getByRole("button", { name: /read aloud/i }));
      expect(mockOnReadAloud).toHaveBeenCalledTimes(1);
    });

    it("calls regenerate callback when regenerate button clicked", () => {
      const Host = defineComponent({
        components: {
          CopilotKitProvider,
          CopilotChatConfigurationProvider,
          CopilotChatAssistantMessage,
        },
        setup() {
          return {
            basicMessage,
            TEST_THREAD_ID,
            onRegenerate: mockOnRegenerate,
          };
        },
        template: `
          <CopilotKitProvider runtime-url="/api/copilotkit">
            <CopilotChatConfigurationProvider :thread-id="TEST_THREAD_ID">
              <CopilotChatAssistantMessage :message="basicMessage" @regenerate="onRegenerate" />
            </CopilotChatConfigurationProvider>
          </CopilotKitProvider>
        `,
      });

      renderWithProvider(Host);
      fireEvent.click(screen.getByRole("button", { name: /regenerate/i }));
      expect(mockOnRegenerate).toHaveBeenCalledTimes(1);
    });
  });

  describe("Additional toolbar items", () => {
    it("renders additional toolbar items", () => {
      const Host = defineComponent({
        components: {
          CopilotKitProvider,
          CopilotChatConfigurationProvider,
          CopilotChatAssistantMessage,
        },
        setup() {
          return { basicMessage, TEST_THREAD_ID };
        },
        template: `
          <CopilotKitProvider runtime-url="/api/copilotkit">
            <CopilotChatConfigurationProvider :thread-id="TEST_THREAD_ID">
              <CopilotChatAssistantMessage :message="basicMessage">
                <template #toolbar-items>
                  <button data-testid="custom-toolbar-item">Custom Action</button>
                </template>
              </CopilotChatAssistantMessage>
            </CopilotChatConfigurationProvider>
          </CopilotKitProvider>
        `,
      });

      renderWithProvider(Host);
      expect(screen.getByTestId("custom-toolbar-item")).toBeDefined();
    });
  });

  describe("Slot functionality - Custom Components", () => {
    it("accepts custom MarkdownRenderer component", () => {
      const Host = defineComponent({
        components: {
          CopilotKitProvider,
          CopilotChatConfigurationProvider,
          CopilotChatAssistantMessage,
        },
        setup() {
          return { basicMessage, TEST_THREAD_ID };
        },
        template: `
          <CopilotKitProvider runtime-url="/api/copilotkit">
            <CopilotChatConfigurationProvider :thread-id="TEST_THREAD_ID">
              <CopilotChatAssistantMessage :message="basicMessage">
                <template #message-renderer="{ content }">
                  <div data-testid="custom-markdown">{{ content.toUpperCase() }}</div>
                </template>
              </CopilotChatAssistantMessage>
            </CopilotChatConfigurationProvider>
          </CopilotKitProvider>
        `,
      });

      renderWithProvider(Host);
      expect(screen.getByTestId("custom-markdown")).toBeDefined();
      expect(
        screen
          .getByTestId("custom-markdown")
          .textContent?.includes(basicMessage.content.toUpperCase()),
      ).toBe(true);
    });

    it("accepts custom Toolbar component", () => {
      const Host = defineComponent({
        components: {
          CopilotKitProvider,
          CopilotChatConfigurationProvider,
          CopilotChatAssistantMessage,
        },
        setup() {
          return { basicMessage, TEST_THREAD_ID };
        },
        template: `
          <CopilotKitProvider runtime-url="/api/copilotkit">
            <CopilotChatConfigurationProvider :thread-id="TEST_THREAD_ID">
              <CopilotChatAssistantMessage :message="basicMessage">
                <template #toolbar>
                  <div data-testid="custom-toolbar">Custom Toolbar:</div>
                </template>
              </CopilotChatAssistantMessage>
            </CopilotChatConfigurationProvider>
          </CopilotKitProvider>
        `,
      });

      renderWithProvider(Host);
      expect(screen.getByTestId("custom-toolbar")).toBeDefined();
      expect(
        screen
          .getByTestId("custom-toolbar")
          .textContent?.includes("Custom Toolbar:"),
      ).toBe(true);
    });

    it("accepts custom CopyButton component", () => {
      const Host = defineComponent({
        components: {
          CopilotKitProvider,
          CopilotChatConfigurationProvider,
          CopilotChatAssistantMessage,
        },
        setup() {
          return { basicMessage, TEST_THREAD_ID };
        },
        template: `
          <CopilotKitProvider runtime-url="/api/copilotkit">
            <CopilotChatConfigurationProvider :thread-id="TEST_THREAD_ID">
              <CopilotChatAssistantMessage :message="basicMessage">
                <template #copy-button="{ onCopy }">
                  <button data-testid="custom-copy-button" @click="onCopy">Custom Copy</button>
                </template>
              </CopilotChatAssistantMessage>
            </CopilotChatConfigurationProvider>
          </CopilotKitProvider>
        `,
      });

      renderWithProvider(Host);
      expect(screen.getByTestId("custom-copy-button")).toBeDefined();
      expect(
        screen
          .getByTestId("custom-copy-button")
          .textContent?.includes("Custom Copy"),
      ).toBe(true);
    });

    it("accepts custom ThumbsUpButton component", () => {
      const Host = defineComponent({
        components: {
          CopilotKitProvider,
          CopilotChatConfigurationProvider,
          CopilotChatAssistantMessage,
        },
        setup() {
          return { basicMessage, TEST_THREAD_ID, onThumbsUp: mockOnThumbsUp };
        },
        template: `
          <CopilotKitProvider runtime-url="/api/copilotkit">
            <CopilotChatConfigurationProvider :thread-id="TEST_THREAD_ID">
              <CopilotChatAssistantMessage :message="basicMessage" @thumbs-up="onThumbsUp">
                <template #thumbs-up-button="{ onThumbsUp: onClick }">
                  <button data-testid="custom-thumbs-up" @click="onClick">Custom Like</button>
                </template>
              </CopilotChatAssistantMessage>
            </CopilotChatConfigurationProvider>
          </CopilotKitProvider>
        `,
      });

      renderWithProvider(Host);
      expect(screen.getByTestId("custom-thumbs-up")).toBeDefined();
      expect(
        screen
          .getByTestId("custom-thumbs-up")
          .textContent?.includes("Custom Like"),
      ).toBe(true);
    });

    it("accepts custom ThumbsDownButton component", () => {
      const Host = defineComponent({
        components: {
          CopilotKitProvider,
          CopilotChatConfigurationProvider,
          CopilotChatAssistantMessage,
        },
        setup() {
          return {
            basicMessage,
            TEST_THREAD_ID,
            onThumbsDown: mockOnThumbsDown,
          };
        },
        template: `
          <CopilotKitProvider runtime-url="/api/copilotkit">
            <CopilotChatConfigurationProvider :thread-id="TEST_THREAD_ID">
              <CopilotChatAssistantMessage :message="basicMessage" @thumbs-down="onThumbsDown">
                <template #thumbs-down-button="{ onThumbsDown: onClick }">
                  <button data-testid="custom-thumbs-down" @click="onClick">Custom Dislike</button>
                </template>
              </CopilotChatAssistantMessage>
            </CopilotChatConfigurationProvider>
          </CopilotKitProvider>
        `,
      });

      renderWithProvider(Host);
      expect(screen.getByTestId("custom-thumbs-down")).toBeDefined();
      expect(
        screen
          .getByTestId("custom-thumbs-down")
          .textContent?.includes("Custom Dislike"),
      ).toBe(true);
    });

    it("accepts custom ReadAloudButton component", () => {
      const Host = defineComponent({
        components: {
          CopilotKitProvider,
          CopilotChatConfigurationProvider,
          CopilotChatAssistantMessage,
        },
        setup() {
          return { basicMessage, TEST_THREAD_ID, onReadAloud: mockOnReadAloud };
        },
        template: `
          <CopilotKitProvider runtime-url="/api/copilotkit">
            <CopilotChatConfigurationProvider :thread-id="TEST_THREAD_ID">
              <CopilotChatAssistantMessage :message="basicMessage" @read-aloud="onReadAloud">
                <template #read-aloud-button="{ onReadAloud: onClick }">
                  <button data-testid="custom-read-aloud" @click="onClick">Custom Speak</button>
                </template>
              </CopilotChatAssistantMessage>
            </CopilotChatConfigurationProvider>
          </CopilotKitProvider>
        `,
      });

      renderWithProvider(Host);
      expect(screen.getByTestId("custom-read-aloud")).toBeDefined();
      expect(
        screen
          .getByTestId("custom-read-aloud")
          .textContent?.includes("Custom Speak"),
      ).toBe(true);
    });

    it("accepts custom RegenerateButton component", () => {
      const Host = defineComponent({
        components: {
          CopilotKitProvider,
          CopilotChatConfigurationProvider,
          CopilotChatAssistantMessage,
        },
        setup() {
          return {
            basicMessage,
            TEST_THREAD_ID,
            onRegenerate: mockOnRegenerate,
          };
        },
        template: `
          <CopilotKitProvider runtime-url="/api/copilotkit">
            <CopilotChatConfigurationProvider :thread-id="TEST_THREAD_ID">
              <CopilotChatAssistantMessage :message="basicMessage" @regenerate="onRegenerate">
                <template #regenerate-button="{ onRegenerate: onClick }">
                  <button data-testid="custom-regenerate" @click="onClick">Custom Retry</button>
                </template>
              </CopilotChatAssistantMessage>
            </CopilotChatConfigurationProvider>
          </CopilotKitProvider>
        `,
      });

      renderWithProvider(Host);
      expect(screen.getByTestId("custom-regenerate")).toBeDefined();
      expect(
        screen
          .getByTestId("custom-regenerate")
          .textContent?.includes("Custom Retry"),
      ).toBe(true);
    });
  });

  describe("Slot functionality - Custom Classes", () => {
    it("applies custom className to component", () => {
      const Host = defineComponent({
        components: {
          CopilotKitProvider,
          CopilotChatConfigurationProvider,
          CopilotChatAssistantMessage,
        },
        setup() {
          return { basicMessage, TEST_THREAD_ID };
        },
        template: `
          <CopilotKitProvider runtime-url="/api/copilotkit">
            <CopilotChatConfigurationProvider :thread-id="TEST_THREAD_ID">
              <CopilotChatAssistantMessage :message="basicMessage" class="custom-container-class" />
            </CopilotChatConfigurationProvider>
          </CopilotKitProvider>
        `,
      });

      const { container } = renderWithProvider(Host);
      expect(container.querySelector(".custom-container-class")).toBeDefined();
    });

    it("applies custom className to MarkdownRenderer slot", () => {
      const Host = defineComponent({
        components: {
          CopilotKitProvider,
          CopilotChatConfigurationProvider,
          CopilotChatAssistantMessage,
        },
        setup() {
          return { basicMessage, TEST_THREAD_ID };
        },
        template: `
          <CopilotKitProvider runtime-url="/api/copilotkit">
            <CopilotChatConfigurationProvider :thread-id="TEST_THREAD_ID">
              <CopilotChatAssistantMessage :message="basicMessage">
                <template #message-renderer="{ content }">
                  <div class="custom-markdown-class">{{ content }}</div>
                </template>
              </CopilotChatAssistantMessage>
            </CopilotChatConfigurationProvider>
          </CopilotKitProvider>
        `,
      });

      const { container } = renderWithProvider(Host);
      expect(container.querySelector(".custom-markdown-class")).toBeDefined();
    });

    it("applies custom className to Toolbar slot", () => {
      const Host = defineComponent({
        components: {
          CopilotKitProvider,
          CopilotChatConfigurationProvider,
          CopilotChatAssistantMessage,
        },
        setup() {
          return { basicMessage, TEST_THREAD_ID };
        },
        template: `
          <CopilotKitProvider runtime-url="/api/copilotkit">
            <CopilotChatConfigurationProvider :thread-id="TEST_THREAD_ID">
              <CopilotChatAssistantMessage :message="basicMessage">
                <template #toolbar>
                  <div class="custom-toolbar-class">Toolbar</div>
                </template>
              </CopilotChatAssistantMessage>
            </CopilotChatConfigurationProvider>
          </CopilotKitProvider>
        `,
      });

      const { container } = renderWithProvider(Host);
      expect(container.querySelector(".custom-toolbar-class")).toBeDefined();
    });

    it("applies custom className to CopyButton slot", () => {
      const Host = defineComponent({
        components: {
          CopilotKitProvider,
          CopilotChatConfigurationProvider,
          CopilotChatAssistantMessage,
        },
        setup() {
          return { basicMessage, TEST_THREAD_ID };
        },
        template: `
          <CopilotKitProvider runtime-url="/api/copilotkit">
            <CopilotChatConfigurationProvider :thread-id="TEST_THREAD_ID">
              <CopilotChatAssistantMessage :message="basicMessage">
                <template #copy-button="{ onCopy }">
                  <button class="custom-copy-button-class" @click="onCopy">Copy</button>
                </template>
              </CopilotChatAssistantMessage>
            </CopilotChatConfigurationProvider>
          </CopilotKitProvider>
        `,
      });

      const { container } = renderWithProvider(Host);
      expect(
        container.querySelector(".custom-copy-button-class"),
      ).toBeDefined();
    });
  });

  describe("Children render prop functionality", () => {
    it("supports custom layout via children render prop", () => {
      const Host = defineComponent({
        components: {
          CopilotKitProvider,
          CopilotChatConfigurationProvider,
          CopilotChatAssistantMessage,
        },
        setup() {
          return { basicMessage, TEST_THREAD_ID };
        },
        template: `
          <CopilotKitProvider runtime-url="/api/copilotkit">
            <CopilotChatConfigurationProvider :thread-id="TEST_THREAD_ID">
              <CopilotChatAssistantMessage :message="basicMessage">
                <template #layout="{ message, content }">
                  <div data-testid="custom-layout">
                    <h2>Custom Layout for: {{ message.id }}</h2>
                    <div>{{ content }}</div>
                    <div data-testid="custom-toolbar-wrapper">toolbar-wrapper</div>
                  </div>
                </template>
              </CopilotChatAssistantMessage>
            </CopilotChatConfigurationProvider>
          </CopilotKitProvider>
        `,
      });

      renderWithProvider(Host);

      expect(screen.getByTestId("custom-layout")).toBeDefined();
      expect(
        screen.getByText(`Custom Layout for: ${basicMessage.id}`),
      ).toBeDefined();
      expect(screen.getByTestId("custom-toolbar-wrapper")).toBeDefined();
    });

    it("provides all slot components to children render prop", () => {
      const Host = defineComponent({
        components: {
          CopilotKitProvider,
          CopilotChatConfigurationProvider,
          CopilotChatAssistantMessage,
        },
        setup() {
          return {
            basicMessage,
            TEST_THREAD_ID,
            onThumbsUp: mockOnThumbsUp,
            onThumbsDown: mockOnThumbsDown,
            onReadAloud: mockOnReadAloud,
            onRegenerate: mockOnRegenerate,
          };
        },
        template: `
          <CopilotKitProvider runtime-url="/api/copilotkit">
            <CopilotChatConfigurationProvider :thread-id="TEST_THREAD_ID">
              <CopilotChatAssistantMessage
                :message="basicMessage"
                @thumbs-up="onThumbsUp"
                @thumbs-down="onThumbsDown"
                @read-aloud="onReadAloud"
                @regenerate="onRegenerate"
              >
                <template #layout="{ messageRenderer, toolbar, copyButton, thumbsUpButton, thumbsDownButton, readAloudButton, regenerateButton }">
                  <div data-testid="all-slots-layout">
                    <div data-testid="markdown-present">{{ !!messageRenderer }}</div>
                    <div data-testid="toolbar-present">{{ !!toolbar }}</div>
                    <div data-testid="individual-buttons">
                      <button v-if="copyButton">copy</button>
                      <button v-if="thumbsUpButton">up</button>
                      <button v-if="thumbsDownButton">down</button>
                      <button v-if="readAloudButton">read</button>
                      <button v-if="regenerateButton">regen</button>
                    </div>
                  </div>
                </template>
              </CopilotChatAssistantMessage>
            </CopilotChatConfigurationProvider>
          </CopilotKitProvider>
        `,
      });

      renderWithProvider(Host);
      expect(screen.getByTestId("all-slots-layout")).toBeDefined();
      expect(screen.getByTestId("individual-buttons")).toBeDefined();
      expect(screen.getAllByRole("button").length).toBeGreaterThanOrEqual(5);
    });

    it("provides callback props to children render prop", () => {
      const Host = defineComponent({
        components: {
          CopilotKitProvider,
          CopilotChatConfigurationProvider,
          CopilotChatAssistantMessage,
        },
        setup() {
          return {
            basicMessage,
            TEST_THREAD_ID,
            onThumbsUp: mockOnThumbsUp,
            onThumbsDown: mockOnThumbsDown,
            onReadAloud: mockOnReadAloud,
            onRegenerate: mockOnRegenerate,
          };
        },
        template: `
          <CopilotKitProvider runtime-url="/api/copilotkit">
            <CopilotChatConfigurationProvider :thread-id="TEST_THREAD_ID">
              <CopilotChatAssistantMessage
                :message="basicMessage"
                @thumbs-up="onThumbsUp"
                @thumbs-down="onThumbsDown"
                @read-aloud="onReadAloud"
                @regenerate="onRegenerate"
              >
                <template #layout="{ onThumbsUp, onThumbsDown, onReadAloud, onRegenerate }">
                  <div data-testid="callback-test">
                    <button @click="onThumbsUp" data-testid="custom-thumbs-up">Custom Thumbs Up</button>
                    <button @click="onThumbsDown" data-testid="custom-thumbs-down">Custom Thumbs Down</button>
                    <button @click="onReadAloud" data-testid="custom-read-aloud">Custom Read Aloud</button>
                    <button @click="onRegenerate" data-testid="custom-regenerate">Custom Regenerate</button>
                  </div>
                </template>
              </CopilotChatAssistantMessage>
            </CopilotChatConfigurationProvider>
          </CopilotKitProvider>
        `,
      });

      renderWithProvider(Host);

      fireEvent.click(screen.getByTestId("custom-thumbs-up"));
      fireEvent.click(screen.getByTestId("custom-thumbs-down"));
      fireEvent.click(screen.getByTestId("custom-read-aloud"));
      fireEvent.click(screen.getByTestId("custom-regenerate"));

      expect(mockOnThumbsUp).toHaveBeenCalledTimes(1);
      expect(mockOnThumbsDown).toHaveBeenCalledTimes(1);
      expect(mockOnReadAloud).toHaveBeenCalledTimes(1);
      expect(mockOnRegenerate).toHaveBeenCalledTimes(1);
    });
  });

  describe("Toolbar visibility functionality", () => {
    it("shows toolbar by default (toolbarVisible = true by default)", () => {
      const Host = defineComponent({
        components: {
          CopilotKitProvider,
          CopilotChatConfigurationProvider,
          CopilotChatAssistantMessage,
        },
        setup() {
          return { basicMessage, TEST_THREAD_ID };
        },
        template: `
          <CopilotKitProvider runtime-url="/api/copilotkit">
            <CopilotChatConfigurationProvider :thread-id="TEST_THREAD_ID">
              <CopilotChatAssistantMessage :message="basicMessage" />
            </CopilotChatConfigurationProvider>
          </CopilotKitProvider>
        `,
      });
      renderWithProvider(Host);
      expect(screen.getByRole("button", { name: /copy/i })).toBeDefined();
    });

    it("shows toolbar when toolbarVisible is explicitly true", () => {
      const Host = defineComponent({
        components: {
          CopilotKitProvider,
          CopilotChatConfigurationProvider,
          CopilotChatAssistantMessage,
        },
        setup() {
          return { basicMessage, TEST_THREAD_ID };
        },
        template: `
          <CopilotKitProvider runtime-url="/api/copilotkit">
            <CopilotChatConfigurationProvider :thread-id="TEST_THREAD_ID">
              <CopilotChatAssistantMessage :message="basicMessage" :toolbar-visible="true" />
            </CopilotChatConfigurationProvider>
          </CopilotKitProvider>
        `,
      });
      renderWithProvider(Host);
      expect(screen.getByRole("button", { name: /copy/i })).toBeDefined();
    });

    it("hides toolbar when toolbarVisible is false", () => {
      const Host = defineComponent({
        components: {
          CopilotKitProvider,
          CopilotChatConfigurationProvider,
          CopilotChatAssistantMessage,
        },
        setup() {
          return { basicMessage, TEST_THREAD_ID };
        },
        template: `
          <CopilotKitProvider runtime-url="/api/copilotkit">
            <CopilotChatConfigurationProvider :thread-id="TEST_THREAD_ID">
              <CopilotChatAssistantMessage :message="basicMessage" :toolbar-visible="false" />
            </CopilotChatConfigurationProvider>
          </CopilotKitProvider>
        `,
      });

      renderWithProvider(Host);
      expect(screen.queryByRole("button", { name: /copy/i })).toBeNull();
    });

    it("always passes toolbar and toolbarVisible to children render prop", () => {
      const childrenSpy = vi.fn(() => "");
      const Host = defineComponent({
        components: {
          CopilotKitProvider,
          CopilotChatConfigurationProvider,
          CopilotChatAssistantMessage,
        },
        setup() {
          return { basicMessage, TEST_THREAD_ID, childrenSpy };
        },
        template: `
          <CopilotKitProvider runtime-url="/api/copilotkit">
            <CopilotChatConfigurationProvider :thread-id="TEST_THREAD_ID">
              <CopilotChatAssistantMessage :message="basicMessage" :toolbar-visible="false">
                <template #layout="{ toolbar, toolbarVisible, message }">
                  <span class="cpk:hidden">{{ childrenSpy(toolbar, toolbarVisible, message) }}</span>
                  <div data-testid="children-render" />
                </template>
              </CopilotChatAssistantMessage>
            </CopilotChatConfigurationProvider>
          </CopilotKitProvider>
        `,
      });

      renderWithProvider(Host);
      expect(childrenSpy).toHaveBeenCalled();
      const firstCall = childrenSpy.mock.calls[0];
      expect(firstCall[0]).toBeDefined();
      expect(firstCall[1]).toBe(false);
      expect(firstCall[2]).toEqual(basicMessage);
      expect(screen.getByTestId("children-render")).toBeDefined();
    });

    it("passes toolbarVisible true to children render prop by default", () => {
      const childrenSpy = vi.fn(() => "");
      const Host = defineComponent({
        components: {
          CopilotKitProvider,
          CopilotChatConfigurationProvider,
          CopilotChatAssistantMessage,
        },
        setup() {
          return { basicMessage, TEST_THREAD_ID, childrenSpy };
        },
        template: `
          <CopilotKitProvider runtime-url="/api/copilotkit">
            <CopilotChatConfigurationProvider :thread-id="TEST_THREAD_ID">
              <CopilotChatAssistantMessage :message="basicMessage">
                <template #layout="{ toolbar, toolbarVisible, message }">
                  <span class="cpk:hidden">{{ childrenSpy(toolbar, toolbarVisible, message) }}</span>
                  <div />
                </template>
              </CopilotChatAssistantMessage>
            </CopilotChatConfigurationProvider>
          </CopilotKitProvider>
        `,
      });

      renderWithProvider(Host);
      expect(childrenSpy).toHaveBeenCalled();
      const firstCall = childrenSpy.mock.calls[0];
      expect(firstCall[0]).toBeDefined();
      expect(firstCall[1]).toBe(true);
      expect(firstCall[2]).toEqual(basicMessage);
    });

    it("children can use toolbarVisible to conditionally render toolbar", () => {
      const Host = defineComponent({
        components: {
          CopilotKitProvider,
          CopilotChatConfigurationProvider,
          CopilotChatAssistantMessage,
        },
        setup() {
          return { basicMessage, TEST_THREAD_ID };
        },
        template: `
          <CopilotKitProvider runtime-url="/api/copilotkit">
            <CopilotChatConfigurationProvider :thread-id="TEST_THREAD_ID">
              <CopilotChatAssistantMessage :message="basicMessage" :toolbar-visible="false">
                <template #layout="{ toolbarVisible }">
                  <div data-testid="custom-layout">
                    <div data-testid="content">Custom content</div>
                    <div v-if="toolbarVisible" data-testid="conditional-toolbar">Toolbar</div>
                    <div v-else data-testid="no-toolbar">No toolbar</div>
                  </div>
                </template>
              </CopilotChatAssistantMessage>
            </CopilotChatConfigurationProvider>
          </CopilotKitProvider>
        `,
      });

      renderWithProvider(Host);
      expect(screen.getByTestId("custom-layout")).toBeDefined();
      expect(screen.getByTestId("content")).toBeDefined();
      expect(screen.queryByTestId("conditional-toolbar")).toBeNull();
      expect(screen.getByTestId("no-toolbar")).toBeDefined();
    });
  });

  describe("Error handling", () => {
    it("handles copy errors gracefully", async () => {
      mockWriteText.mockRejectedValueOnce(new Error("Clipboard error"));
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const Host = defineComponent({
        components: {
          CopilotKitProvider,
          CopilotChatConfigurationProvider,
          CopilotChatAssistantMessage,
        },
        setup() {
          return { basicMessage, TEST_THREAD_ID };
        },
        template: `
          <CopilotKitProvider runtime-url="/api/copilotkit">
            <CopilotChatConfigurationProvider :thread-id="TEST_THREAD_ID">
              <CopilotChatAssistantMessage :message="basicMessage" />
            </CopilotChatConfigurationProvider>
          </CopilotKitProvider>
        `,
      });

      renderWithProvider(Host);
      fireEvent.click(screen.getByRole("button", { name: /copy/i }));

      await waitFor(() => {
        expect(consoleSpy).toHaveBeenCalledWith(
          "Failed to copy to clipboard:",
          expect.any(Error),
        );
      });

      consoleSpy.mockRestore();
    });

    it("handles null message content gracefully", () => {
      const nullContentMessage: AssistantMessage = {
        role: "assistant",
        content: null as never,
        id: "null-content",
      };

      const Host = defineComponent({
        components: {
          CopilotKitProvider,
          CopilotChatConfigurationProvider,
          CopilotChatAssistantMessage,
        },
        setup() {
          return { nullContentMessage, TEST_THREAD_ID };
        },
        template: `
          <CopilotKitProvider runtime-url="/api/copilotkit">
            <CopilotChatConfigurationProvider :thread-id="TEST_THREAD_ID">
              <CopilotChatAssistantMessage :message="nullContentMessage" />
            </CopilotChatConfigurationProvider>
          </CopilotKitProvider>
        `,
      });

      renderWithProvider(Host);
      const container = document.querySelector(
        '[data-message-id="null-content"]',
      );
      expect(container).toBeDefined();
      expect(screen.queryByRole("button", { name: /copy/i })).toBeNull();
    });
  });

  describe("Vue-specific semantics", () => {
    it("renders markdown image and table actions", () => {
      const message: AssistantMessage = {
        id: "assistant-vue-extra",
        role: "assistant",
        content: `![Alt text](https://example.com/image.png)\n\n| Feature | Supported |\n| --- | --- |\n| Tables | yes |`,
        timestamp: new Date(),
      };

      const Host = defineComponent({
        components: {
          CopilotKitProvider,
          CopilotChatConfigurationProvider,
          CopilotChatAssistantMessage,
        },
        setup() {
          return { message, TEST_THREAD_ID };
        },
        template: `
          <CopilotKitProvider runtime-url="/api/copilotkit">
            <CopilotChatConfigurationProvider :thread-id="TEST_THREAD_ID">
              <CopilotChatAssistantMessage :message="message" />
            </CopilotChatConfigurationProvider>
          </CopilotKitProvider>
        `,
      });

      renderWithProvider(Host);
      expect(
        document.querySelector('button[title="Download image"]'),
      ).toBeDefined();
      expect(document.querySelector("table")).toBeDefined();
      expect(
        document.querySelector('button[title="Copy table"]'),
      ).toBeDefined();
      expect(
        document.querySelector('button[title="Download table"]'),
      ).toBeDefined();
    });
  });
});
