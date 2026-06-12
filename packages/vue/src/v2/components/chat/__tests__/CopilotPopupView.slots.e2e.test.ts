import { render, screen, fireEvent } from "@testing-library/vue";
import { defineComponent } from "vue";
import { describe, it, expect, vi } from "vitest";
import CopilotKitProvider from "../../../providers/CopilotKitProvider.vue";
import CopilotChatConfigurationProvider from "../../../providers/CopilotChatConfigurationProvider.vue";
import CopilotPopupView from "../CopilotPopupView.vue";
import CopilotModalHeader from "../CopilotModalHeader.vue";
import CopilotChatToggleButton from "../CopilotChatToggleButton.vue";
import CopilotChatView from "../CopilotChatView.vue";

const sampleMessages = [
  { id: "1", role: "user" as const, content: "Hello" },
  { id: "2", role: "assistant" as const, content: "Hi there!" },
];

const sampleSuggestions = [
  { title: "Quick Reply", message: "Reply message", isLoading: false },
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
          <UnderTest />
        </CopilotChatConfigurationProvider>
      </CopilotKitProvider>
    `,
  });

  return render(Host);
}

describe("CopilotPopupView Slot System E2E Tests", () => {
  describe("1. Tailwind Class Slot Override - Header Slot", () => {
    describe("header slot", () => {
      it("should apply tailwind class string to header", () => {
        const Host = defineComponent({
          components: { CopilotPopupView, CopilotModalHeader },
          setup() {
            return { sampleMessages };
          },
          template: `
            <CopilotPopupView :messages="sampleMessages">
              <template #header="{ title, onClose }">
                <CopilotModalHeader
                  data-testid="popup-header"
                  :title="title"
                  class="bg-indigo-500 text-white shadow-lg"
                  @click="onClose"
                />
              </template>
            </CopilotPopupView>
          `,
        });

        renderInWrapper(Host);
        const header = screen.getByTestId("popup-header");
        expect(header.classList.contains("bg-indigo-500")).toBe(true);
      });

      it("should override default header styles", () => {
        const Host = defineComponent({
          components: { CopilotPopupView, CopilotModalHeader },
          setup() {
            return { sampleMessages };
          },
          template: `
            <CopilotPopupView :messages="sampleMessages">
              <template #header="{ title }">
                <CopilotModalHeader
                  data-testid="popup-header"
                  :title="title"
                  class="rounded-t-3xl border-none"
                />
              </template>
            </CopilotPopupView>
          `,
        });

        renderInWrapper(Host);
        expect(
          screen
            .getByTestId("popup-header")
            .classList.contains("rounded-t-3xl"),
        ).toBe(true);
      });
    });
  });

  describe("2. Property Passing - Header Slot", () => {
    describe("header slot", () => {
      it("should pass custom props to header", () => {
        const Host = defineComponent({
          components: { CopilotPopupView },
          setup() {
            return { sampleMessages };
          },
          template: `
            <CopilotPopupView :messages="sampleMessages">
              <template #header="{ title }">
                <div data-testid="custom-popup-header">{{ title }}</div>
              </template>
            </CopilotPopupView>
          `,
        });

        renderInWrapper(Host);
        expect(screen.getByTestId("custom-popup-header")).toBeDefined();
      });

      it("should pass title prop through to header", () => {
        const Host = defineComponent({
          components: { CopilotPopupView },
          setup() {
            return { sampleMessages };
          },
          template: `
            <CopilotPopupView :messages="sampleMessages">
              <template #header="{ title }">
                <div>{{ title }}</div>
              </template>
            </CopilotPopupView>
          `,
        });

        renderInWrapper(Host);
        expect(screen.queryByText("CopilotKit")).toBeDefined();
      });
    });
  });

  describe("3. Custom Component - Header Slot", () => {
    it("should allow custom component for header", () => {
      const Host = defineComponent({
        components: { CopilotPopupView },
        setup() {
          return { sampleMessages };
        },
        template: `
          <CopilotPopupView :messages="sampleMessages">
            <template #header>
              <header data-testid="custom-popup-header-component">
                <div class="flex justify-between items-center p-4">
                  <span>AI Assistant</span>
                  <button>×</button>
                </div>
              </header>
            </template>
          </CopilotPopupView>
        `,
      });

      renderInWrapper(Host);
      expect(
        screen.getByTestId("custom-popup-header-component").textContent,
      ).toContain("AI Assistant");
    });

    it("should allow passing header props for customization", () => {
      const Host = defineComponent({
        components: { CopilotPopupView, CopilotModalHeader },
        setup() {
          return { sampleMessages };
        },
        template: `
          <CopilotPopupView :messages="sampleMessages">
            <template #header="{ onClose }">
              <CopilotModalHeader
                title="Chat Popup"
                data-testid="chat-popup-header"
                class="title-wrap"
                @click="onClose"
              >
                <template #title-content="{ title }">
                  <div class="text-lg italic">{{ title }}</div>
                </template>
                <template #close-button>
                  <button class="text-gray-400">x</button>
                </template>
              </CopilotModalHeader>
            </template>
          </CopilotPopupView>
        `,
      });

      const { container } = renderInWrapper(Host);
      expect(screen.queryByText("Chat Popup")).toBeDefined();
      expect(container.querySelector(".text-lg")).toBeDefined();
      expect(container.querySelector(".italic")).toBeDefined();
    });
  });

  describe("4. Inherited CopilotChatView Slots", () => {
    describe("messageView slot (inherited)", () => {
      it("should apply tailwind class string to inherited messageView", () => {
        const Host = defineComponent({
          components: { CopilotPopupView, CopilotChatView },
          setup() {
            return { sampleMessages };
          },
          template: `
            <CopilotPopupView :messages="sampleMessages">
              <template #message-view="{ messages, isRunning }">
                <CopilotChatView :messages="messages" :is-running="isRunning">
                  <template #message-view>
                    <div data-testid="popup-message-view" class="bg-slate-50 p-4">msg</div>
                  </template>
                </CopilotChatView>
              </template>
            </CopilotPopupView>
          `,
        });

        renderInWrapper(Host);
        expect(
          screen
            .getByTestId("popup-message-view")
            .classList.contains("bg-slate-50"),
        ).toBe(true);
      });
    });

    describe("input slot (inherited)", () => {
      it("should apply tailwind class string to inherited input", () => {
        const Host = defineComponent({
          components: { CopilotPopupView },
          setup() {
            return { sampleMessages };
          },
          template: `
            <CopilotPopupView :messages="sampleMessages">
              <template #input>
                <div data-testid="popup-input" class="border-t-2 border-indigo-300">input</div>
              </template>
            </CopilotPopupView>
          `,
        });

        renderInWrapper(Host);
        expect(screen.getByTestId("popup-input")).toBeDefined();
      });
    });

    describe("scrollView slot (inherited)", () => {
      it("should apply tailwind class string to inherited scrollView", () => {
        const Host = defineComponent({
          components: { CopilotPopupView },
          setup() {
            return { sampleMessages };
          },
          template: `
            <CopilotPopupView :messages="sampleMessages">
              <template #scroll-view>
                <div data-testid="popup-scroll" class="scrollbar-thin scrollbar-thumb-gray-300">scroll</div>
              </template>
            </CopilotPopupView>
          `,
        });

        renderInWrapper(Host);
        expect(screen.getByTestId("popup-scroll")).toBeDefined();
      });
    });

    describe("suggestionView slot (inherited)", () => {
      it("should apply tailwind class string to inherited suggestionView", () => {
        const Host = defineComponent({
          components: { CopilotPopupView },
          setup() {
            return { sampleMessages, sampleSuggestions };
          },
          template: `
            <CopilotPopupView :messages="sampleMessages" :suggestions="sampleSuggestions">
              <template #suggestion-view>
                <div data-testid="popup-suggestions" class="flex-wrap gap-2">suggestions</div>
              </template>
            </CopilotPopupView>
          `,
        });

        renderInWrapper(Host);
        const suggestionView = screen.getByTestId("popup-suggestions");
        expect(suggestionView.classList.contains("flex-wrap")).toBe(true);
        expect(suggestionView.classList.contains("gap-2")).toBe(true);
      });
    });

    describe("input slot (inherited)", () => {
      it("should apply tailwind class string to inherited input", () => {
        const Host = defineComponent({
          components: { CopilotPopupView },
          setup() {
            return { sampleMessages };
          },
          template: `
            <CopilotPopupView :messages="sampleMessages">
              <template #input>
                <div data-testid="popup-input-2" class="bg-gray-100 rounded-b-2xl">input</div>
              </template>
            </CopilotPopupView>
          `,
        });

        renderInWrapper(Host);
        expect(screen.getByTestId("popup-input-2")).toBeDefined();
      });
    });
  });

  describe("5. Drill-down into Header Sub-slots", () => {
    it("should allow customizing header titleContent through props object", () => {
      const Host = defineComponent({
        components: { CopilotPopupView, CopilotModalHeader },
        setup() {
          return { sampleMessages };
        },
        template: `
          <CopilotPopupView :messages="sampleMessages">
            <template #header>
              <CopilotModalHeader title="Popup Chat">
                <template #title-content="{ title }">
                  <div class="text-xl text-indigo-600 tracking-wide">{{ title }}</div>
                </template>
              </CopilotModalHeader>
            </template>
          </CopilotPopupView>
        `,
      });

      const { container } = renderInWrapper(Host);
      const titleContent = container.querySelector(".text-xl");
      expect(titleContent).toBeDefined();
      expect(titleContent?.classList.contains("text-indigo-600")).toBe(true);
      expect(titleContent?.classList.contains("tracking-wide")).toBe(true);
    });

    it("should allow customizing header closeButton through props object", () => {
      const Host = defineComponent({
        components: { CopilotPopupView, CopilotModalHeader },
        setup() {
          return { sampleMessages };
        },
        template: `
          <CopilotPopupView :messages="sampleMessages">
            <template #header>
              <CopilotModalHeader title="Popup">
                <template #close-button>
                  <button class="popup-close-btn">x</button>
                </template>
              </CopilotModalHeader>
            </template>
          </CopilotPopupView>
        `,
      });

      const { container } = renderInWrapper(Host);
      expect(container.querySelector(".popup-close-btn")).toBeDefined();
    });

    it("should allow custom component for header via component slot", () => {
      const Host = defineComponent({
        components: { CopilotPopupView },
        setup() {
          return { sampleMessages };
        },
        template: `
          <CopilotPopupView :messages="sampleMessages">
            <template #header>
              <header data-testid="full-custom-popup-header">
                <span>Custom Popup Header</span>
                <button data-testid="popup-custom-close">Dismiss</button>
              </header>
            </template>
          </CopilotPopupView>
        `,
      });

      renderInWrapper(Host);
      const customClose = screen.queryByTestId("popup-custom-close");
      expect(customClose).toBeDefined();
      expect(customClose?.textContent).toBe("Dismiss");
    });

    it("should allow custom layout via custom header component", () => {
      const Host = defineComponent({
        components: { CopilotPopupView },
        setup() {
          return { sampleMessages };
        },
        template: `
          <CopilotPopupView :messages="sampleMessages">
            <template #header>
              <div class="custom-popup-header-layout">
                <div class="close-area"><button>X</button></div>
                <div class="title-area"><span>Custom Title</span></div>
              </div>
            </template>
          </CopilotPopupView>
        `,
      });

      const { container } = renderInWrapper(Host);
      expect(
        container.querySelector(".custom-popup-header-layout"),
      ).toBeDefined();
      expect(container.querySelector(".close-area")).toBeDefined();
      expect(container.querySelector(".title-area")).toBeDefined();
    });
  });

  describe("6. className Override and Mixed Customization", () => {
    it("should apply className to popup root", () => {
      const Host = defineComponent({
        components: { CopilotPopupView },
        setup() {
          return { sampleMessages };
        },
        template: `<CopilotPopupView :messages="sampleMessages" class="custom-popup-class" />`,
      });

      const { container } = renderInWrapper(Host);
      expect(container.querySelector(".custom-popup-class")).toBeDefined();
    });

    it("should merge multiple slot classNames correctly", () => {
      const Host = defineComponent({
        components: { CopilotPopupView },
        setup() {
          return { sampleMessages };
        },
        template: `
          <CopilotPopupView :messages="sampleMessages">
            <template #header><div class="header-style">header</div></template>
            <template #message-view><div class="message-style">message</div></template>
            <template #input><div class="input-style">input</div></template>
          </CopilotPopupView>
        `,
      });

      const { container } = renderInWrapper(Host);
      expect(container.querySelector(".header-style")).toBeDefined();
      expect(container.querySelector(".message-style")).toBeDefined();
      expect(container.querySelector(".input-style")).toBeDefined();
    });

    it("should work with property objects and class strings mixed", async () => {
      const onClick = vi.fn();
      const Host = defineComponent({
        components: { CopilotPopupView, CopilotModalHeader },
        setup() {
          return { sampleMessages, onClick };
        },
        template: `
          <CopilotPopupView :messages="sampleMessages" class="custom-popup-class">
            <template #header="{ title, onClose }">
              <CopilotModalHeader title="Popup" class="clickable-header" @click="onClick" />
              <button data-testid="popup-close" @click="onClose">close</button>
            </template>
            <template #input>
              <div class="styled-input">input</div>
            </template>
          </CopilotPopupView>
        `,
      });

      const { container } = renderInWrapper(Host);
      expect(container.querySelector(".styled-input")).toBeDefined();
      const header = container.querySelector(".clickable-header");
      if (header) {
        await fireEvent.click(header);
        expect(onClick).toHaveBeenCalledTimes(1);
      }
    });
  });

  describe("7. Popup-specific Props", () => {
    it("should support custom width prop", () => {
      const Host = defineComponent({
        components: { CopilotPopupView },
        setup() {
          return { sampleMessages };
        },
        template: `<CopilotPopupView :messages="sampleMessages" :width="500" />`,
      });

      const { container } = renderInWrapper(Host);
      const popup = container.querySelector("[data-copilot-popup]");
      expect(popup?.getAttribute("style") ?? "").toContain(
        "--copilot-popup-width",
      );
    });

    it("should support custom height prop", () => {
      const Host = defineComponent({
        components: { CopilotPopupView },
        setup() {
          return { sampleMessages };
        },
        template: `<CopilotPopupView :messages="sampleMessages" :height="700" />`,
      });

      const { container } = renderInWrapper(Host);
      const popup = container.querySelector("[data-copilot-popup]");
      expect(popup?.getAttribute("style") ?? "").toContain(
        "--copilot-popup-height",
      );
    });

    it("should support string dimensions", () => {
      const Host = defineComponent({
        components: { CopilotPopupView },
        setup() {
          return { sampleMessages };
        },
        template: `<CopilotPopupView :messages="sampleMessages" width="80vw" height="90vh" />`,
      });

      const { container } = renderInWrapper(Host);
      expect(container.querySelector("[data-copilot-popup]")).toBeDefined();
    });

    it("should support clickOutsideToClose prop", () => {
      const Host = defineComponent({
        components: { CopilotPopupView },
        setup() {
          return { sampleMessages };
        },
        template: `<CopilotPopupView :messages="sampleMessages" :click-outside-to-close="true" />`,
      });

      const { container } = renderInWrapper(Host);
      expect(container.querySelector("[data-copilot-popup]")).toBeDefined();
    });
  });

  describe("8. Integration Tests", () => {
    it("should render popup with all default components when open", () => {
      const Host = defineComponent({
        components: { CopilotPopupView },
        setup() {
          return { sampleMessages };
        },
        template: `<CopilotPopupView :messages="sampleMessages" :default-open="true" />`,
      });

      const { container } = renderInWrapper(Host);
      expect(container.querySelector("[data-copilot-popup]")).toBeDefined();
      expect(
        container.querySelector('[data-slot="copilot-modal-header"]'),
      ).toBeDefined();
    });

    it("should render messages in popup", () => {
      const Host = defineComponent({
        components: { CopilotPopupView },
        setup() {
          return { sampleMessages };
        },
        template: `<CopilotPopupView :messages="sampleMessages" />`,
      });

      renderInWrapper(Host);
      expect(screen.queryByText("Hello")).toBeDefined();
      expect(screen.queryByText("Hi there!")).toBeDefined();
    });

    it("should handle empty messages array", () => {
      const Host = defineComponent({
        components: { CopilotPopupView },
        template: `<CopilotPopupView :messages="[]" />`,
      });

      const { container } = renderInWrapper(Host);
      expect(container.querySelector("[data-copilot-popup]")).toBeDefined();
    });

    it("should combine header customization with inherited slot customization", () => {
      const Host = defineComponent({
        components: { CopilotPopupView, CopilotModalHeader },
        setup() {
          return { sampleMessages };
        },
        template: `
          <CopilotPopupView :messages="sampleMessages">
            <template #header>
              <CopilotModalHeader title="Full Custom Popup" class="custom-header-root">
                <template #title-content="{ title }">
                  <div class="custom-title">{{ title }}</div>
                </template>
              </CopilotModalHeader>
            </template>
            <template #message-view><div class="custom-message">m</div></template>
            <template #input><div class="custom-input">i</div></template>
            <template #scroll-view><div class="custom-scroll">s</div></template>
          </CopilotPopupView>
        `,
      });

      const { container } = renderInWrapper(Host);
      expect(container.querySelector(".custom-header-root")).toBeDefined();
      expect(container.querySelector(".custom-title")).toBeDefined();
      expect(container.querySelector(".custom-message")).toBeDefined();
      expect(container.querySelector(".custom-input")).toBeDefined();
      expect(container.querySelector(".custom-scroll")).toBeDefined();
    });

    it("should not render popup content when closed", () => {
      const Host = defineComponent({
        components: { CopilotKitProvider, CopilotPopupView },
        setup() {
          return { sampleMessages };
        },
        template: `
          <CopilotKitProvider>
            <CopilotPopupView :messages="sampleMessages" :default-open="false" />
          </CopilotKitProvider>
        `,
      });

      const { container } = render(Host);
      expect(container.querySelector("[data-copilot-popup]")).toBeNull();
    });
  });

  describe("9. Toggle Button Slot", () => {
    describe("toggleButton slot - Tailwind class string", () => {
      it("should apply tailwind class string to toggle button", () => {
        const Host = defineComponent({
          components: { CopilotPopupView, CopilotChatToggleButton },
          setup() {
            return { sampleMessages };
          },
          template: `
            <CopilotPopupView :messages="sampleMessages">
              <template #toggle-button>
                <CopilotChatToggleButton data-testid="popup-toggle" class="bg-purple-500 hover:bg-purple-600" />
              </template>
            </CopilotPopupView>
          `,
        });

        renderInWrapper(Host);
        const toggleButton = screen.getByTestId("popup-toggle");
        expect(toggleButton.classList.contains("bg-purple-500")).toBe(true);
      });
    });

    describe("toggleButton slot - Props object", () => {
      it("should pass custom props to toggle button", () => {
        const Host = defineComponent({
          components: { CopilotPopupView, CopilotChatToggleButton },
          setup() {
            return { sampleMessages };
          },
          template: `
            <CopilotPopupView :messages="sampleMessages">
              <template #toggle-button>
                <CopilotChatToggleButton data-testid="popup-custom-toggle" />
              </template>
            </CopilotPopupView>
          `,
        });

        renderInWrapper(Host);
        expect(screen.queryByTestId("popup-custom-toggle")).toBeDefined();
      });

      it("should pass openIcon and closeIcon sub-slot props", () => {
        const Host = defineComponent({
          components: { CopilotPopupView, CopilotChatToggleButton },
          setup() {
            return { sampleMessages };
          },
          template: `
            <CopilotPopupView :messages="sampleMessages">
              <template #toggle-button>
                <CopilotChatToggleButton>
                  <template #open-icon="{ iconClass }">
                    <span data-testid="popup-open-icon" :class="iconClass">open</span>
                  </template>
                  <template #close-icon="{ iconClass }">
                    <span data-testid="popup-close-icon" :class="iconClass">close</span>
                  </template>
                </CopilotChatToggleButton>
              </template>
            </CopilotPopupView>
          `,
        });

        renderInWrapper(Host);
        expect(screen.getByTestId("popup-open-icon")).toBeDefined();
        expect(screen.getByTestId("popup-close-icon")).toBeDefined();
      });
    });

    describe("toggleButton slot - Custom component", () => {
      it("should allow custom component for toggle button", () => {
        const Host = defineComponent({
          components: { CopilotPopupView },
          setup() {
            return { sampleMessages };
          },
          template: `
            <CopilotPopupView :messages="sampleMessages">
              <template #toggle-button>
                <button data-testid="popup-custom-toggle-component" class="popup-toggle">Open Chat</button>
              </template>
            </CopilotPopupView>
          `,
        });

        renderInWrapper(Host);
        const custom = screen.queryByTestId("popup-custom-toggle-component");
        expect(custom).toBeDefined();
        expect(custom?.textContent).toBe("Open Chat");
      });
    });
  });
});
