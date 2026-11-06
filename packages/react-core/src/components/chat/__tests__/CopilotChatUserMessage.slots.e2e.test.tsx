import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, expect, vi } from "vitest";
import { CopilotChatUserMessage } from "../CopilotChatUserMessage";
import type { CopilotChatUserMessageProps } from "../CopilotChatUserMessage";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "../../../providers/CopilotChatConfigurationProvider";
import type { UserMessage } from "@ag-ui/core";

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

// Props that make the edit button and branch navigation render.
const withAllButtons = {
  onEditMessage: () => {},
  branchIndex: 1,
  numberOfBranches: 3,
  onSwitchToBranch: () => {},
} satisfies Partial<CopilotChatUserMessageProps>;

function renderMessage(props: Partial<CopilotChatUserMessageProps> = {}) {
  return render(
    <TestWrapper>
      <CopilotChatUserMessage message={createUserMessage("Hello")} {...props} />
    </TestWrapper>,
  );
}

const slotElements = {
  messageRenderer: () =>
    document.querySelector<HTMLElement>(".cpk-user-message-bubble"),
  toolbar: () => screen.getByTestId("copilot-user-toolbar"),
  copyButton: () => screen.getByTestId("copilot-user-copy-button"),
  editButton: () => screen.getByTestId("copilot-edit-button"),
  branchNavigation: () => screen.getByTestId("copilot-branch-navigation"),
};
const slotNames = Object.keys(slotElements) as (keyof typeof slotElements)[];

