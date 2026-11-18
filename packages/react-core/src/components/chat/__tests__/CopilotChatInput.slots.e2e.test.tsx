import React from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, it, expect, vi } from "vitest";
import { CopilotChatInput } from "../CopilotChatInput";
import type { CopilotChatInputProps } from "../CopilotChatInput";
import type { AudioRecorderRef } from "../CopilotChatAudioRecorder";
import { CopilotKitProvider } from "../../../providers/CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "../../../providers/CopilotChatConfigurationProvider";

// Wrapper to provide required context
const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <CopilotKitProvider>
    <CopilotChatConfigurationProvider threadId="test-thread">
      <div style={{ height: 200 }}>{children}</div>
    </CopilotChatConfigurationProvider>
  </CopilotKitProvider>
);

function renderInput(props: CopilotChatInputProps = {}) {
  return render(
    <TestWrapper>
      <CopilotChatInput {...props} />
    </TestWrapper>,
  );
}

// Props that make each optional slot render in the default layout.
const transcribing = {
  mode: "transcribe",
  onCancelTranscribe: () => {},
  onFinishTranscribe: () => {},
} as const satisfies CopilotChatInputProps;

describe("CopilotChatInput Slot System E2E Tests", () => {
  // The textArea and sendButton string slots are covered by
  // "accepts custom slot classes" in CopilotChatInput.test.tsx.
  describe("1. Tailwind Class Slot Override", () => {
    it.each([
      {
        slot: "startTranscribeButton",
        props: {
          onStartTranscribe: () => {},
          startTranscribeButton: "bg-red-500 rounded",
        },
        find: () => screen.getByTestId("copilot-start-transcribe-button"),
        defaultClass: "cpk-chat-input-start-transcribe-button",
      },
      {
        slot: "cancelTranscribeButton",
        props: { ...transcribing, cancelTranscribeButton: "bg-red-500" },
        find: () => screen.getByTestId("copilot-cancel-transcribe-button"),
        defaultClass: "cpk-chat-input-cancel-transcribe-button",
      },
      {
        slot: "finishTranscribeButton",
        props: { ...transcribing, finishTranscribeButton: "bg-red-500" },
        find: () => screen.getByTestId("copilot-finish-transcribe-button"),
        defaultClass: "cpk-chat-input-finish-transcribe-button",
      },
      {
        slot: "addMenuButton",
        props: {
          toolsMenu: [{ label: "Test", action: () => {} }],
          addMenuButton: "bg-red-500",
        },
        find: () => screen.getByTestId("copilot-add-menu-button"),
        defaultClass: "cpk-chat-input-add-menu-button",
      },
      {
        slot: "audioRecorder",
        props: { mode: "transcribe", audioRecorder: "bg-red-500" },
        find: () => document.querySelector<HTMLElement>(".cpk-audio-recorder"),
        defaultClass: "cpk-audio-recorder",
      },
      {
        slot: "disclaimer",
        props: { showDisclaimer: true, disclaimer: "bg-red-500 italic" },
        find: () =>
          document.querySelector<HTMLElement>(".cpk-chat-input-disclaimer"),
        defaultClass: "cpk-chat-input-disclaimer",
      },
    ] satisfies {
      slot: string;
      props: CopilotChatInputProps;
      find: () => HTMLElement | null;
      defaultClass: string;
    }[])(
      "merges a string $slot slot into the default className",
      ({ props, find, defaultClass }) => {
        renderInput(props);

        const el = find();
        expect(el).toHaveClass("bg-red-500", defaultClass);
      },
    );
  });

  describe("2. Properties Slot Override", () => {
    describe("textArea props", () => {
      it("should pass placeholder prop to textArea", async () => {
        renderInput({ textArea: { placeholder: "Custom placeholder..." } });

        expect(
          await screen.findByPlaceholderText("Custom placeholder..."),
        ).toBeInTheDocument();
      });

      it("should pass disabled prop to textArea", () => {
        renderInput({ textArea: { disabled: true } });

        expect(screen.getByTestId("copilot-chat-textarea")).toBeDisabled();
      });

      it("should pass onKeyDown prop to textArea", () => {
        const handleKeyDown = vi.fn();
        renderInput({ textArea: { onKeyDown: handleKeyDown } });

        fireEvent.keyDown(screen.getByTestId("copilot-chat-textarea"), {
          key: "a",
        });

        expect(handleKeyDown).toHaveBeenCalledTimes(1);
      });

      it("should pass autoFocus prop to textArea", () => {
        renderInput({ textArea: { autoFocus: true } });

        expect(screen.getByTestId("copilot-chat-textarea")).toHaveFocus();
      });

      it("should allow className prop in textArea object slot", () => {
        renderInput({ textArea: { className: "textarea-class-override" } });

        expect(screen.getByTestId("copilot-chat-textarea")).toHaveClass(
          "textarea-class-override",
        );
      });
    });

    // The aria-label override is covered by "keeps an aria-label passed
    // through a button slot" in CopilotChatInput.test.tsx.
    describe("sendButton props", () => {
      it("should pass onClick handler to sendButton", () => {
        const handleClick = vi.fn();
        renderInput({
          sendButton: { onClick: handleClick, disabled: false },
        });

        fireEvent.click(screen.getByTestId("copilot-send-button"));

        expect(handleClick).toHaveBeenCalledTimes(1);
      });

      it("should pass disabled prop to sendButton", () => {
        // A value and a submit handler enable the default send button.
        renderInput({
          value: "hello",
          onSubmitMessage: () => {},
          sendButton: { disabled: true },
        });

        expect(screen.getByTestId("copilot-send-button")).toBeDisabled();
      });

      it("user disabled should override default disabled state", () => {
        // An empty composer disables the default send button.
        renderInput({ sendButton: { disabled: false } });

        expect(screen.getByTestId("copilot-send-button")).toBeEnabled();
      });
    });

    describe("addMenuButton props", () => {
      it("should pass onClick handler to addMenuButton", () => {
        const handleClick = vi.fn();
        renderInput({
          toolsMenu: [{ label: "Item", action: () => {} }],
          addMenuButton: { onClick: handleClick },
        });

        fireEvent.click(screen.getByTestId("copilot-add-menu-button"));

        expect(handleClick).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("3. Custom Component Slot Override", () => {
    describe("textArea custom component", () => {
      it("should render custom textArea component", () => {
        const CustomTextArea = React.forwardRef<
          HTMLTextAreaElement,
          React.TextareaHTMLAttributes<HTMLTextAreaElement>
        >((props, ref) => (
          <textarea ref={ref} data-testid="custom-textarea" {...props} />
        ));

        renderInput({ textArea: CustomTextArea });

        expect(screen.getByTestId("custom-textarea")).toBeInTheDocument();
      });

      it("custom textArea should receive value and onChange props", () => {
        const onChange = vi.fn();
        const CustomTextArea = React.forwardRef<
          HTMLTextAreaElement,
          React.TextareaHTMLAttributes<HTMLTextAreaElement>
        >((props, ref) => (
          <textarea ref={ref} data-testid="value-check-textarea" {...props} />
        ));

        renderInput({
          textArea: CustomTextArea,
          value: "test value",
          onChange,
        });
        const textarea = screen.getByTestId("value-check-textarea");
        fireEvent.change(textarea, { target: { value: "next" } });

        expect(textarea).toHaveValue("test value");
        expect(onChange).toHaveBeenCalledWith("next");
      });
    });

    describe("sendButton custom component", () => {
      it("should render custom sendButton component", () => {
        const CustomSendButton: React.FC<
          React.ButtonHTMLAttributes<HTMLButtonElement>
        > = ({ onClick, disabled }) => (
          <button
            data-testid="custom-send"
            onClick={onClick}
            disabled={disabled}
          >
            🚀 Send Message
          </button>
        );

        renderInput({ sendButton: CustomSendButton });

        expect(screen.getByTestId("custom-send")).toHaveTextContent(
          "🚀 Send Message",
        );
      });

      it("custom sendButton should receive onClick callback", () => {
        const submitHandler = vi.fn();
        const CustomSendButton: React.FC<
          React.ButtonHTMLAttributes<HTMLButtonElement>
        > = ({ onClick }) => (
          <button data-testid="onclick-send" onClick={onClick}>
            Send
          </button>
        );

        renderInput({
          sendButton: CustomSendButton,
          value: "hello",
          onSubmitMessage: submitHandler,
        });
        fireEvent.click(screen.getByTestId("onclick-send"));

        expect(submitHandler).toHaveBeenCalledWith("hello");
      });
    });

    it.each([
      {
        slot: "startTranscribeButton",
        props: (C: React.FC) => ({
          onStartTranscribe: () => {},
          startTranscribeButton: C,
        }),
      },
      {
        slot: "cancelTranscribeButton",
        props: (C: React.FC) => ({
          ...transcribing,
          cancelTranscribeButton: C,
        }),
      },
      {
        slot: "finishTranscribeButton",
        props: (C: React.FC) => ({
          ...transcribing,
          finishTranscribeButton: C,
        }),
      },
      {
        slot: "addMenuButton",
        props: (C: React.FC) => ({
          toolsMenu: [{ label: "Tool", action: () => {} }],
          addMenuButton: C,
        }),
      },
      {
        slot: "disclaimer",
        props: (C: React.FC) => ({ showDisclaimer: true, disclaimer: C }),
      },
    ] satisfies {
      slot: string;
      props: (C: React.FC) => CopilotChatInputProps;
    }[])("should render custom $slot component", ({ slot, props }) => {
      const Custom: React.FC = () => <span data-testid="custom">{slot}</span>;

      renderInput(props(Custom));

      expect(screen.getByTestId("custom")).toHaveTextContent(slot);
    });

    it("should render custom audioRecorder component", () => {
      const CustomRecorder = React.forwardRef<
        AudioRecorderRef,
        React.HTMLAttributes<HTMLDivElement>
      >(function CustomRecorder(_props, _ref) {
        return <div data-testid="custom-recorder">Custom Recorder</div>;
      });

      renderInput({
        mode: "transcribe",
        onFinishTranscribeWithAudio: async () => {},
        audioRecorder: CustomRecorder,
      });

      expect(screen.getByTestId("custom-recorder")).toHaveTextContent(
        "Custom Recorder",
      );
    });

    it("should render multiple custom components together", () => {
      const CustomTextArea = React.forwardRef<
        HTMLTextAreaElement,
        React.TextareaHTMLAttributes<HTMLTextAreaElement>
      >((props, ref) => (
        <textarea ref={ref} data-testid="multi-textarea" {...props} />
      ));
      const CustomSendButton: React.FC<
        React.ButtonHTMLAttributes<HTMLButtonElement>
      > = (props) => (
        <button data-testid="multi-send" {...props}>
          Send
        </button>
      );

      renderInput({ textArea: CustomTextArea, sendButton: CustomSendButton });

      expect(screen.getByTestId("multi-textarea")).toBeInTheDocument();
      expect(screen.getByTestId("multi-send")).toBeInTheDocument();
    });
  });

  describe("6. Children Render Function", () => {
    it("children render function should receive all slot elements", () => {
      let receivedKeys: string[] = [];

      render(
        <TestWrapper>
          <CopilotChatInput>
            {(slots) => {
              receivedKeys = Object.keys(slots);
              return <div data-testid="slots-check">Rendered</div>;
            }}
          </CopilotChatInput>
        </TestWrapper>,
      );

      expect(receivedKeys).toEqual(
        expect.arrayContaining([
          "textArea",
          "audioRecorder",
          "sendButton",
          "startTranscribeButton",
          "cancelTranscribeButton",
          "finishTranscribeButton",
          "addMenuButton",
          "disclaimer",
        ]),
      );
    });

    it("children render function allows complete layout control", () => {
      render(
        <TestWrapper>
          <CopilotChatInput toolsMenu={[{ label: "Tool", action: () => {} }]}>
            {({ textArea, sendButton, addMenuButton }) => (
              <div>
                <div data-testid="toolbar">{addMenuButton}</div>
                <div data-testid="main">{textArea}</div>
                <div data-testid="actions">{sendButton}</div>
              </div>
            )}
          </CopilotChatInput>
        </TestWrapper>,
      );

      expect(
        within(screen.getByTestId("toolbar")).getByTestId(
          "copilot-add-menu-button",
        ),
      ).toBeInTheDocument();
      expect(
        within(screen.getByTestId("main")).getByTestId("copilot-chat-textarea"),
      ).toBeInTheDocument();
      expect(
        within(screen.getByTestId("actions")).getByTestId(
          "copilot-send-button",
        ),
      ).toBeInTheDocument();
    });
  });

  describe("7. Positioning Prop", () => {
    it("should render static positioning by default", () => {
      const { container } = render(
        <TestWrapper>
          <CopilotChatInput data-testid="input-container" />
        </TestWrapper>,
      );

      // By default (static), should NOT have absolute positioning classes
      const inputContainer = container.querySelector(
        '[data-testid="input-container"]',
      ) as HTMLElement;
      expect(inputContainer).not.toBeNull();
      expect(inputContainer.classList.contains("cpk-chat-input-absolute")).toBe(
        false,
      );
    });

    it("should render absolute positioning when positioning='absolute'", () => {
      const { container } = render(
        <TestWrapper>
          <CopilotChatInput
            positioning="absolute"
            data-testid="absolute-input"
          />
        </TestWrapper>,
      );

      const inputContainer = container.querySelector(
        '[data-testid="absolute-input"]',
      ) as HTMLElement;
      expect(inputContainer).not.toBeNull();
      expect(inputContainer.classList.contains("cpk-chat-input-absolute")).toBe(
        true,
      );
    });

    it("should apply keyboard height transform", () => {
      const { container } = render(
        <TestWrapper>
          <CopilotChatInput
            positioning="absolute"
            keyboardHeight={300}
            data-testid="keyboard-input"
          />
        </TestWrapper>,
      );

      const inputContainer = container.querySelector(
        '[data-testid="keyboard-input"]',
      ) as HTMLElement;
      expect(inputContainer).not.toBeNull();
      expect(inputContainer.style.transform).toBe("translateY(-300px)");
    });

    it("should forward containerRef", () => {
      let containerRef: HTMLDivElement | null = null;
      const RefCapture = () => {
        const ref = React.useRef<HTMLDivElement>(null);
        React.useEffect(() => {
          containerRef = ref.current;
        }, []);
        return (
          <TestWrapper>
            <CopilotChatInput containerRef={ref} />
          </TestWrapper>
        );
      };

      render(<RefCapture />);
      expect(containerRef).not.toBeNull();
    });
  });

  describe("8. Disclaimer Slot", () => {
    it("should render disclaimer when showDisclaimer=true", () => {
      const { container } = renderInput({ showDisclaimer: true });

      expect(
        container.querySelector(".cpk-chat-input-disclaimer"),
      ).toBeInTheDocument();
    });

    it("should hide disclaimer when showDisclaimer=false", () => {
      const { container } = renderInput({ showDisclaimer: false });

      expect(container.querySelector(".cpk-chat-input-disclaimer")).toBeNull();
    });

    it("should show disclaimer by default with absolute positioning", () => {
      const { container } = renderInput({ positioning: "absolute" });

      expect(
        container.querySelector(".cpk-chat-input-disclaimer"),
      ).not.toBeNull();
    });

    it("should hide disclaimer by default with static positioning", () => {
      const { container } = renderInput({ positioning: "static" });

      expect(container.querySelector(".cpk-chat-input-disclaimer")).toBeNull();
    });
  });
});
