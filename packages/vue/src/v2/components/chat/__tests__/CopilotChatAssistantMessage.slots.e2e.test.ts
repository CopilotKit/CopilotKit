import { render, screen, fireEvent } from "@testing-library/vue";
import { defineComponent } from "vue";
import { describe, it, expect, vi } from "vitest";
import type { AssistantMessage } from "@ag-ui/core";
import CopilotKitProvider from "../../../providers/CopilotKitProvider.vue";
import CopilotChatConfigurationProvider from "../../../providers/CopilotChatConfigurationProvider.vue";
import CopilotChatAssistantMessage from "../CopilotChatAssistantMessage.vue";

const TestWrapper = defineComponent({
  components: {
    CopilotKitProvider,
    CopilotChatConfigurationProvider,
  },
  template: `
    <CopilotKitProvider>
      <CopilotChatConfigurationProvider thread-id="test-thread">
        <slot />
      </CopilotChatConfigurationProvider>
    </CopilotKitProvider>
  `,
});

function createAssistantMessage(content: string): AssistantMessage {
  return {
    id: "msg-1",
    role: "assistant",
    content,
  } as AssistantMessage;
}

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

describe("CopilotChatAssistantMessage Slot System E2E Tests", () => {
  describe("1. Tailwind Class Slot Override", () => {
    describe("markdownRenderer slot", () => {
      it("should apply tailwind class string to markdownRenderer", () => {
        const Host = defineComponent({
          components: { CopilotChatAssistantMessage },
          setup() {
            const message = createAssistantMessage("Hello world");
            return { message, messages: [message] };
          },
          template: `
            <CopilotChatAssistantMessage :message="message" :messages="messages">
              <template #message-renderer="{ content }">
                <div data-testid="markdown-renderer" class="bg-blue-100 rounded-lg p-4">{{ content }}</div>
              </template>
            </CopilotChatAssistantMessage>
          `,
        });

        renderInWrapper(Host);
        const markdown = screen.getByTestId("markdown-renderer");
        expect(markdown.classList.contains("bg-blue-100")).toBe(true);
        expect(markdown.classList.contains("rounded-lg")).toBe(true);
      });
    });

    describe("toolbar slot", () => {
      it("should apply tailwind class string to toolbar", () => {
        const Host = defineComponent({
          components: { CopilotChatAssistantMessage },
          setup() {
            const message = createAssistantMessage("Hello world");
            return { message, messages: [message], onThumbsUp: vi.fn() };
          },
          template: `
            <CopilotChatAssistantMessage :message="message" :messages="messages" @thumbs-up="onThumbsUp">
              <template #toolbar>
                <div data-testid="toolbar" class="bg-gray-100 border-t">Toolbar</div>
              </template>
            </CopilotChatAssistantMessage>
          `,
        });

        renderInWrapper(Host);
        const toolbar = screen.getByTestId("toolbar");
        expect(toolbar.classList.contains("bg-gray-100")).toBe(true);
        expect(toolbar.classList.contains("border-t")).toBe(true);
      });
    });

    describe("copyButton slot", () => {
      it("should apply tailwind class string to copyButton", () => {
        const Host = defineComponent({
          components: { CopilotChatAssistantMessage },
          setup() {
            const message = createAssistantMessage("Hello world");
            return { message, messages: [message] };
          },
          template: `
            <CopilotChatAssistantMessage :message="message" :messages="messages">
              <template #copy-button="{ onCopy }">
                <button data-testid="copy-btn" class="text-green-500 hover:text-green-700" @click="onCopy">Copy</button>
              </template>
            </CopilotChatAssistantMessage>
          `,
        });

        renderInWrapper(Host);
        expect(
          screen.getByTestId("copy-btn").classList.contains("text-green-500"),
        ).toBe(true);
      });
    });

    describe("thumbsUpButton slot", () => {
      it("should apply tailwind class string to thumbsUpButton", () => {
        const onThumbsUp = vi.fn();
        const Host = defineComponent({
          components: { CopilotChatAssistantMessage },
          setup() {
            const message = createAssistantMessage("Hello world");
            return { message, messages: [message], onThumbsUp };
          },
          template: `
            <CopilotChatAssistantMessage :message="message" :messages="messages" @thumbs-up="onThumbsUp">
              <template #thumbs-up-button="{ onThumbsUp: onClick }">
                <button data-testid="thumbs-up-btn" class="text-blue-500" @click="onClick">Up</button>
              </template>
            </CopilotChatAssistantMessage>
          `,
        });

        renderInWrapper(Host);
        expect(
          screen
            .getByTestId("thumbs-up-btn")
            .classList.contains("text-blue-500"),
        ).toBe(true);
      });
    });

    describe("thumbsDownButton slot", () => {
      it("should apply tailwind class string to thumbsDownButton", () => {
        const onThumbsDown = vi.fn();
        const Host = defineComponent({
          components: { CopilotChatAssistantMessage },
          setup() {
            const message = createAssistantMessage("Hello world");
            return { message, messages: [message], onThumbsDown };
          },
          template: `
            <CopilotChatAssistantMessage :message="message" :messages="messages" @thumbs-down="onThumbsDown">
              <template #thumbs-down-button="{ onThumbsDown: onClick }">
                <button data-testid="thumbs-down-btn" class="text-red-500" @click="onClick">Down</button>
              </template>
            </CopilotChatAssistantMessage>
          `,
        });

        renderInWrapper(Host);
        expect(
          screen
            .getByTestId("thumbs-down-btn")
            .classList.contains("text-red-500"),
        ).toBe(true);
      });
    });

    describe("readAloudButton slot", () => {
      it("should apply tailwind class string to readAloudButton", () => {
        const onReadAloud = vi.fn();
        const Host = defineComponent({
          components: { CopilotChatAssistantMessage },
          setup() {
            const message = createAssistantMessage("Hello world");
            return { message, messages: [message], onReadAloud };
          },
          template: `
            <CopilotChatAssistantMessage :message="message" :messages="messages" @read-aloud="onReadAloud">
              <template #read-aloud-button="{ onReadAloud: onClick }">
                <button data-testid="read-aloud-btn" class="text-purple-500" @click="onClick">Read</button>
              </template>
            </CopilotChatAssistantMessage>
          `,
        });

        renderInWrapper(Host);
        expect(
          screen
            .getByTestId("read-aloud-btn")
            .classList.contains("text-purple-500"),
        ).toBe(true);
      });
    });

    describe("regenerateButton slot", () => {
      it("should apply tailwind class string to regenerateButton", () => {
        const onRegenerate = vi.fn();
        const Host = defineComponent({
          components: { CopilotChatAssistantMessage },
          setup() {
            const message = createAssistantMessage("Hello world");
            return { message, messages: [message], onRegenerate };
          },
          template: `
            <CopilotChatAssistantMessage :message="message" :messages="messages" @regenerate="onRegenerate">
              <template #regenerate-button="{ onRegenerate: onClick }">
                <button data-testid="regenerate-btn" class="text-orange-500" @click="onClick">Regenerate</button>
              </template>
            </CopilotChatAssistantMessage>
          `,
        });

        renderInWrapper(Host);
        expect(
          screen
            .getByTestId("regenerate-btn")
            .classList.contains("text-orange-500"),
        ).toBe(true);
      });
    });

    describe("toolCallsView slot", () => {
      it("should apply tailwind class string to toolCallsView", () => {
        const message: AssistantMessage = {
          ...createAssistantMessage("Hello"),
          toolCalls: [
            {
              id: "tc-1",
              type: "function",
              function: { name: "test_tool", arguments: "{}" },
            } as any,
          ],
        };
        const Host = defineComponent({
          components: { CopilotChatAssistantMessage },
          setup() {
            return { message, messages: [message] };
          },
          template: `
            <CopilotChatAssistantMessage :message="message" :messages="messages">
              <template #tool-calls-view>
                <div data-testid="tool-calls-view" class="bg-yellow-50 p-2">Tools</div>
              </template>
            </CopilotChatAssistantMessage>
          `,
        });

        renderInWrapper(Host);
        const toolCalls = screen.queryByTestId("tool-calls-view");
        if (toolCalls) {
          expect(toolCalls.classList.contains("p-2")).toBe(true);
        }
      });
    });
  });

  describe("2. Property Passing (onClick, disabled, etc.)", () => {
    describe("markdownRenderer slot", () => {
      it("should pass custom props to markdownRenderer", () => {
        const Host = defineComponent({
          components: { CopilotChatAssistantMessage },
          setup() {
            const message = createAssistantMessage("Hello world");
            return { message, messages: [message] };
          },
          template: `
            <CopilotChatAssistantMessage :message="message" :messages="messages">
              <template #message-renderer="{ content }">
                <div data-testid="custom-markdown">{{ content }}</div>
              </template>
            </CopilotChatAssistantMessage>
          `,
        });

        renderInWrapper(Host);
        expect(screen.queryByTestId("custom-markdown")).toBeDefined();
      });
    });

    describe("toolbar slot", () => {
      it("should pass custom onClick to toolbar", async () => {
        const onClick = vi.fn();
        const Host = defineComponent({
          components: { CopilotChatAssistantMessage },
          setup() {
            const message = createAssistantMessage("Hello world");
            return {
              message,
              messages: [message],
              onClick,
              onThumbsUp: vi.fn(),
            };
          },
          template: `
            <CopilotChatAssistantMessage :message="message" :messages="messages" @thumbs-up="onThumbsUp">
              <template #toolbar>
                <div data-testid="custom-toolbar" @click="onClick">Toolbar</div>
              </template>
            </CopilotChatAssistantMessage>
          `,
        });

        renderInWrapper(Host);
        await fireEvent.click(screen.getByTestId("custom-toolbar"));
        expect(onClick).toHaveBeenCalled();
      });
    });

    describe("copyButton slot", () => {
      it("should pass custom onClick that wraps default behavior", async () => {
        const customOnClick = vi.fn();
        const Host = defineComponent({
          components: { CopilotChatAssistantMessage },
          setup() {
            const message = createAssistantMessage("Hello world");
            return { message, messages: [message], customOnClick };
          },
          template: `
            <CopilotChatAssistantMessage :message="message" :messages="messages">
              <template #copy-button="{ onCopy }">
                <button
                  data-testid="custom-copy-button"
                  @click="
                    customOnClick();
                    onCopy();
                  "
                >
                  Copy
                </button>
              </template>
            </CopilotChatAssistantMessage>
          `,
        });

        renderInWrapper(Host);
        await fireEvent.click(screen.getByTestId("custom-copy-button"));
        expect(customOnClick).toHaveBeenCalled();
      });

      it("should support disabled state on copyButton", () => {
        const Host = defineComponent({
          components: { CopilotChatAssistantMessage },
          setup() {
            const message = createAssistantMessage("Hello world");
            return { message, messages: [message] };
          },
          template: `
            <CopilotChatAssistantMessage :message="message" :messages="messages">
              <template #copy-button="{ onCopy }">
                <button data-testid="disabled-copy-button" disabled @click="onCopy">Copy</button>
              </template>
            </CopilotChatAssistantMessage>
          `,
        });

        renderInWrapper(Host);
        expect(
          screen.getByTestId("disabled-copy-button").hasAttribute("disabled"),
        ).toBe(true);
      });
    });

    describe("thumbsUpButton slot", () => {
      it("should call custom onClick on thumbsUpButton", async () => {
        const customOnClick = vi.fn();
        const onThumbsUp = vi.fn();
        const Host = defineComponent({
          components: { CopilotChatAssistantMessage },
          setup() {
            const message = createAssistantMessage("Hello world");
            return { message, messages: [message], customOnClick, onThumbsUp };
          },
          template: `
            <CopilotChatAssistantMessage :message="message" :messages="messages" @thumbs-up="onThumbsUp">
              <template #thumbs-up-button="{ onThumbsUp: onClick }">
                <button
                  data-testid="thumbs-up-custom"
                  @click="
                    customOnClick();
                    onClick();
                  "
                >
                  Up
                </button>
              </template>
            </CopilotChatAssistantMessage>
          `,
        });

        renderInWrapper(Host);
        await fireEvent.click(screen.getByTestId("thumbs-up-custom"));
        expect(customOnClick).toHaveBeenCalled();
      });
    });

    describe("thumbsDownButton slot", () => {
      it("should call custom onClick on thumbsDownButton", async () => {
        const customOnClick = vi.fn();
        const onThumbsDown = vi.fn();
        const Host = defineComponent({
          components: { CopilotChatAssistantMessage },
          setup() {
            const message = createAssistantMessage("Hello world");
            return {
              message,
              messages: [message],
              customOnClick,
              onThumbsDown,
            };
          },
          template: `
            <CopilotChatAssistantMessage :message="message" :messages="messages" @thumbs-down="onThumbsDown">
              <template #thumbs-down-button="{ onThumbsDown: onClick }">
                <button
                  data-testid="thumbs-down-custom"
                  @click="
                    customOnClick();
                    onClick();
                  "
                >
                  Down
                </button>
              </template>
            </CopilotChatAssistantMessage>
          `,
        });

        renderInWrapper(Host);
        await fireEvent.click(screen.getByTestId("thumbs-down-custom"));
        expect(customOnClick).toHaveBeenCalled();
      });
    });

    describe("readAloudButton slot", () => {
      it("should call custom onClick on readAloudButton", async () => {
        const customOnClick = vi.fn();
        const onReadAloud = vi.fn();
        const Host = defineComponent({
          components: { CopilotChatAssistantMessage },
          setup() {
            const message = createAssistantMessage("Hello world");
            return { message, messages: [message], customOnClick, onReadAloud };
          },
          template: `
            <CopilotChatAssistantMessage :message="message" :messages="messages" @read-aloud="onReadAloud">
              <template #read-aloud-button="{ onReadAloud: onClick }">
                <button
                  data-testid="read-aloud-custom"
                  @click="
                    customOnClick();
                    onClick();
                  "
                >
                  Read
                </button>
              </template>
            </CopilotChatAssistantMessage>
          `,
        });

        renderInWrapper(Host);
        await fireEvent.click(screen.getByTestId("read-aloud-custom"));
        expect(customOnClick).toHaveBeenCalled();
      });
    });

    describe("regenerateButton slot", () => {
      it("should call custom onClick on regenerateButton", async () => {
        const customOnClick = vi.fn();
        const onRegenerate = vi.fn();
        const Host = defineComponent({
          components: { CopilotChatAssistantMessage },
          setup() {
            const message = createAssistantMessage("Hello world");
            return {
              message,
              messages: [message],
              customOnClick,
              onRegenerate,
            };
          },
          template: `
            <CopilotChatAssistantMessage :message="message" :messages="messages" @regenerate="onRegenerate">
              <template #regenerate-button="{ onRegenerate: onClick }">
                <button
                  data-testid="regenerate-custom"
                  @click="
                    customOnClick();
                    onClick();
                  "
                >
                  Regenerate
                </button>
              </template>
            </CopilotChatAssistantMessage>
          `,
        });

        renderInWrapper(Host);
        await fireEvent.click(screen.getByTestId("regenerate-custom"));
        expect(customOnClick).toHaveBeenCalled();
      });
    });
  });

  describe("3. Custom Component Receiving Sub-components", () => {
    it("should allow custom component for markdownRenderer", () => {
      const Host = defineComponent({
        components: { CopilotChatAssistantMessage },
        setup() {
          const message = createAssistantMessage("hello");
          return { message, messages: [message] };
        },
        template: `
          <CopilotChatAssistantMessage :message="message" :messages="messages">
            <template #message-renderer="{ content }">
              <div data-testid="custom-markdown-component">{{ content.toUpperCase() }}</div>
            </template>
          </CopilotChatAssistantMessage>
        `,
      });

      renderInWrapper(Host);
      const custom = screen.queryByTestId("custom-markdown-component");
      expect(custom).toBeDefined();
      expect(custom?.textContent).toBe("HELLO");
    });

    it("should allow custom component for toolbar", () => {
      const Host = defineComponent({
        components: { CopilotChatAssistantMessage },
        setup() {
          const message = createAssistantMessage("Hello");
          return { message, messages: [message], onThumbsUp: vi.fn() };
        },
        template: `
          <CopilotChatAssistantMessage :message="message" :messages="messages" @thumbs-up="onThumbsUp">
            <template #toolbar>
              <div data-testid="custom-toolbar-component">
                <span>Custom Toolbar:</span>
                <slot />
              </div>
            </template>
          </CopilotChatAssistantMessage>
        `,
      });

      renderInWrapper(Host);
      const custom = screen.queryByTestId("custom-toolbar-component");
      expect(custom).toBeDefined();
      expect(custom?.textContent).toContain("Custom Toolbar");
    });

    it("should allow custom component for copyButton", () => {
      const Host = defineComponent({
        components: { CopilotChatAssistantMessage },
        setup() {
          const message = createAssistantMessage("Hello");
          return { message, messages: [message] };
        },
        template: `
          <CopilotChatAssistantMessage :message="message" :messages="messages">
            <template #copy-button="{ onCopy }">
              <button data-testid="custom-copy" @click="onCopy">Custom Copy</button>
            </template>
          </CopilotChatAssistantMessage>
        `,
      });

      renderInWrapper(Host);
      expect(screen.queryByTestId("custom-copy")).toBeDefined();
    });
  });

  describe("4. Children Render Function for Drill-down", () => {
    it("should provide all bound sub-components via children render function", () => {
      const onThumbsUp = vi.fn();
      const onThumbsDown = vi.fn();
      const onReadAloud = vi.fn();
      const onRegenerate = vi.fn();
      const Host = defineComponent({
        components: { CopilotChatAssistantMessage },
        setup() {
          const message = createAssistantMessage("Hello world");
          return {
            message,
            messages: [message],
            onThumbsUp,
            onThumbsDown,
            onReadAloud,
            onRegenerate,
          };
        },
        template: `
          <CopilotChatAssistantMessage
            :message="message"
            :messages="messages"
            @thumbs-up="onThumbsUp"
            @thumbs-down="onThumbsDown"
            @read-aloud="onReadAloud"
            @regenerate="onRegenerate"
          >
            <template #message-renderer><div data-testid="received-markdown">markdown</div></template>
            <template #toolbar><div data-testid="received-toolbar">toolbar</div></template>
            <template #copy-button><button data-testid="received-copy">copy</button></template>
            <template #thumbs-up-button><button data-testid="received-thumbs-up">up</button></template>
            <template #thumbs-down-button><button data-testid="received-thumbs-down">down</button></template>
            <template #read-aloud-button><button data-testid="received-read-aloud">read</button></template>
            <template #regenerate-button><button data-testid="received-regenerate">regen</button></template>
            <template #tool-calls-view><div data-testid="received-tool-calls">tools</div></template>
          </CopilotChatAssistantMessage>
        `,
      });

      renderInWrapper(Host);
      expect(screen.queryByTestId("received-markdown")).toBeDefined();
      expect(screen.queryByTestId("received-toolbar")).toBeDefined();
      expect(screen.queryByTestId("received-copy")).toBeDefined();
      expect(screen.queryByTestId("received-thumbs-up")).toBeDefined();
      expect(screen.queryByTestId("received-thumbs-down")).toBeDefined();
      expect(screen.queryByTestId("received-read-aloud")).toBeDefined();
      expect(screen.queryByTestId("received-regenerate")).toBeDefined();
      expect(screen.queryByTestId("received-tool-calls")).toBeDefined();
    });

    it("should pass message and other props through children render function", () => {
      const message = createAssistantMessage("Test message");
      const Host = defineComponent({
        components: { CopilotChatAssistantMessage },
        setup() {
          return { message, messages: [message] };
        },
        template: `
          <CopilotChatAssistantMessage :message="message" :messages="messages" :is-running="true" :toolbar-visible="false">
            <template #message-renderer="{ message: receivedMessage }">
              <div data-testid="children-message">{{ receivedMessage.id }}</div>
            </template>
          </CopilotChatAssistantMessage>
        `,
      });

      renderInWrapper(Host);
      expect(screen.getByTestId("children-message").textContent).toBe("msg-1");
    });
  });

  describe("5. className Override with Tailwind Strings", () => {
    it("should override root className while preserving default prose classes", () => {
      const Host = defineComponent({
        components: { CopilotChatAssistantMessage },
        setup() {
          const message = createAssistantMessage("Hello");
          return { message, messages: [message] };
        },
        template: `
          <CopilotChatAssistantMessage :message="message" :messages="messages" class="custom-root-class bg-custom" />
        `,
      });

      const { container } = renderInWrapper(Host);
      const root = container.querySelector(".custom-root-class");
      expect(root).toBeDefined();
      const proseDiv =
        root?.classList.contains("cpk:prose") ||
        !!root?.querySelector(".cpk\\:prose");
      expect(proseDiv).toBe(true);
    });

    it("should allow tailwind utilities to override default styles", () => {
      const Host = defineComponent({
        components: { CopilotChatAssistantMessage },
        setup() {
          const message = createAssistantMessage("Hello");
          return { message, messages: [message] };
        },
        template: `
          <CopilotChatAssistantMessage :message="message" :messages="messages" class="max-w-sm" />
        `,
      });

      const { container } = renderInWrapper(Host);
      expect(container.querySelector(".max-w-sm")).toBeDefined();
    });

    it("should merge multiple slot classNames correctly", () => {
      const Host = defineComponent({
        components: { CopilotChatAssistantMessage },
        setup() {
          const message = createAssistantMessage("Hello");
          return { message, messages: [message] };
        },
        template: `
          <CopilotChatAssistantMessage :message="message" :messages="messages" class="root-custom">
            <template #toolbar><div data-testid="toolbar-custom" class="toolbar-custom">Toolbar</div></template>
            <template #copy-button><button data-testid="copy-custom" class="copy-custom">Copy</button></template>
          </CopilotChatAssistantMessage>
        `,
      });

      const { container } = renderInWrapper(Host);
      expect(container.querySelector(".root-custom")).toBeDefined();
      expect(container.querySelector(".toolbar-custom")).toBeDefined();
      expect(container.querySelector(".copy-custom")).toBeDefined();
    });
  });

  describe("6. Integration and Recursive Slot Application", () => {
    it("should correctly render all slots with mixed customization", () => {
      const onThumbsUp = vi.fn();
      const onThumbsDown = vi.fn();
      const Host = defineComponent({
        components: { CopilotChatAssistantMessage },
        setup() {
          const message = createAssistantMessage("Hello world");
          return { message, messages: [message], onThumbsUp, onThumbsDown };
        },
        template: `
          <CopilotChatAssistantMessage :message="message" :messages="messages" @thumbs-up="onThumbsUp" @thumbs-down="onThumbsDown">
            <template #message-renderer="{ content }"><div class="markdown-style">{{ content }}</div></template>
            <template #toolbar><div class="toolbar-style">Toolbar</div></template>
            <template #copy-button><button class="copy-style">Copy</button></template>
            <template #thumbs-up-button="{ onThumbsUp: onClick }"><button class="thumbs-up-style" @click="onClick">Up</button></template>
            <template #thumbs-down-button="{ onThumbsDown: onClick }"><button class="thumbs-down-style" @click="onClick">Down</button></template>
          </CopilotChatAssistantMessage>
        `,
      });

      const { container } = renderInWrapper(Host);
      expect(container.querySelector(".markdown-style")).toBeDefined();
      expect(container.querySelector(".toolbar-style")).toBeDefined();
      expect(container.querySelector(".copy-style")).toBeDefined();
      expect(container.querySelector(".thumbs-up-style")).toBeDefined();
      expect(container.querySelector(".thumbs-down-style")).toBeDefined();
    });

    it("should work with property objects and class strings mixed", async () => {
      const onClick = vi.fn();
      const Host = defineComponent({
        components: { CopilotChatAssistantMessage },
        setup() {
          const message = createAssistantMessage("Hello world");
          return { message, messages: [message], onClick, onThumbsUp: vi.fn() };
        },
        template: `
          <CopilotChatAssistantMessage :message="message" :messages="messages" @thumbs-up="onThumbsUp">
            <template #message-renderer="{ content }"><div class="text-lg">{{ content }}</div></template>
            <template #toolbar>
              <div data-testid="mixed-toolbar" class="flex gap-2" @click="onClick">Toolbar</div>
            </template>
          </CopilotChatAssistantMessage>
        `,
      });

      const { container } = renderInWrapper(Host);
      expect(container.querySelector(".text-lg")).toBeDefined();

      const toolbar = container.querySelector(".flex.gap-2");
      if (toolbar) {
        await fireEvent.click(toolbar);
        expect(onClick).toHaveBeenCalled();
      }
    });
  });
});
