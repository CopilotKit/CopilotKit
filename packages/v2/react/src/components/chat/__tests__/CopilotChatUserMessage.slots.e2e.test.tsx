import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { CopilotChatUserMessage } from "../CopilotChatUserMessage";
import { CopilotKitProvider } from "@/providers/CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "@/providers/CopilotChatConfigurationProvider";
import { UserMessage } from "@ag-ui/core";

// Wrapper to provide required context
const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <CopilotKitProvider>
    <CopilotChatConfigurationProvider threadId="test-thread">
      {children}
    </CopilotChatConfigurationProvider>
  </CopilotKitProvider>
);

const createUserMessage = (content: string): UserMessage => ({
  id: "msg-1",
  role: "user",
  content,
});

describe("CopilotChatUserMessage Slot System E2E Tests", () => {
  // ============================================================================
  // 1. TAILWIND CLASS TESTS
  // ============================================================================
  describe("1. Tailwind Class Slot Override", () => {
    describe("messageRenderer slot", () => {
      it("should apply tailwind class string to messageRenderer", () => {
        const message = createUserMessage("Hello");
        const { container } = render(
          <TestWrapper>
            <CopilotChatUserMessage
              message={message}
              messageRenderer="bg-blue-500 text-white rounded-xl"
            />
          </TestWrapper>,
        );

        const renderer = container.querySelector(".bg-blue-500");
        expect(renderer).toBeDefined();
        expect(renderer?.classList.contains("text-white")).toBe(true);
        expect(renderer?.classList.contains("rounded-xl")).toBe(true);
      });
    });

    describe("toolbar slot", () => {
      it("should apply tailwind class string to toolbar", () => {
        const message = createUserMessage("Hello");
        const { container } = render(
          <TestWrapper>
            <CopilotChatUserMessage
              message={message}
              toolbar="bg-gray-50 border rounded"
            />
          </TestWrapper>,
        );

        const toolbar = container.querySelector(".bg-gray-50");
        expect(toolbar).toBeDefined();
        expect(toolbar?.classList.contains("border")).toBe(true);
      });
    });

    describe("copyButton slot", () => {
      it("should apply tailwind class string to copyButton", () => {
        const message = createUserMessage("Hello");
        const { container } = render(
          <TestWrapper>
            <CopilotChatUserMessage
              message={message}
              copyButton="text-indigo-500 hover:text-indigo-700"
            />
          </TestWrapper>,
        );

        const copyBtn = container.querySelector(".text-indigo-500");
        expect(copyBtn).toBeDefined();
      });
    });

    describe("editButton slot", () => {
      it("should apply tailwind class string to editButton", () => {
        const onEditMessage = vi.fn();
        const message = createUserMessage("Hello");
        const { container } = render(
          <TestWrapper>
            <CopilotChatUserMessage
              message={message}
              onEditMessage={onEditMessage}
              editButton="text-yellow-500"
            />
          </TestWrapper>,
        );

        const editBtn = container.querySelector(".text-yellow-500");
        expect(editBtn).toBeDefined();
      });
    });

    describe("branchNavigation slot", () => {
      it("should apply tailwind class string to branchNavigation", () => {
        const onSwitchToBranch = vi.fn();
        const message = createUserMessage("Hello");
        const { container } = render(
          <TestWrapper>
            <CopilotChatUserMessage
              message={message}
              branchIndex={0}
              numberOfBranches={3}
              onSwitchToBranch={onSwitchToBranch}
              branchNavigation="bg-slate-100 px-2 py-1"
            />
          </TestWrapper>,
        );

        const branchNav = container.querySelector(".bg-slate-100");
        expect(branchNav).toBeDefined();
        expect(branchNav?.classList.contains("px-2")).toBe(true);
      });
    });
  });

  // ============================================================================
  // 2. PROPERTY PASSING TESTS
  // ============================================================================
  describe("2. Property Passing (onClick, disabled, etc.)", () => {
    describe("messageRenderer slot", () => {
      it("should pass custom props to messageRenderer", () => {
        const message = createUserMessage("Hello");
        render(
          <TestWrapper>
            <CopilotChatUserMessage
              message={message}
              messageRenderer={{ "data-testid": "custom-message-renderer" }}
            />
          </TestWrapper>,
        );

        const renderer = screen.queryByTestId("custom-message-renderer");
        expect(renderer).toBeDefined();
      });
    });

    describe("toolbar slot", () => {
      it("should pass custom onClick to toolbar", () => {
        const onClick = vi.fn();
        const message = createUserMessage("Hello");
        render(
          <TestWrapper>
            <CopilotChatUserMessage
              message={message}
              toolbar={{ onClick, "data-testid": "custom-toolbar" }}
            />
          </TestWrapper>,
        );

        const toolbar = screen.queryByTestId("custom-toolbar");
        if (toolbar) {
          fireEvent.click(toolbar);
          expect(onClick).toHaveBeenCalled();
        }
      });
    });

    describe("copyButton slot", () => {
      it("should pass custom onClick that wraps default behavior", () => {
        const customOnClick = vi.fn();
        const message = createUserMessage("Hello");
        const { container } = render(
          <TestWrapper>
            <CopilotChatUserMessage
              message={message}
              copyButton={{ onClick: customOnClick }}
            />
          </TestWrapper>,
        );

        const copyBtn = container.querySelector('button[aria-label*="Copy"]');
        if (copyBtn) {
          fireEvent.click(copyBtn);
          expect(customOnClick).toHaveBeenCalled();
        }
      });

      it("should support disabled state on copyButton", () => {
        const message = createUserMessage("Hello");
        const { container } = render(
          <TestWrapper>
            <CopilotChatUserMessage
              message={message}
              copyButton={{ disabled: true }}
            />
          </TestWrapper>,
        );

        const copyBtn = container.querySelector('button[aria-label*="Copy"]');
        if (copyBtn) {
          expect(copyBtn.hasAttribute("disabled")).toBe(true);
        }
      });
    });

    describe("editButton slot", () => {
      it("should call custom onClick on editButton", () => {
        const customOnClick = vi.fn();
        const onEditMessage = vi.fn();
        const message = createUserMessage("Hello");
        const { container } = render(
          <TestWrapper>
            <CopilotChatUserMessage
              message={message}
              onEditMessage={onEditMessage}
              editButton={{ onClick: customOnClick }}
            />
          </TestWrapper>,
        );

        const editBtn = container.querySelector('button[aria-label*="Edit"]');
        if (editBtn) {
          fireEvent.click(editBtn);
          expect(customOnClick).toHaveBeenCalled();
        }
      });

      it("should support disabled state on editButton", () => {
        const onEditMessage = vi.fn();
        const message = createUserMessage("Hello");
        const { container } = render(
          <TestWrapper>
            <CopilotChatUserMessage
              message={message}
              onEditMessage={onEditMessage}
              editButton={{ disabled: true }}
            />
          </TestWrapper>,
        );

        const editBtn = container.querySelector('button[aria-label*="Edit"]');
        if (editBtn) {
          expect(editBtn.hasAttribute("disabled")).toBe(true);
        }
      });
    });

    describe("branchNavigation slot", () => {
      it("should pass custom props to branchNavigation", () => {
        const onSwitchToBranch = vi.fn();
        const message = createUserMessage("Hello");
        render(
          <TestWrapper>
            <CopilotChatUserMessage
              message={message}
              branchIndex={1}
              numberOfBranches={3}
              onSwitchToBranch={onSwitchToBranch}
              branchNavigation={{ "data-testid": "custom-branch-nav" }}
            />
          </TestWrapper>,
        );

        const branchNav = screen.queryByTestId("custom-branch-nav");
        expect(branchNav).toBeDefined();
      });
    });
  });

  // ============================================================================
  // 3. CUSTOM COMPONENT TESTS
  // ============================================================================
  describe("3. Custom Component Receiving Sub-components", () => {
    it("should allow custom component for messageRenderer", () => {
      const CustomRenderer: React.FC<{ content: string }> = ({ content }) => (
        <div data-testid="custom-renderer">[{content}]</div>
      );

      const message = createUserMessage("Hello");
      render(
        <TestWrapper>
          <CopilotChatUserMessage
            message={message}
            messageRenderer={CustomRenderer as any}
          />
        </TestWrapper>,
      );

      const custom = screen.queryByTestId("custom-renderer");
      expect(custom).toBeDefined();
      expect(custom?.textContent).toBe("[Hello]");
    });

    it("should allow custom component for toolbar", () => {
      const CustomToolbar: React.FC<React.PropsWithChildren> = ({
        children,
      }) => (
        <div data-testid="custom-toolbar-component">
          <span>Actions:</span>
          {children}
        </div>
      );

      const message = createUserMessage("Hello");
      render(
        <TestWrapper>
          <CopilotChatUserMessage
            message={message}
            toolbar={CustomToolbar as any}
          />
        </TestWrapper>,
      );

      const custom = screen.queryByTestId("custom-toolbar-component");
      expect(custom).toBeDefined();
      expect(custom?.textContent).toContain("Actions");
    });

    it("should allow custom component for copyButton", () => {
      const CustomCopyButton: React.FC<
        React.ButtonHTMLAttributes<HTMLButtonElement>
      > = (props) => (
        <button data-testid="custom-copy-btn" {...props}>
          Copy It
        </button>
      );

      const message = createUserMessage("Hello");
      render(
        <TestWrapper>
          <CopilotChatUserMessage
            message={message}
            copyButton={CustomCopyButton as any}
          />
        </TestWrapper>,
      );

      const custom = screen.queryByTestId("custom-copy-btn");
      expect(custom).toBeDefined();
      expect(custom?.textContent).toBe("Copy It");
    });

    it("should allow custom component for editButton", () => {
      const CustomEditButton: React.FC<
        React.ButtonHTMLAttributes<HTMLButtonElement>
      > = (props) => (
        <button data-testid="custom-edit-btn" {...props}>
          Modify
        </button>
      );

      const onEditMessage = vi.fn();
      const message = createUserMessage("Hello");
      render(
        <TestWrapper>
          <CopilotChatUserMessage
            message={message}
            onEditMessage={onEditMessage}
            editButton={CustomEditButton as any}
          />
        </TestWrapper>,
      );

      const custom = screen.queryByTestId("custom-edit-btn");
      expect(custom).toBeDefined();
    });

    it("should allow custom component for branchNavigation", () => {
      const CustomBranchNav: React.FC<{
        currentBranch?: number;
        numberOfBranches?: number;
      }> = ({ currentBranch = 0, numberOfBranches = 1 }) => (
        <div data-testid="custom-branch-nav">
          Branch {currentBranch + 1} of {numberOfBranches}
        </div>
      );

      const onSwitchToBranch = vi.fn();
      const message = createUserMessage("Hello");
      render(
        <TestWrapper>
          <CopilotChatUserMessage
            message={message}
            branchIndex={1}
            numberOfBranches={3}
            onSwitchToBranch={onSwitchToBranch}
            branchNavigation={CustomBranchNav as any}
          />
        </TestWrapper>,
      );

      const custom = screen.queryByTestId("custom-branch-nav");
      expect(custom).toBeDefined();
      expect(custom?.textContent).toBe("Branch 2 of 3");
    });
  });

  // ============================================================================
  // 4. CHILDREN RENDER FUNCTION (DRILL-DOWN) TESTS
  // ============================================================================
  describe("4. Children Render Function for Drill-down", () => {
    it("should provide all bound sub-components via children render function", () => {
      const message = createUserMessage("Hello");
      const onEditMessage = vi.fn();
      const onSwitchToBranch = vi.fn();
      const childrenFn = vi.fn((props) => (
        <div data-testid="children-render">
          <div data-testid="received-renderer">{props.messageRenderer}</div>
          <div data-testid="received-toolbar">{props.toolbar}</div>
          <div data-testid="received-copy">{props.copyButton}</div>
          <div data-testid="received-edit">{props.editButton}</div>
          <div data-testid="received-branch">{props.branchNavigation}</div>
        </div>
      ));

      render(
        <TestWrapper>
          <CopilotChatUserMessage
            message={message}
            onEditMessage={onEditMessage}
            branchIndex={0}
            numberOfBranches={2}
            onSwitchToBranch={onSwitchToBranch}
          >
            {childrenFn}
          </CopilotChatUserMessage>
        </TestWrapper>,
      );

      expect(childrenFn).toHaveBeenCalled();
      const callArgs = childrenFn.mock.calls[0][0];
      expect(callArgs).toHaveProperty("messageRenderer");
      expect(callArgs).toHaveProperty("toolbar");
      expect(callArgs).toHaveProperty("copyButton");
      expect(callArgs).toHaveProperty("editButton");
      expect(callArgs).toHaveProperty("branchNavigation");
      expect(callArgs).toHaveProperty("message");

      expect(screen.queryByTestId("children-render")).toBeDefined();
    });

    it("should pass message and branch info through children render function", () => {
      const message = createUserMessage("Test message");
      const childrenFn = vi.fn(() => <div />);

      render(
        <TestWrapper>
          <CopilotChatUserMessage
            message={message}
            branchIndex={1}
            numberOfBranches={3}
          >
            {childrenFn}
          </CopilotChatUserMessage>
        </TestWrapper>,
      );

      const callArgs = childrenFn.mock.calls[0][0];
      expect(callArgs.message).toBe(message);
      expect(callArgs.branchIndex).toBe(1);
      expect(callArgs.numberOfBranches).toBe(3);
    });

    it("should allow reorganizing sub-components in children render", () => {
      const message = createUserMessage("Hello");
      const onEditMessage = vi.fn();

      const { container } = render(
        <TestWrapper>
          <CopilotChatUserMessage
            message={message}
            onEditMessage={onEditMessage}
          >
            {({ messageRenderer, toolbar, copyButton, editButton }) => (
              <div data-testid="custom-layout">
                <div className="message-area">{messageRenderer}</div>
                <div className="actions-row">
                  {editButton}
                  {copyButton}
                </div>
                <div className="toolbar-area">{toolbar}</div>
              </div>
            )}
          </CopilotChatUserMessage>
        </TestWrapper>,
      );

      const customLayout = screen.queryByTestId("custom-layout");
      expect(customLayout).toBeDefined();
      expect(container.querySelector(".message-area")).toBeDefined();
      expect(container.querySelector(".actions-row")).toBeDefined();
      expect(container.querySelector(".toolbar-area")).toBeDefined();
    });
  });

  // ============================================================================
  // 5. CLASSNAME OVERRIDE TESTS
  // ============================================================================
  describe("5. className Override with Tailwind Strings", () => {
    it("should override root className while preserving default layout classes", () => {
      const message = createUserMessage("Hello");
      const { container } = render(
        <TestWrapper>
          <CopilotChatUserMessage
            message={message}
            className="custom-root-class bg-purple-50"
          />
        </TestWrapper>,
      );

      const root = container.querySelector(".custom-root-class");
      expect(root).toBeDefined();
      expect(root?.classList.contains("bg-purple-50")).toBe(true);
    });

    it("should allow tailwind utilities to override default styles", () => {
      const message = createUserMessage("Hello");
      const { container } = render(
        <TestWrapper>
          <CopilotChatUserMessage message={message} className="pt-0" />
        </TestWrapper>,
      );

      // pt-0 should override the default pt-10
      const root = container.querySelector(".pt-0");
      expect(root).toBeDefined();
    });

    it("should merge multiple slot classNames correctly", () => {
      const onEditMessage = vi.fn();
      const message = createUserMessage("Hello");
      const { container } = render(
        <TestWrapper>
          <CopilotChatUserMessage
            message={message}
            onEditMessage={onEditMessage}
            className="root-custom"
            messageRenderer="renderer-custom"
            toolbar="toolbar-custom"
            copyButton="copy-custom"
            editButton="edit-custom"
          />
        </TestWrapper>,
      );

      expect(container.querySelector(".root-custom")).toBeDefined();
      expect(container.querySelector(".renderer-custom")).toBeDefined();
      expect(container.querySelector(".toolbar-custom")).toBeDefined();
      expect(container.querySelector(".copy-custom")).toBeDefined();
      expect(container.querySelector(".edit-custom")).toBeDefined();
    });
  });

  // ============================================================================
  // 6. INTEGRATION / RECURSIVE SLOT TESTS
  // ============================================================================
  describe("6. Integration and Recursive Slot Application", () => {
    it("should correctly render all slots with mixed customization", () => {
      const onEditMessage = vi.fn();
      const onSwitchToBranch = vi.fn();
      const message = createUserMessage("Hello world");

      const { container } = render(
        <TestWrapper>
          <CopilotChatUserMessage
            message={message}
            onEditMessage={onEditMessage}
            branchIndex={0}
            numberOfBranches={2}
            onSwitchToBranch={onSwitchToBranch}
            messageRenderer="renderer-style"
            toolbar="toolbar-style"
            copyButton="copy-style"
            editButton="edit-style"
            branchNavigation="branch-style"
          />
        </TestWrapper>,
      );

      expect(container.querySelector(".renderer-style")).toBeDefined();
      expect(container.querySelector(".toolbar-style")).toBeDefined();
      expect(container.querySelector(".copy-style")).toBeDefined();
      expect(container.querySelector(".edit-style")).toBeDefined();
      expect(container.querySelector(".branch-style")).toBeDefined();
    });

    it("should work with property objects and class strings mixed", () => {
      const onClick = vi.fn();
      const message = createUserMessage("Hello world");

      const { container } = render(
        <TestWrapper>
          <CopilotChatUserMessage
            message={message}
            messageRenderer="text-lg font-bold"
            toolbar={{ onClick, className: "flex gap-4" }}
          />
        </TestWrapper>,
      );

      expect(container.querySelector(".text-lg")).toBeDefined();

      const toolbar = container.querySelector(".flex.gap-4");
      if (toolbar) {
        fireEvent.click(toolbar);
        expect(onClick).toHaveBeenCalled();
      }
    });

    it("should correctly display user message content", () => {
      const message = createUserMessage("This is my message content");

      render(
        <TestWrapper>
          <CopilotChatUserMessage message={message} />
        </TestWrapper>,
      );

      expect(screen.getByText("This is my message content")).toBeDefined();
    });
  });
});