describe("CopilotChatUserMessage Slot System E2E Tests", () => {
  describe("1. Tailwind Class Slot Override", () => {
    it.each(slotNames)("should apply tailwind class string to %s", (slot) => {
      renderMessage({ ...withAllButtons, [slot]: "bg-slate-100 px-2" });

      expect(slotElements[slot]()).toHaveClass("bg-slate-100", "px-2");
    });
  });

  describe("2. Property Passing (onClick, disabled, etc.)", () => {
    it.each(slotNames)("should pass a className object to %s", (slot) => {
      renderMessage({
        ...withAllButtons,
        [slot]: { className: "from-object" },
      });

      expect(slotElements[slot]()).toHaveClass("from-object");
    });

    it("should pass custom onClick to toolbar", () => {
      const onClick = vi.fn();
      renderMessage({ toolbar: { onClick } });

      fireEvent.click(screen.getByTestId("copilot-user-toolbar"));

      expect(onClick).toHaveBeenCalledTimes(1);
    });

    it("should pass custom onClick to copyButton", () => {
      const customOnClick = vi.fn();
      renderMessage({ copyButton: { onClick: customOnClick } });

      fireEvent.click(screen.getByTestId("copilot-user-copy-button"));

      expect(customOnClick).toHaveBeenCalledTimes(1);
    });

    it("a custom onClick on editButton replaces onEditMessage", () => {
      const customOnClick = vi.fn();
      const onEditMessage = vi.fn();
      renderMessage({ onEditMessage, editButton: { onClick: customOnClick } });

      fireEvent.click(screen.getByTestId("copilot-edit-button"));

      expect(customOnClick).toHaveBeenCalledTimes(1);
      expect(onEditMessage).not.toHaveBeenCalled();
    });

    it.each(["copyButton", "editButton"] as const)(
      "should support disabled state on %s",
      (slot) => {
        renderMessage({ ...withAllButtons, [slot]: { disabled: true } });

        expect(slotElements[slot]()).toBeDisabled();
      },
    );
  });

  describe("3. Custom Component Receiving Sub-components", () => {
    it("should allow custom component for messageRenderer", () => {
      const CustomRenderer: React.FC<{ content: string }> = ({ content }) => (
        <div data-testid="custom-renderer">[{content}]</div>
      );

      renderMessage({ messageRenderer: CustomRenderer });

      expect(screen.getByTestId("custom-renderer")).toHaveTextContent(
        "[Hello]",
      );
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

      renderMessage({ toolbar: CustomToolbar });

      const custom = screen.getByTestId("custom-toolbar-component");
      expect(custom).toHaveTextContent("Actions:");
      // The custom toolbar still receives the bound buttons as children.
      expect(
        within(custom).getByTestId("copilot-user-copy-button"),
      ).toBeInTheDocument();
    });

    it.each(["copyButton", "editButton"] as const)(
      "should allow custom component for %s",
      (slot) => {
        const CustomButton: React.FC<
          React.ButtonHTMLAttributes<HTMLButtonElement>
        > = (props) => (
          <button data-testid="custom-btn" {...props}>
            Custom
          </button>
        );

        renderMessage({ ...withAllButtons, [slot]: CustomButton });

        expect(screen.getByTestId("custom-btn")).toHaveTextContent("Custom");
      },
    );

    it("should allow custom component for branchNavigation", () => {
      const CustomBranchNav: React.FC<{
        currentBranch?: number;
        numberOfBranches?: number;
      }> = ({ currentBranch = 0, numberOfBranches = 1 }) => (
        <div data-testid="custom-branch-nav">
          Branch {currentBranch + 1} of {numberOfBranches}
        </div>
      );

      renderMessage({ ...withAllButtons, branchNavigation: CustomBranchNav });

      expect(screen.getByTestId("custom-branch-nav")).toHaveTextContent(
        "Branch 2 of 3",
      );
    });
  });

  describe("4. Children Render Function for Drill-down", () => {
    it("should provide all bound sub-components via children render function", () => {
      render(
        <TestWrapper>
          <CopilotChatUserMessage
            message={createUserMessage("Hello")}
            {...withAllButtons}
          >
            {({
              messageRenderer,
              copyButton,
              editButton,
              branchNavigation,
            }) => (
              <div>
                <div data-testid="message-area">{messageRenderer}</div>
                <div data-testid="actions-row">
                  {editButton}
                  {copyButton}
                  {branchNavigation}
                </div>
              </div>
            )}
          </CopilotChatUserMessage>
        </TestWrapper>,
      );

      expect(screen.getByTestId("message-area")).toHaveTextContent("Hello");
      const actions = screen.getByTestId("actions-row");
      expect(
        within(actions).getByTestId("copilot-edit-button"),
      ).toBeInTheDocument();
      expect(
        within(actions).getByTestId("copilot-user-copy-button"),
      ).toBeInTheDocument();
      expect(
        within(actions).getByTestId("copilot-branch-navigation"),
      ).toBeInTheDocument();
    });

    it("should pass message and branch info through children render function", () => {
      const message = createUserMessage("Test message");
      const childrenFn = vi.fn(
        (_props: {
          message?: UserMessage;
          branchIndex?: number;
          numberOfBranches?: number;
        }) => <div />,
      );

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

      const callArgs = childrenFn.mock.calls[0]![0];
      expect(callArgs.message).toBe(message);
      expect(callArgs.branchIndex).toBe(1);
      expect(callArgs.numberOfBranches).toBe(3);
    });
  });

  describe("5. className Override with Tailwind Strings", () => {
    it("adds the root className to the default classes", () => {
      renderMessage({ className: "custom-root-class bg-purple-50" });

      expect(screen.getByTestId("copilot-user-message")).toHaveClass(
        "cpk-user-message",
        "custom-root-class",
        "bg-purple-50",
      );
    });
  });

  describe("6. Integration and Recursive Slot Application", () => {
    it("should correctly display user message content", () => {
      renderMessage({
        message: createUserMessage("This is my message content"),
      });

      expect(
        screen.getByText("This is my message content"),
      ).toBeInTheDocument();
    });
  });

  // The branch buttons show only a chevron, so their accessible names come
  // from the labels config.
  describe("branch navigation accessible names", () => {
    it("names the previous and next buttons with the default labels", () => {
      renderMessage(withAllButtons);

      expect(
        screen.getByRole("button", { name: "Previous branch" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Next branch" }),
      ).toBeInTheDocument();
    });

    it("uses the configured labels", () => {
      render(
        <CopilotKitProvider>
          <CopilotChatConfigurationProvider
            threadId="test-thread"
            labels={{
              userMessageToolbarPreviousBranchLabel: "Vorherige Antwort",
              userMessageToolbarNextBranchLabel: "Nächste Antwort",
            }}
          >
            <CopilotChatUserMessage
              message={createUserMessage("Hello")}
              {...withAllButtons}
            />
          </CopilotChatConfigurationProvider>
        </CopilotKitProvider>,
      );

      expect(
        screen.getByRole("button", { name: "Vorherige Antwort" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Nächste Antwort" }),
      ).toBeInTheDocument();
    });
  });
});
