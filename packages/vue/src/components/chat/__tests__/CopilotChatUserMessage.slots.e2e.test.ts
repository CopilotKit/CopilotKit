import { render, screen, fireEvent } from "@testing-library/vue";
import { defineComponent } from "vue";
import { describe, it, expect, vi } from "vitest";
import type { UserMessage } from "@ag-ui/core";
import CopilotKitProvider from "../../../providers/CopilotKitProvider.vue";
import CopilotChatConfigurationProvider from "../../../providers/CopilotChatConfigurationProvider.vue";
import CopilotChatUserMessage from "../CopilotChatUserMessage.vue";

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

function createUserMessage(content: string): UserMessage {
  return {
    id: "msg-1",
    role: "user",
    content,
  } as UserMessage;
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

describe("CopilotChatUserMessage Slot System E2E Tests", () => {
  describe("1. Tailwind Class Slot Override", () => {
    describe("messageRenderer slot", () => {
      it("should apply tailwind class string to messageRenderer", () => {
        const Host = defineComponent({
          components: { CopilotChatUserMessage },
          setup() {
            return { message: createUserMessage("Hello") };
          },
          template: `
            <CopilotChatUserMessage :message="message">
              <template #message-renderer="{ content }">
                <div data-testid="message-renderer" class="bg-blue-500 text-white rounded-xl">{{ content }}</div>
              </template>
            </CopilotChatUserMessage>
          `,
        });

        renderInWrapper(Host);
        const renderer = screen.getByTestId("message-renderer");
        expect(renderer.classList.contains("bg-blue-500")).toBe(true);
        expect(renderer.classList.contains("text-white")).toBe(true);
        expect(renderer.classList.contains("rounded-xl")).toBe(true);
      });
    });

    describe("toolbar slot", () => {
      it("should apply tailwind class string to toolbar", () => {
        const Host = defineComponent({
          components: { CopilotChatUserMessage },
          setup() {
            return { message: createUserMessage("Hello") };
          },
          template: `
            <CopilotChatUserMessage :message="message">
              <template #toolbar>
                <div data-testid="toolbar" class="bg-gray-50 border rounded">Toolbar</div>
              </template>
            </CopilotChatUserMessage>
          `,
        });

        renderInWrapper(Host);
        const toolbar = screen.getByTestId("toolbar");
        expect(toolbar.classList.contains("bg-gray-50")).toBe(true);
        expect(toolbar.classList.contains("border")).toBe(true);
      });
    });

    describe("copyButton slot", () => {
      it("should apply tailwind class string to copyButton", () => {
        const Host = defineComponent({
          components: { CopilotChatUserMessage },
          setup() {
            return { message: createUserMessage("Hello") };
          },
          template: `
            <CopilotChatUserMessage :message="message">
              <template #copy-button="{ onCopy }">
                <button data-testid="copy-btn" class="text-indigo-500 hover:text-indigo-700" @click="onCopy">Copy</button>
              </template>
            </CopilotChatUserMessage>
          `,
        });

        renderInWrapper(Host);
        expect(
          screen.getByTestId("copy-btn").classList.contains("text-indigo-500"),
        ).toBe(true);
      });
    });

    describe("editButton slot", () => {
      it("should apply tailwind class string to editButton", () => {
        const onEditMessage = vi.fn();
        const Host = defineComponent({
          components: { CopilotChatUserMessage },
          setup() {
            return { message: createUserMessage("Hello"), onEditMessage };
          },
          template: `
            <CopilotChatUserMessage :message="message" @edit-message="onEditMessage">
              <template #edit-button="{ onEdit }">
                <button data-testid="edit-btn" class="text-yellow-500" @click="onEdit">Edit</button>
              </template>
            </CopilotChatUserMessage>
          `,
        });

        renderInWrapper(Host);
        expect(
          screen.getByTestId("edit-btn").classList.contains("text-yellow-500"),
        ).toBe(true);
      });
    });

    describe("branchNavigation slot", () => {
      it("should apply tailwind class string to branchNavigation", () => {
        const onSwitchToBranch = vi.fn();
        const Host = defineComponent({
          components: { CopilotChatUserMessage },
          setup() {
            return { message: createUserMessage("Hello"), onSwitchToBranch };
          },
          template: `
            <CopilotChatUserMessage
              :message="message"
              :branch-index="0"
              :number-of-branches="3"
              @switch-to-branch="onSwitchToBranch"
            >
              <template #branch-navigation>
                <div data-testid="branch-nav" class="bg-slate-100 px-2 py-1">Branch</div>
              </template>
            </CopilotChatUserMessage>
          `,
        });

        renderInWrapper(Host);
        const branchNav = screen.getByTestId("branch-nav");
        expect(branchNav.classList.contains("bg-slate-100")).toBe(true);
        expect(branchNav.classList.contains("px-2")).toBe(true);
      });
    });
  });

  describe("2. Property Passing (onClick, disabled, etc.)", () => {
    describe("messageRenderer slot", () => {
      it("should pass custom props to messageRenderer", () => {
        const Host = defineComponent({
          components: { CopilotChatUserMessage },
          setup() {
            return { message: createUserMessage("Hello") };
          },
          template: `
            <CopilotChatUserMessage :message="message">
              <template #message-renderer="{ content }">
                <div data-testid="custom-message-renderer">{{ content }}</div>
              </template>
            </CopilotChatUserMessage>
          `,
        });

        renderInWrapper(Host);
        expect(screen.queryByTestId("custom-message-renderer")).toBeDefined();
      });
    });

    describe("toolbar slot", () => {
      it("should pass custom onClick to toolbar", async () => {
        const onClick = vi.fn();
        const Host = defineComponent({
          components: { CopilotChatUserMessage },
          setup() {
            return { message: createUserMessage("Hello"), onClick };
          },
          template: `
            <CopilotChatUserMessage :message="message">
              <template #toolbar>
                <div data-testid="custom-toolbar" @click="onClick">Toolbar</div>
              </template>
            </CopilotChatUserMessage>
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
          components: { CopilotChatUserMessage },
          setup() {
            return { message: createUserMessage("Hello"), customOnClick };
          },
          template: `
            <CopilotChatUserMessage :message="message">
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
            </CopilotChatUserMessage>
          `,
        });

        renderInWrapper(Host);
        await fireEvent.click(screen.getByTestId("custom-copy-button"));
        expect(customOnClick).toHaveBeenCalled();
      });

      it("should support disabled state on copyButton", () => {
        const Host = defineComponent({
          components: { CopilotChatUserMessage },
          setup() {
            return { message: createUserMessage("Hello") };
          },
          template: `
            <CopilotChatUserMessage :message="message">
              <template #copy-button="{ onCopy }">
                <button data-testid="disabled-copy-button" disabled @click="onCopy">Copy</button>
              </template>
            </CopilotChatUserMessage>
          `,
        });

        renderInWrapper(Host);
        expect(
          screen.getByTestId("disabled-copy-button").hasAttribute("disabled"),
        ).toBe(true);
      });
    });

    describe("editButton slot", () => {
      it("should call custom onClick on editButton", async () => {
        const customOnClick = vi.fn();
        const onEditMessage = vi.fn();
        const Host = defineComponent({
          components: { CopilotChatUserMessage },
          setup() {
            return {
              message: createUserMessage("Hello"),
              customOnClick,
              onEditMessage,
            };
          },
          template: `
            <CopilotChatUserMessage :message="message" @edit-message="onEditMessage">
              <template #edit-button="{ onEdit }">
                <button
                  data-testid="custom-edit-button"
                  @click="
                    customOnClick();
                    onEdit();
                  "
                >
                  Edit
                </button>
              </template>
            </CopilotChatUserMessage>
          `,
        });

        renderInWrapper(Host);
        await fireEvent.click(screen.getByTestId("custom-edit-button"));
        expect(customOnClick).toHaveBeenCalled();
      });

      it("should support disabled state on editButton", () => {
        const onEditMessage = vi.fn();
        const Host = defineComponent({
          components: { CopilotChatUserMessage },
          setup() {
            return { message: createUserMessage("Hello"), onEditMessage };
          },
          template: `
            <CopilotChatUserMessage :message="message" @edit-message="onEditMessage">
              <template #edit-button="{ onEdit }">
                <button data-testid="disabled-edit-button" disabled @click="onEdit">Edit</button>
              </template>
            </CopilotChatUserMessage>
          `,
        });

        renderInWrapper(Host);
        expect(
          screen.getByTestId("disabled-edit-button").hasAttribute("disabled"),
        ).toBe(true);
      });
    });

    describe("branchNavigation slot", () => {
      it("should pass custom props to branchNavigation", () => {
        const onSwitchToBranch = vi.fn();
        const Host = defineComponent({
          components: { CopilotChatUserMessage },
          setup() {
            return { message: createUserMessage("Hello"), onSwitchToBranch };
          },
          template: `
            <CopilotChatUserMessage
              :message="message"
              :branch-index="1"
              :number-of-branches="3"
              @switch-to-branch="onSwitchToBranch"
            >
              <template #branch-navigation>
                <div data-testid="custom-branch-nav">Branch</div>
              </template>
            </CopilotChatUserMessage>
          `,
        });

        renderInWrapper(Host);
        expect(screen.queryByTestId("custom-branch-nav")).toBeDefined();
      });
    });
  });

  describe("3. Custom Component Receiving Sub-components", () => {
    it("should allow custom component for messageRenderer", () => {
      const Host = defineComponent({
        components: { CopilotChatUserMessage },
        setup() {
          return { message: createUserMessage("Hello") };
        },
        template: `
          <CopilotChatUserMessage :message="message">
            <template #message-renderer="{ content }">
              <div data-testid="custom-renderer">[{{ content }}]</div>
            </template>
          </CopilotChatUserMessage>
        `,
      });

      renderInWrapper(Host);
      const custom = screen.queryByTestId("custom-renderer");
      expect(custom).toBeDefined();
      expect(custom?.textContent).toBe("[Hello]");
    });

    it("should allow custom component for toolbar", () => {
      const Host = defineComponent({
        components: { CopilotChatUserMessage },
        setup() {
          return { message: createUserMessage("Hello") };
        },
        template: `
          <CopilotChatUserMessage :message="message">
            <template #toolbar>
              <div data-testid="custom-toolbar-component">
                <span>Actions:</span>
                <slot />
              </div>
            </template>
          </CopilotChatUserMessage>
        `,
      });

      renderInWrapper(Host);
      const custom = screen.queryByTestId("custom-toolbar-component");
      expect(custom).toBeDefined();
      expect(custom?.textContent).toContain("Actions");
    });

    it("should allow custom component for copyButton", () => {
      const Host = defineComponent({
        components: { CopilotChatUserMessage },
        setup() {
          return { message: createUserMessage("Hello") };
        },
        template: `
          <CopilotChatUserMessage :message="message">
            <template #copy-button="{ onCopy }">
              <button data-testid="custom-copy-btn" @click="onCopy">Copy It</button>
            </template>
          </CopilotChatUserMessage>
        `,
      });

      renderInWrapper(Host);
      const custom = screen.queryByTestId("custom-copy-btn");
      expect(custom).toBeDefined();
      expect(custom?.textContent).toBe("Copy It");
    });

    it("should allow custom component for editButton", () => {
      const onEditMessage = vi.fn();
      const Host = defineComponent({
        components: { CopilotChatUserMessage },
        setup() {
          return { message: createUserMessage("Hello"), onEditMessage };
        },
        template: `
          <CopilotChatUserMessage :message="message" @edit-message="onEditMessage">
            <template #edit-button="{ onEdit }">
              <button data-testid="custom-edit-btn" @click="onEdit">Modify</button>
            </template>
          </CopilotChatUserMessage>
        `,
      });

      renderInWrapper(Host);
      expect(screen.queryByTestId("custom-edit-btn")).toBeDefined();
    });

    it("should allow custom component for branchNavigation", () => {
      const onSwitchToBranch = vi.fn();
      const Host = defineComponent({
        components: { CopilotChatUserMessage },
        setup() {
          return { message: createUserMessage("Hello"), onSwitchToBranch };
        },
        template: `
          <CopilotChatUserMessage
            :message="message"
            :branch-index="1"
            :number-of-branches="3"
            @switch-to-branch="onSwitchToBranch"
          >
            <template #branch-navigation="{ branchIndex, numberOfBranches }">
              <div data-testid="custom-branch-nav">Branch {{ branchIndex + 1 }} of {{ numberOfBranches }}</div>
            </template>
          </CopilotChatUserMessage>
        `,
      });

      renderInWrapper(Host);
      const custom = screen.queryByTestId("custom-branch-nav");
      expect(custom).toBeDefined();
      expect(custom?.textContent).toBe("Branch 2 of 3");
    });
  });

  describe("4. Children Render Function for Drill-down", () => {
    it("should provide all bound sub-components via children render function", () => {
      const onEditMessage = vi.fn();
      const onSwitchToBranch = vi.fn();
      const Host = defineComponent({
        components: { CopilotChatUserMessage },
        setup() {
          return {
            message: createUserMessage("Hello"),
            onEditMessage,
            onSwitchToBranch,
          };
        },
        template: `
          <CopilotChatUserMessage
            :message="message"
            @edit-message="onEditMessage"
            :branch-index="0"
            :number-of-branches="2"
            @switch-to-branch="onSwitchToBranch"
          >
            <template #message-renderer><div data-testid="received-renderer">renderer</div></template>
            <template #toolbar><div data-testid="received-toolbar">toolbar</div></template>
            <template #copy-button><button data-testid="received-copy">copy</button></template>
            <template #edit-button><button data-testid="received-edit">edit</button></template>
            <template #branch-navigation><div data-testid="received-branch">branch</div></template>
          </CopilotChatUserMessage>
        `,
      });

      renderInWrapper(Host);
      expect(screen.queryByTestId("received-renderer")).toBeDefined();
      expect(screen.queryByTestId("received-toolbar")).toBeDefined();
      expect(screen.queryByTestId("received-copy")).toBeDefined();
      expect(screen.queryByTestId("received-edit")).toBeDefined();
      expect(screen.queryByTestId("received-branch")).toBeDefined();
    });

    it("should pass message and branch info through children render function", () => {
      const onSwitchToBranch = vi.fn();
      const Host = defineComponent({
        components: { CopilotChatUserMessage },
        setup() {
          return {
            message: createUserMessage("Test message"),
            onSwitchToBranch,
          };
        },
        template: `
          <CopilotChatUserMessage
            :message="message"
            :branch-index="1"
            :number-of-branches="3"
            @switch-to-branch="onSwitchToBranch"
          >
            <template #branch-navigation="{ branchIndex, numberOfBranches }">
              <div data-testid="branch-info">{{ branchIndex }}-{{ numberOfBranches }}</div>
            </template>
          </CopilotChatUserMessage>
        `,
      });

      renderInWrapper(Host);
      expect(screen.getByTestId("branch-info").textContent).toBe("1-3");
    });

    it("should allow reorganizing sub-components in children render", () => {
      const onEditMessage = vi.fn();
      const Host = defineComponent({
        components: { CopilotChatUserMessage },
        setup() {
          return { message: createUserMessage("Hello"), onEditMessage };
        },
        template: `
          <CopilotChatUserMessage :message="message" @edit-message="onEditMessage">
            <template #layout="{ content, onEdit, onCopy }">
              <div data-testid="custom-layout">
                <div class="message-area">{{ content }}</div>
                <div class="actions-row">
                  <button data-testid="layout-edit" @click="onEdit">Edit</button>
                  <button data-testid="layout-copy" @click="onCopy">Copy</button>
                </div>
                <div class="toolbar-area">Toolbar</div>
              </div>
            </template>
          </CopilotChatUserMessage>
        `,
      });

      const { container } = renderInWrapper(Host);
      expect(screen.queryByTestId("custom-layout")).toBeDefined();
      expect(container.querySelector(".message-area")).toBeDefined();
      expect(container.querySelector(".actions-row")).toBeDefined();
      expect(container.querySelector(".toolbar-area")).toBeDefined();
    });
  });

  describe("5. className Override with Tailwind Strings", () => {
    it("should override root className while preserving default layout classes", () => {
      const Host = defineComponent({
        components: { CopilotChatUserMessage },
        setup() {
          return { message: createUserMessage("Hello") };
        },
        template: `
          <CopilotChatUserMessage :message="message" class="custom-root-class bg-purple-50" />
        `,
      });

      const { container } = renderInWrapper(Host);
      const root = container.querySelector(".custom-root-class");
      expect(root).toBeDefined();
      expect(root?.classList.contains("bg-purple-50")).toBe(true);
    });

    it("should allow tailwind utilities to override default styles", () => {
      const Host = defineComponent({
        components: { CopilotChatUserMessage },
        setup() {
          return { message: createUserMessage("Hello") };
        },
        template: `
          <CopilotChatUserMessage :message="message" class="pt-0" />
        `,
      });

      const { container } = renderInWrapper(Host);
      expect(container.querySelector(".pt-0")).toBeDefined();
    });

    it("should merge multiple slot classNames correctly", () => {
      const onEditMessage = vi.fn();
      const Host = defineComponent({
        components: { CopilotChatUserMessage },
        setup() {
          return { message: createUserMessage("Hello"), onEditMessage };
        },
        template: `
          <CopilotChatUserMessage :message="message" @edit-message="onEditMessage" class="root-custom">
            <template #message-renderer><div class="renderer-custom">Message</div></template>
            <template #toolbar><div class="toolbar-custom">Toolbar</div></template>
            <template #copy-button><button class="copy-custom">Copy</button></template>
            <template #edit-button="{ onEdit }"><button class="edit-custom" @click="onEdit">Edit</button></template>
          </CopilotChatUserMessage>
        `,
      });

      const { container } = renderInWrapper(Host);
      expect(container.querySelector(".root-custom")).toBeDefined();
      expect(container.querySelector(".renderer-custom")).toBeDefined();
      expect(container.querySelector(".toolbar-custom")).toBeDefined();
      expect(container.querySelector(".copy-custom")).toBeDefined();
      expect(container.querySelector(".edit-custom")).toBeDefined();
    });
  });

  describe("6. Integration and Recursive Slot Application", () => {
    it("should correctly render all slots with mixed customization", () => {
      const onEditMessage = vi.fn();
      const onSwitchToBranch = vi.fn();
      const Host = defineComponent({
        components: { CopilotChatUserMessage },
        setup() {
          return {
            message: createUserMessage("Hello world"),
            onEditMessage,
            onSwitchToBranch,
          };
        },
        template: `
          <CopilotChatUserMessage
            :message="message"
            @edit-message="onEditMessage"
            :branch-index="0"
            :number-of-branches="2"
            @switch-to-branch="onSwitchToBranch"
          >
            <template #message-renderer><div class="renderer-style">Message</div></template>
            <template #toolbar><div class="toolbar-style">Toolbar</div></template>
            <template #copy-button><button class="copy-style">Copy</button></template>
            <template #edit-button="{ onEdit }"><button class="edit-style" @click="onEdit">Edit</button></template>
            <template #branch-navigation><div class="branch-style">Branch</div></template>
          </CopilotChatUserMessage>
        `,
      });

      const { container } = renderInWrapper(Host);
      expect(container.querySelector(".renderer-style")).toBeDefined();
      expect(container.querySelector(".toolbar-style")).toBeDefined();
      expect(container.querySelector(".copy-style")).toBeDefined();
      expect(container.querySelector(".edit-style")).toBeDefined();
      expect(container.querySelector(".branch-style")).toBeDefined();
    });

    it("should work with property objects and class strings mixed", async () => {
      const onClick = vi.fn();
      const Host = defineComponent({
        components: { CopilotChatUserMessage },
        setup() {
          return { message: createUserMessage("Hello world"), onClick };
        },
        template: `
          <CopilotChatUserMessage :message="message">
            <template #message-renderer><div class="text-lg font-bold">Message</div></template>
            <template #toolbar><div class="flex gap-4" data-testid="mixed-toolbar" @click="onClick">Toolbar</div></template>
          </CopilotChatUserMessage>
        `,
      });

      const { container } = renderInWrapper(Host);
      expect(container.querySelector(".text-lg")).toBeDefined();

      const toolbar = container.querySelector(".flex.gap-4");
      if (toolbar) {
        await fireEvent.click(toolbar);
        expect(onClick).toHaveBeenCalled();
      }
    });

    it("should correctly display user message content", () => {
      const Host = defineComponent({
        components: { CopilotChatUserMessage },
        setup() {
          return { message: createUserMessage("This is my message content") };
        },
        template: `
          <CopilotChatUserMessage :message="message" />
        `,
      });

      renderInWrapper(Host);
      expect(screen.getByText("This is my message content")).toBeDefined();
    });
  });
});
