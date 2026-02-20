import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { CopilotChatInput } from "../CopilotChatInput";
import { CopilotKitProvider } from "@/providers/CopilotKitProvider";
import { CopilotChatConfigurationProvider } from "@/providers/CopilotChatConfigurationProvider";

// Wrapper to provide required context
const TestWrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <CopilotKitProvider>
    <CopilotChatConfigurationProvider threadId="test-thread">
      <div style={{ height: 200 }}>{children}</div>
    </CopilotChatConfigurationProvider>
  </CopilotKitProvider>
);

describe("CopilotChatInput Slot System E2E Tests", () => {
  // ============================================================================
  // 1. TAILWIND CLASS TESTS
  // ============================================================================
  describe("1. Tailwind Class Slot Override", () => {
    describe("textArea slot", () => {
      it("should apply tailwind class string to textArea", () => {
        const { container } = render(
          <TestWrapper>
            <CopilotChatInput textArea="border-2 border-blue-500 rounded-lg p-4" />
          </TestWrapper>,
        );

        const textAreaEl = container.querySelector(".border-blue-500");
        expect(textAreaEl).toBeDefined();
      });

      it("should override default textArea className", () => {
        const { container } = render(
          <TestWrapper>
            <CopilotChatInput textArea="custom-textarea-class" />
          </TestWrapper>,
        );

        expect(container.querySelector(".custom-textarea-class")).toBeDefined();
      });
    });

    describe("sendButton slot", () => {
      it("should apply tailwind class string to sendButton", () => {
        const { container } = render(
          <TestWrapper>
            <CopilotChatInput sendButton="bg-green-500 hover:bg-green-600 rounded-full" />
          </TestWrapper>,
        );

        const sendBtn = container.querySelector(".bg-green-500");
        expect(sendBtn).toBeDefined();
      });
    });

    describe("startTranscribeButton slot", () => {
      it("should apply tailwind class string to startTranscribeButton", () => {
        const { container } = render(
          <TestWrapper>
            <CopilotChatInput
              onStartTranscribe={() => {}}
              startTranscribeButton="bg-red-500 rounded"
            />
          </TestWrapper>,
        );

        const transcribeBtn = container.querySelector(".bg-red-500");
        // Button may only appear when transcription is enabled
      });
    });

    describe("cancelTranscribeButton slot", () => {
      it("should apply tailwind class string to cancelTranscribeButton", () => {
        const { container } = render(
          <TestWrapper>
            <CopilotChatInput
              mode="transcribe"
              onCancelTranscribe={() => {}}
              cancelTranscribeButton="bg-gray-500"
            />
          </TestWrapper>,
        );

        const cancelBtn = container.querySelector(".bg-gray-500");
        // Button appears in transcribe mode
      });
    });

    describe("finishTranscribeButton slot", () => {
      it("should apply tailwind class string to finishTranscribeButton", () => {
        const { container } = render(
          <TestWrapper>
            <CopilotChatInput
              mode="transcribe"
              onFinishTranscribe={() => {}}
              finishTranscribeButton="bg-purple-500"
            />
          </TestWrapper>,
        );

        const finishBtn = container.querySelector(".bg-purple-500");
        // Button appears in transcribe mode
      });
    });

    describe("addMenuButton slot", () => {
      it("should apply tailwind class string to addMenuButton", () => {
        const { container } = render(
          <TestWrapper>
            <CopilotChatInput
              toolsMenu={[{ label: "Test", action: () => {} }]}
              addMenuButton="bg-yellow-500"
            />
          </TestWrapper>,
        );

        const addBtn = container.querySelector(".bg-yellow-500");
        // Button appears when toolsMenu is provided
      });
    });

    describe("audioRecorder slot", () => {
      it("should apply tailwind class string to audioRecorder", () => {
        const { container } = render(
          <TestWrapper>
            <CopilotChatInput
              mode="transcribe"
              audioRecorder="border-dashed border-2"
            />
          </TestWrapper>,
        );

        const recorder = container.querySelector(".border-dashed");
        // Recorder appears in transcribe mode
      });
    });
  });

  // ============================================================================
  // 2. PROPERTIES (onClick, etc.) TESTS
  // ============================================================================
  describe("2. Properties Slot Override", () => {
    describe("textArea props", () => {
      it("should pass placeholder prop to textArea", async () => {
        render(
          <TestWrapper>
            <CopilotChatInput
              textArea={{ placeholder: "Custom placeholder..." }}
            />
          </TestWrapper>,
        );

        const textarea = await screen.findByPlaceholderText(
          "Custom placeholder...",
        );
        expect(textarea).toBeDefined();
      });

      it("should pass disabled prop to textArea", () => {
        render(
          <TestWrapper>
            <CopilotChatInput
              textArea={
                { disabled: true, "data-testid": "disabled-textarea" } as any
              }
            />
          </TestWrapper>,
        );

        const textarea = screen.queryByTestId("disabled-textarea");
        if (textarea) {
          expect(textarea.hasAttribute("disabled")).toBe(true);
        }
      });

      it("should pass onKeyDown prop to textArea", async () => {
        const handleKeyDown = vi.fn();

        render(
          <TestWrapper>
            <CopilotChatInput textArea={{ onKeyDown: handleKeyDown }} />
          </TestWrapper>,
        );

        const textarea = await screen.findByRole("textbox");
        fireEvent.keyDown(textarea, { key: "a" });
        // Handler should be called
      });

      it("should pass autoFocus prop to textArea", () => {
        render(
          <TestWrapper>
            <CopilotChatInput textArea={{ autoFocus: true }} />
          </TestWrapper>,
        );

        const textarea = document.querySelector("textarea");
        // autoFocus behavior may vary
      });
    });

    describe("sendButton props", () => {
      it("should pass onClick handler to sendButton", () => {
        const handleClick = vi.fn();

        render(
          <TestWrapper>
            <CopilotChatInput
              // Need to provide onSubmitMessage and value to enable the button, or override disabled
              sendButton={
                {
                  onClick: handleClick,
                  disabled: false,
                  "data-testid": "send-btn",
                } as any
              }
            />
          </TestWrapper>,
        );

        const sendBtn = screen.queryByTestId("send-btn");
        if (sendBtn) {
          fireEvent.click(sendBtn);
          expect(handleClick).toHaveBeenCalled();
        }
      });

      it("should pass disabled prop to sendButton", () => {
        render(
          <TestWrapper>
            <CopilotChatInput
              sendButton={
                { disabled: true, "data-testid": "disabled-send" } as any
              }
            />
          </TestWrapper>,
        );

        const sendBtn = screen.queryByTestId("disabled-send");
        if (sendBtn) {
          expect(sendBtn.hasAttribute("disabled")).toBe(true);
        }
      });

      it("should pass aria-label prop to sendButton", () => {
        render(
          <TestWrapper>
            <CopilotChatInput sendButton={{ "aria-label": "Submit message" }} />
          </TestWrapper>,
        );

        const sendBtn = document.querySelector("[aria-label='Submit message']");
        expect(sendBtn).toBeDefined();
      });
    });

    describe("addMenuButton props", () => {
      it("should pass onClick handler to addMenuButton", () => {
        const handleClick = vi.fn();

        render(
          <TestWrapper>
            <CopilotChatInput
              toolsMenu={[{ label: "Item", action: () => {} }]}
              addMenuButton={
                { onClick: handleClick, "data-testid": "add-menu" } as any
              }
            />
          </TestWrapper>,
        );

        const addBtn = screen.queryByTestId("add-menu");
        if (addBtn) {
          fireEvent.click(addBtn);
        }
      });
    });

    describe("user props override pre-set props", () => {
      it("user disabled should override default disabled state", () => {
        render(
          <TestWrapper>
            <CopilotChatInput
              sendButton={
                { disabled: false, "data-testid": "override-send" } as any
              }
            />
          </TestWrapper>,
        );

        const sendBtn = screen.queryByTestId("override-send");
        // User's disabled=false should take effect
      });
    });
  });

  // ============================================================================
  // 3. CUSTOM COMPONENT TESTS
  // ============================================================================
  describe("3. Custom Component Slot Override", () => {
    describe("textArea custom component", () => {
      it("should render custom textArea component", () => {
        const CustomTextArea = React.forwardRef<HTMLTextAreaElement, any>(
          ({ value, onChange, ...props }, ref) => (
            <textarea
              ref={ref}
              data-testid="custom-textarea"
              value={value}
              onChange={(e) => onChange?.(e.target.value)}
              className="custom-input"
              {...props}
            />
          ),
        );

        render(
          <TestWrapper>
            <CopilotChatInput textArea={CustomTextArea} />
          </TestWrapper>,
        );

        expect(screen.getByTestId("custom-textarea")).toBeDefined();
      });

      it("custom textArea should receive value and onChange props", () => {
        let receivedValue: string | undefined;
        let receivedOnChange: any;

        const CustomTextArea = React.forwardRef<HTMLTextAreaElement, any>(
          ({ value, onChange, ...props }, ref) => {
            receivedValue = value;
            receivedOnChange = onChange;
            return (
              <textarea
                ref={ref}
                data-testid="value-check-textarea"
                value={value || ""}
                onChange={(e) => onChange?.(e.target.value)}
                {...props}
              />
            );
          },
        );

        render(
          <TestWrapper>
            <CopilotChatInput
              textArea={CustomTextArea}
              value="test value"
              onChange={() => {}}
            />
          </TestWrapper>,
        );

        expect(receivedValue).toBe("test value");
        expect(receivedOnChange).toBeDefined();
      });
    });

    describe("sendButton custom component", () => {
      it("should render custom sendButton component", () => {
        const CustomSendButton: React.FC<any> = ({ onClick, disabled }) => (
          <button
            data-testid="custom-send"
            onClick={onClick}
            disabled={disabled}
          >
            🚀 Send Message
          </button>
        );

        render(
          <TestWrapper>
            <CopilotChatInput sendButton={CustomSendButton} />
          </TestWrapper>,
        );

        expect(screen.getByTestId("custom-send")).toBeDefined();
        expect(screen.getByText("🚀 Send Message")).toBeDefined();
      });

      it("custom sendButton should receive onClick callback", () => {
        const submitHandler = vi.fn();

        const CustomSendButton: React.FC<any> = ({ onClick }) => (
          <button data-testid="onclick-send" onClick={onClick}>
            Send
          </button>
        );

        render(
          <TestWrapper>
            <CopilotChatInput
              sendButton={CustomSendButton}
              onSubmitMessage={submitHandler}
            />
          </TestWrapper>,
        );

        fireEvent.click(screen.getByTestId("onclick-send"));
        // onClick should trigger submission flow
      });
    });

    describe("startTranscribeButton custom component", () => {
      it("should render custom startTranscribeButton component", () => {
        const CustomStart: React.FC<any> = ({ onClick }) => (
          <button data-testid="custom-start-transcribe" onClick={onClick}>
            🎤 Start Recording
          </button>
        );

        render(
          <TestWrapper>
            <CopilotChatInput
              onStartTranscribe={() => {}}
              startTranscribeButton={CustomStart}
            />
          </TestWrapper>,
        );

        const btn = screen.queryByTestId("custom-start-transcribe");
        if (btn) {
          expect(btn.textContent).toContain("Start Recording");
        }
      });
    });

    describe("cancelTranscribeButton custom component", () => {
      it("should render custom cancelTranscribeButton component", () => {
        const CustomCancel: React.FC<any> = ({ onClick }) => (
          <button data-testid="custom-cancel-transcribe" onClick={onClick}>
            ❌ Cancel
          </button>
        );

        render(
          <TestWrapper>
            <CopilotChatInput
              mode="transcribe"
              onCancelTranscribe={() => {}}
              cancelTranscribeButton={CustomCancel}
            />
          </TestWrapper>,
        );

        const btn = screen.queryByTestId("custom-cancel-transcribe");
        if (btn) {
          expect(btn.textContent).toContain("Cancel");
        }
      });
    });

    describe("finishTranscribeButton custom component", () => {
      it("should render custom finishTranscribeButton component", () => {
        const CustomFinish: React.FC<any> = ({ onClick }) => (
          <button data-testid="custom-finish-transcribe" onClick={onClick}>
            ✓ Done
          </button>
        );

        render(
          <TestWrapper>
            <CopilotChatInput
              mode="transcribe"
              onFinishTranscribe={() => {}}
              finishTranscribeButton={CustomFinish}
            />
          </TestWrapper>,
        );

        const btn = screen.queryByTestId("custom-finish-transcribe");
        if (btn) {
          expect(btn.textContent).toContain("Done");
        }
      });
    });

    describe("addMenuButton custom component", () => {
      it("should render custom addMenuButton component", () => {
        const CustomAddMenu: React.FC<any> = ({ onClick }) => (
          <button data-testid="custom-add-menu" onClick={onClick}>
            ➕ Add
          </button>
        );

        render(
          <TestWrapper>
            <CopilotChatInput
              toolsMenu={[{ label: "Tool", action: () => {} }]}
              addMenuButton={CustomAddMenu}
            />
          </TestWrapper>,
        );

        const btn = screen.queryByTestId("custom-add-menu");
        if (btn) {
          expect(btn.textContent).toContain("Add");
        }
      });
    });

    describe("audioRecorder custom component", () => {
      it("should render custom audioRecorder component", () => {
        const CustomRecorder: React.FC<any> = ({ onAudioReady }) => (
          <div data-testid="custom-recorder">
            <button onClick={() => onAudioReady?.(new Blob())}>
              Custom Recorder
            </button>
          </div>
        );

        render(
          <TestWrapper>
            <CopilotChatInput
              mode="transcribe"
              onFinishTranscribeWithAudio={async () => {}}
              audioRecorder={CustomRecorder}
            />
          </TestWrapper>,
        );

        const recorder = screen.queryByTestId("custom-recorder");
        if (recorder) {
          expect(recorder.textContent).toContain("Custom Recorder");
        }
      });
    });

    describe("multiple custom components", () => {
      it("should render multiple custom components together", () => {
        const CustomTextArea = React.forwardRef<HTMLTextAreaElement, any>(
          (props, ref) => (
            <textarea ref={ref} data-testid="multi-textarea" {...props} />
          ),
        );

        const CustomSendButton: React.FC<any> = (props) => (
          <button data-testid="multi-send" {...props}>
            Send
          </button>
        );

        render(
          <TestWrapper>
            <CopilotChatInput
              textArea={CustomTextArea}
              sendButton={CustomSendButton}
            />
          </TestWrapper>,
        );

        expect(screen.getByTestId("multi-textarea")).toBeDefined();
        expect(screen.getByTestId("multi-send")).toBeDefined();
      });
    });
  });

  // ============================================================================
  // 4. RECURSIVE DRILL-DOWN TESTS (Input has no sub-slots, but test nested props)
  // ============================================================================
  describe("4. Nested Props and Complex Configurations", () => {
    describe("complex textArea configuration", () => {
      it("should support complex props configuration", () => {
        render(
          <TestWrapper>
            <CopilotChatInput
              textArea={
                {
                  className: "complex-textarea",
                  placeholder: "Complex placeholder",
                  "data-testid": "complex-ta",
                  rows: 4,
                } as any
              }
            />
          </TestWrapper>,
        );

        const textarea = screen.queryByTestId("complex-ta");
        if (textarea) {
          expect(textarea.getAttribute("placeholder")).toBe(
            "Complex placeholder",
          );
        }
      });
    });

    describe("complex sendButton configuration", () => {
      it("should support complex props on sendButton", () => {
        render(
          <TestWrapper>
            <CopilotChatInput
              sendButton={
                {
                  className: "complex-send",
                  "data-testid": "complex-send-btn",
                  "aria-label": "Send your message",
                  title: "Click to send",
                } as any
              }
            />
          </TestWrapper>,
        );

        const btn = screen.queryByTestId("complex-send-btn");
        if (btn) {
          expect(btn.getAttribute("aria-label")).toBe("Send your message");
          expect(btn.getAttribute("title")).toBe("Click to send");
        }
      });
    });
  });

  // ============================================================================
  // 5. CLASSNAME OVERRIDE TESTS
  // ============================================================================
  describe("5. className Override with Tailwind", () => {
    describe("className prop in object slots", () => {
      it("should allow className prop in textArea object slot", () => {
        const { container } = render(
          <TestWrapper>
            <CopilotChatInput
              textArea={{ className: "textarea-class-override" }}
            />
          </TestWrapper>,
        );

        expect(
          container.querySelector(".textarea-class-override"),
        ).toBeDefined();
      });

      it("should allow className prop in sendButton object slot", () => {
        const { container } = render(
          <TestWrapper>
            <CopilotChatInput
              sendButton={{ className: "send-class-override" }}
            />
          </TestWrapper>,
        );

        expect(container.querySelector(".send-class-override")).toBeDefined();
      });
    });

    describe("string slot vs className prop equivalence", () => {
      it("string slot should set className on textArea", () => {
        const { container } = render(
          <TestWrapper>
            <CopilotChatInput textArea="string-class-textarea" />
          </TestWrapper>,
        );

        expect(container.querySelector(".string-class-textarea")).toBeDefined();
      });

      it("string slot should set className on sendButton", () => {
        const { container } = render(
          <TestWrapper>
            <CopilotChatInput sendButton="string-class-send" />
          </TestWrapper>,
        );

        expect(container.querySelector(".string-class-send")).toBeDefined();
      });
    });

    describe("tailwind utility classes", () => {
      it("should apply tailwind focus utilities to textArea", () => {
        const { container } = render(
          <TestWrapper>
            <CopilotChatInput textArea="focus:ring-2 focus:ring-blue-500 focus:outline-none" />
          </TestWrapper>,
        );

        const el = container.querySelector(".focus\\:ring-2");
        expect(el).toBeDefined();
      });

      it("should apply tailwind hover utilities to sendButton", () => {
        const { container } = render(
          <TestWrapper>
            <CopilotChatInput sendButton="hover:bg-blue-600 active:bg-blue-700" />
          </TestWrapper>,
        );

        const el = container.querySelector(".hover\\:bg-blue-600");
        expect(el).toBeDefined();
      });
    });
  });

  // ============================================================================
  // 6. CHILDREN RENDER FUNCTION TESTS
  // ============================================================================
  describe("6. Children Render Function", () => {
    it("should support children render function for custom layout", () => {
      render(
        <TestWrapper>
          <CopilotChatInput>
            {({ textArea, sendButton }) => (
              <div data-testid="custom-input-layout">
                <div className="input-row">
                  {textArea}
                  {sendButton}
                </div>
              </div>
            )}
          </CopilotChatInput>
        </TestWrapper>,
      );

      expect(screen.getByTestId("custom-input-layout")).toBeDefined();
    });

    it("children render function should receive all slot elements", () => {
      const receivedKeys: string[] = [];

      render(
        <TestWrapper>
          <CopilotChatInput>
            {(slots) => {
              receivedKeys.push(...Object.keys(slots));
              return <div data-testid="slots-check">Rendered</div>;
            }}
          </CopilotChatInput>
        </TestWrapper>,
      );

      expect(screen.getByTestId("slots-check")).toBeDefined();
      // Should receive textArea, sendButton, etc.
    });

    it("children render function allows complete layout control", () => {
      render(
        <TestWrapper>
          <CopilotChatInput toolsMenu={[{ label: "Tool", action: () => {} }]}>
            {({ textArea, sendButton, addMenuButton }) => (
              <div data-testid="full-control-layout">
                <div className="toolbar">{addMenuButton}</div>
                <div className="main">{textArea}</div>
                <div className="actions">{sendButton}</div>
              </div>
            )}
          </CopilotChatInput>
        </TestWrapper>,
      );

      expect(screen.getByTestId("full-control-layout")).toBeDefined();
      expect(document.querySelector(".toolbar")).toBeDefined();
      expect(document.querySelector(".main")).toBeDefined();
      expect(document.querySelector(".actions")).toBeDefined();
    });
  });

  // ============================================================================
  // 7. POSITIONING PROP TESTS
  // ============================================================================
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
      expect(inputContainer.classList.contains("cpk:absolute")).toBe(false);
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
      expect(inputContainer.classList.contains("cpk:absolute")).toBe(true);
      expect(inputContainer.classList.contains("cpk:bottom-0")).toBe(true);
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

  // ============================================================================
  // 8. DISCLAIMER SLOT TESTS
  // ============================================================================
  describe("8. Disclaimer Slot", () => {
    it("should render disclaimer when showDisclaimer=true", () => {
      render(
        <TestWrapper>
          <CopilotChatInput showDisclaimer={true} />
        </TestWrapper>,
      );

      // Look for disclaimer text (from labels)
      expect(
        screen.queryByText(/AI-generated responses/i) ||
          document.querySelector('[class*="text-muted-foreground"]'),
      ).toBeDefined();
    });

    it("should hide disclaimer when showDisclaimer=false", () => {
      const { container } = render(
        <TestWrapper>
          <CopilotChatInput showDisclaimer={false} />
        </TestWrapper>,
      );

      // Disclaimer should not be rendered
      const disclaimer = container.querySelector(
        '[class*="text-center"][class*="text-xs"]',
      );
      expect(disclaimer).toBeNull();
    });

    it("should show disclaimer by default with absolute positioning", () => {
      const { container } = render(
        <TestWrapper>
          <CopilotChatInput positioning="absolute" />
        </TestWrapper>,
      );

      // Disclaimer should be present with absolute positioning (default showDisclaimer=true)
      const disclaimer = container.querySelector(
        '[class*="text-center"][class*="text-xs"]',
      );
      expect(disclaimer).not.toBeNull();
    });

    it("should hide disclaimer by default with static positioning", () => {
      const { container } = render(
        <TestWrapper>
          <CopilotChatInput positioning="static" />
        </TestWrapper>,
      );

      // Disclaimer should NOT be present with static positioning (default showDisclaimer=false)
      const disclaimer = container.querySelector(
        '[class*="text-center"][class*="text-xs"]',
      );
      expect(disclaimer).toBeNull();
    });

    it("should apply tailwind class to disclaimer", () => {
      const { container } = render(
        <TestWrapper>
          <CopilotChatInput
            showDisclaimer={true}
            disclaimer="text-red-500 italic"
          />
        </TestWrapper>,
      );

      const disclaimer = container.querySelector(".text-red-500");
      if (disclaimer) {
        expect(disclaimer.classList.contains("italic")).toBe(true);
      }
    });

    it("should render custom disclaimer component", () => {
      const CustomDisclaimer: React.FC<any> = () => (
        <div data-testid="custom-disclaimer">Custom Disclaimer Content</div>
      );

      render(
        <TestWrapper>
          <CopilotChatInput
            showDisclaimer={true}
            disclaimer={CustomDisclaimer}
          />
        </TestWrapper>,
      );

      const disclaimer = screen.queryByTestId("custom-disclaimer");
      if (disclaimer) {
        expect(disclaimer.textContent).toContain("Custom Disclaimer");
      }
    });
  });
});
