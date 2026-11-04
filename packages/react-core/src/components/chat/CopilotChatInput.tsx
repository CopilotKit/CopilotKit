import type { KeyboardEvent, ChangeEvent } from "react";
import React, {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  forwardRef,
  useImperativeHandle,
  useCallback,
  useMemo,
  useSyncExternalStore,
} from "react";
import { CopilotIcon } from "../icons/CopilotIcon";

import {
  CopilotChatDefaultLabels,
  ɵComposerController,
  ɵcomposerButtonState,
  ɵcreateComposerAutosize,
  ɵnormalizeToolsMenu,
  ɵshowsComposerDisclaimer,
  ɵsyncRecorderToMode,
} from "@copilotkit/core";
import type { CopilotChatLabels } from "@copilotkit/core";
import { useCopilotChatConfiguration } from "../../providers/CopilotChatConfigurationProvider";
import { Button } from "../../components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "../../components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuSeparator,
} from "../../components/ui/dropdown-menu";

import { CopilotChatAudioRecorder } from "./CopilotChatAudioRecorder";
import type { WithSlots } from "../../lib/slots";
import { renderSlot } from "../../lib/slots";
import { cn } from "../../lib/utils";

export type CopilotChatInputMode = "input" | "transcribe" | "processing";

export type ToolsMenuItem = {
  label: string;
} & (
  | {
      action: () => void;
      items?: never;
    }
  | {
      action?: never;
      items: (ToolsMenuItem | "-")[];
    }
);

type CopilotChatInputSlots = {
  textArea: typeof CopilotChatInput.TextArea;
  sendButton: typeof CopilotChatInput.SendButton;
  startTranscribeButton: typeof CopilotChatInput.StartTranscribeButton;
  cancelTranscribeButton: typeof CopilotChatInput.CancelTranscribeButton;
  finishTranscribeButton: typeof CopilotChatInput.FinishTranscribeButton;
  addMenuButton: typeof CopilotChatInput.AddMenuButton;
  audioRecorder: typeof CopilotChatAudioRecorder;
  disclaimer: typeof CopilotChatInput.Disclaimer;
};

type CopilotChatInputRestProps = {
  mode?: CopilotChatInputMode;
  toolsMenu?: (ToolsMenuItem | "-")[];
  autoFocus?: boolean;
  onSubmitMessage?: (value: string) => void;
  onStop?: () => void;
  isRunning?: boolean;
  onStartTranscribe?: () => void;
  onCancelTranscribe?: () => void;
  onFinishTranscribe?: () => void;
  onFinishTranscribeWithAudio?: (audioBlob: Blob) => Promise<void>;
  onAddFile?: () => void;
  value?: string;
  onChange?: (value: string) => void;
  /** Positioning mode for the input container. Default: 'static' */
  positioning?: "static" | "absolute";
  /** Keyboard height in pixels for mobile keyboard handling */
  keyboardHeight?: number;
  /** Ref for the outer positioning container */
  containerRef?: React.Ref<HTMLDivElement>;
  /** Whether to show the disclaimer. Default: true for absolute positioning, false for static */
  showDisclaimer?: boolean;
  /**
   * Set to `true` when the input sits at the bottom of its container as a
   * flex-last-child (visible position is driven by layout, not CSS
   * positioning). Triggers reservation of bottom space for the fixed
   * CopilotKit license banner via the
   * `--copilotkit-license-banner-offset` CSS var so the two don't overlap.
   *
   * Not needed when `positioning === "absolute"`; that mode already pins the
   * input to the bottom and picks up the same reservation automatically.
   * Leave unset (default `false`) for inputs rendered mid-layout such as the
   * welcome screen, where the banner offset would push the input off-center.
   */
  bottomAnchored?: boolean;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "onChange">;

type CopilotChatInputBaseProps = WithSlots<
  CopilotChatInputSlots,
  CopilotChatInputRestProps
>;

type CopilotChatInputChildrenArgs = CopilotChatInputBaseProps extends {
  children?: infer C;
}
  ? C extends (props: infer P) => React.ReactNode
    ? P
    : never
  : never;

export type CopilotChatInputProps = Omit<
  CopilotChatInputBaseProps,
  "children"
> & {
  children?: (props: CopilotChatInputChildrenArgs) => React.ReactNode;
};

const SLASH_MENU_MAX_VISIBLE_ITEMS = 5;
const SLASH_MENU_ITEM_HEIGHT_PX = 40;

/**
 * The chat composer: a text area with the add-menu, voice and send/stop
 * buttons, and a slash-command menu that lists `toolsMenu` items once the text
 * starts with "/".
 */
export function CopilotChatInput({
  mode = "input",
  onSubmitMessage,
  onStop,
  isRunning = false,
  onStartTranscribe,
  onCancelTranscribe,
  onFinishTranscribe,
  onFinishTranscribeWithAudio,
  onAddFile,
  onChange,
  value,
  toolsMenu,
  autoFocus = false,
  positioning = "static",
  keyboardHeight = 0,
  containerRef,
  showDisclaimer,
  bottomAnchored = false,
  textArea,
  sendButton,
  startTranscribeButton,
  cancelTranscribeButton,
  finishTranscribeButton,
  addMenuButton,
  audioRecorder,
  disclaimer,
  children,
  className,
  ...props
}: CopilotChatInputProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const addButtonContainerRef = useRef<HTMLDivElement>(null);
  const actionsContainerRef = useRef<HTMLDivElement>(null);
  const audioRecorderRef =
    useRef<React.ElementRef<typeof CopilotChatAudioRecorder>>(null);
  const slashMenuRef = useRef<HTMLDivElement>(null);
  const config = useCopilotChatConfiguration();
  const labels = config?.labels ?? CopilotChatDefaultLabels;

  // Sizes the text box and picks the compact or expanded layout.
  const [autosize] = useState(() =>
    ɵcreateComposerAutosize({
      getElements: () => ({
        textarea: inputRef.current,
        grid: gridRef.current,
        start: addButtonContainerRef.current,
        actions: actionsContainerRef.current,
      }),
    }),
  );
  const layout = useSyncExternalStore(
    autosize.subscribe,
    autosize.getSnapshot,
    autosize.getSnapshot,
  );
  const isExpanded = mode === "input" && layout === "expanded";

  const previousModalStateRef = useRef<boolean | undefined>(undefined);

  // The text, controlled or not, and the slash-command menu: see core's
  // ɵComposerController.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [composer] = useState(
    () =>
      new ɵComposerController<ToolsMenuItem>({
        initialValue: value ?? "",
        onChange: (next) => onChangeRef.current?.(next),
      }),
  );
  const {
    value: composerValue,
    slashQuery: commandQuery,
    slashCommands: filteredCommands,
    slashHighlightIndex,
  } = useSyncExternalStore(
    composer.subscribe,
    composer.getSnapshot,
    composer.getSnapshot,
  );
  // A controlled value renders at once; the controller catches up below.
  const resolvedValue = value ?? composerValue;

  const menu = useMemo(
    () =>
      ɵnormalizeToolsMenu<ToolsMenuItem>(
        toolsMenu,
        onAddFile
          ? { label: labels.chatInputToolbarAddButtonLabel, action: onAddFile }
          : undefined,
      ),
    [labels.chatInputToolbarAddButtonLabel, onAddFile, toolsMenu],
  );
  useLayoutEffect(() => {
    composer.setInputs({ value, mode, menu });
  }, [composer, value, mode, menu]);

  useEffect(() => {
    if (!autoFocus) {
      previousModalStateRef.current = config?.isModalOpen;
      return;
    }

    if (config?.isModalOpen && !previousModalStateRef.current) {
      inputRef.current?.focus({ preventScroll: true });
    }

    previousModalStateRef.current = config?.isModalOpen;
  }, [config?.isModalOpen, autoFocus]);

  // Recording follows the mode: it starts in transcribe mode and stops
  // when the mode changes.
  useEffect(() => {
    void ɵsyncRecorderToMode(audioRecorderRef.current, mode);
  }, [mode]);

  // Handlers
  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    composer.setValue(e.target.value);
  };

  const runCommand = useCallback(
    (item: ToolsMenuItem) => {
      composer.runCommand(item);
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    },
    [composer],
  );

  const composerInput = {
    mode,
    isRunning,
    value: resolvedValue,
    canSubmit: !!onSubmitMessage,
    canStop: !!onStop,
  };
  const {
    isProcessing,
    action: buttonAction,
    disabled: buttonDisabled,
  } = ɵcomposerButtonState(composerInput);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Text in the composer means send, even while a run is in flight: after
    // picking one interrupt's option the resume run still streams when the
    // user types the next prompt, and stopping it would lose the next
    // interrupt. Enter stops the run only when the composer is empty.
    const { preventDefault, action } = composer.keyDown(
      {
        key: e.key,
        shiftKey: e.shiftKey,
        isComposing: e.nativeEvent.isComposing,
        keyCode: e.keyCode,
      },
      composerInput,
    );
    if (preventDefault) e.preventDefault();
    if (action === "command") {
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    } else if (action === "stop") {
      onStop?.();
    } else if (action === "send") {
      send();
    }
  };

  const send = () => {
    if (!onSubmitMessage) {
      return;
    }
    // Always clears the input after sending, also when controlled:
    // onChange("") tells the parent to reset its state.
    const sent = composer.submit(onSubmitMessage, { value: resolvedValue });
    if (sent) inputRef.current?.focus();
  };

  const BoundTextArea = renderSlot(textArea, CopilotChatInput.TextArea, {
    ref: inputRef,
    value: resolvedValue,
    onChange: handleChange,
    onKeyDown: handleKeyDown,
    autoFocus: autoFocus,
    className: isExpanded
      ? "cpk-chat-input-textarea-expanded"
      : "cpk-chat-input-textarea-compact",
  });

  const handleSendButtonClick = () => {
    // The send/stop button is an explicit control: when a run is in flight it
    // renders as a Stop (Square) button, so a click maps to stop regardless of
    // composer contents. The Enter key behaves differently (see handleKeyDown):
    // a non-empty composer + Enter sends a new message rather than stopping.
    if (isProcessing) {
      onStop?.();
      return;
    }
    send();
  };

  const BoundAudioRecorder = renderSlot(
    audioRecorder,
    CopilotChatAudioRecorder,
    {
      ref: audioRecorderRef,
    },
  );

  const showsStop = buttonAction === "stop";
  const BoundSendButton = renderSlot(sendButton, CopilotChatInput.SendButton, {
    onClick: handleSendButtonClick,
    disabled: buttonDisabled,
    "aria-label": showsStop
      ? labels.chatInputToolbarStopButtonLabel
      : labels.chatInputToolbarSendButtonLabel,
    children: showsStop ? (
      <CopilotIcon name="Square" className="cpk-chat-input-stop-icon" />
    ) : undefined,
  });

  const BoundStartTranscribeButton = renderSlot(
    startTranscribeButton,
    CopilotChatInput.StartTranscribeButton,
    {
      onClick: onStartTranscribe,
    },
  );

  const BoundCancelTranscribeButton = renderSlot(
    cancelTranscribeButton,
    CopilotChatInput.CancelTranscribeButton,
    {
      onClick: onCancelTranscribe,
    },
  );

  // Handler for finish button - stops recording and passes audio blob
  const handleFinishTranscribe = useCallback(async () => {
    const recorder = audioRecorderRef.current;
    if (recorder && recorder.state === "recording") {
      try {
        const audioBlob = await recorder.stop();
        if (onFinishTranscribeWithAudio) {
          await onFinishTranscribeWithAudio(audioBlob);
        }
      } catch (error) {
        console.error("Failed to stop recording:", error);
      }
    }
    // Always call the original handler to reset mode
    onFinishTranscribe?.();
  }, [onFinishTranscribe, onFinishTranscribeWithAudio]);

  const BoundFinishTranscribeButton = renderSlot(
    finishTranscribeButton,
    CopilotChatInput.FinishTranscribeButton,
    {
      onClick: handleFinishTranscribe,
    },
  );

  const BoundAddMenuButton = renderSlot(
    addMenuButton,
    CopilotChatInput.AddMenuButton,
    {
      disabled: mode === "transcribe",
      onAddFile,
      toolsMenu,
    },
  );

  const BoundDisclaimer = renderSlot(
    disclaimer,
    CopilotChatInput.Disclaimer,
    {},
  );

  const shouldShowDisclaimer = ɵshowsComposerDisclaimer({
    showDisclaimer,
    positioning,
  });

  const handleContainerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Don't focus if clicking on buttons or other interactive elements
    const target = e.target as HTMLElement;
    if (
      target.tagName !== "BUTTON" &&
      !target.closest("button") &&
      inputRef.current &&
      mode === "input"
    ) {
      inputRef.current.focus();
    }
  };

  useLayoutEffect(() => {
    autosize.evaluate(resolvedValue, mode);
  }, [autosize, resolvedValue, mode]);

  useEffect(() => () => autosize.dispose(), [autosize]);

  const slashMenuVisible = commandQuery !== null;

  useEffect(() => {
    if (!slashMenuVisible || slashHighlightIndex < 0) {
      return;
    }

    const active = slashMenuRef.current?.querySelector<HTMLElement>(
      `[data-slash-index="${slashHighlightIndex}"]`,
    );
    active?.scrollIntoView({ block: "nearest" });
  }, [slashMenuVisible, slashHighlightIndex]);

  const slashMenu = slashMenuVisible ? (
    <div
      data-testid="copilot-slash-menu"
      role="listbox"
      aria-label={labels.chatInputSlashMenuLabel}
      ref={slashMenuRef}
      className="cpk-chat-input-slash-menu"
      style={{
        maxHeight: `${SLASH_MENU_MAX_VISIBLE_ITEMS * SLASH_MENU_ITEM_HEIGHT_PX}px`,
      }}
    >
      {filteredCommands.length === 0 ? (
        <div className="cpk-chat-input-slash-menu-empty">
          {labels.chatInputSlashMenuEmptyText}
        </div>
      ) : (
        filteredCommands.map((item, index) => {
          const isActive = index === slashHighlightIndex;
          return (
            <button
              key={`${item.label}-${index}`}
              type="button"
              role="option"
              aria-selected={isActive}
              data-active={isActive ? "true" : undefined}
              data-slash-index={index}
              className="cpk-chat-input-slash-menu-item"
              onMouseEnter={() => composer.highlight(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                runCommand(item);
              }}
            >
              {item.label}
            </button>
          );
        })
      )}
    </div>
  ) : null;

  // The input pill (inner component)
  const inputPill = (
    <div
      data-testid="copilot-chat-input"
      // copilotKitInput: V1 compatibility class for custom styling
      className="copilotKitInput cpk-chat-input-pill"
      onClick={handleContainerClick}
      data-layout={isExpanded ? "expanded" : "compact"}
    >
      <div
        ref={gridRef}
        className="cpk-chat-input-grid"
        data-layout={isExpanded ? "expanded" : "compact"}
      >
        <div ref={addButtonContainerRef} className="cpk-chat-input-start">
          {BoundAddMenuButton}
        </div>
        <div className="cpk-chat-input-field">
          {mode === "transcribe" ? (
            BoundAudioRecorder
          ) : mode === "processing" ? (
            <div className="cpk-chat-input-processing">
              <CopilotIcon
                name="Loader2"
                className="cpk-chat-input-processing-spinner"
              />
            </div>
          ) : (
            <>
              {BoundTextArea}
              {slashMenu}
            </>
          )}
        </div>
        <div ref={actionsContainerRef} className="cpk-chat-input-actions">
          {mode === "transcribe" ? (
            <>
              {onCancelTranscribe && BoundCancelTranscribeButton}
              {onFinishTranscribe && BoundFinishTranscribeButton}
            </>
          ) : (
            <>
              {onStartTranscribe && BoundStartTranscribeButton}
              {BoundSendButton}
            </>
          )}
        </div>
      </div>
    </div>
  );

  // A custom layout takes over the markup only. It returns after every hook
  // above, so the textarea keeps its measuring and auto-grow.
  if (children) {
    const childProps = {
      textArea: BoundTextArea,
      audioRecorder: BoundAudioRecorder,
      sendButton: BoundSendButton,
      startTranscribeButton: BoundStartTranscribeButton,
      cancelTranscribeButton: BoundCancelTranscribeButton,
      finishTranscribeButton: BoundFinishTranscribeButton,
      addMenuButton: BoundAddMenuButton,
      disclaimer: BoundDisclaimer,
      onSubmitMessage,
      onStop,
      isRunning,
      onStartTranscribe,
      onCancelTranscribe,
      onFinishTranscribe,
      onAddFile,
      mode,
      toolsMenu,
      autoFocus,
      positioning,
      keyboardHeight,
      showDisclaimer: shouldShowDisclaimer,
      containerRef,
    } as CopilotChatInputChildrenArgs;

    return (
      <div data-copilotkit style={{ display: "contents" }}>
        {children(childProps)}
      </div>
    );
  }

  return (
    <div
      data-copilotkit
      ref={containerRef}
      className={cn(
        "cpk-chat-input",
        positioning === "absolute" && "cpk-chat-input-absolute",
        className,
      )}
      style={{
        transform:
          keyboardHeight > 0 ? `translateY(-${keyboardHeight}px)` : undefined,
        transition: "transform 0.2s ease-out",
        // Reserve room when the fixed license banner is visible so it doesn't
        // overlap the input. Applied only for bottom-anchored inputs (either
        // `positioning === "absolute"`, or an explicitly-flagged flex-last-child
        // input in run state). The welcome-screen input sits mid-layout and
        // must stay still when the banner is present.
        ...(positioning === "absolute" || bottomAnchored
          ? { paddingBottom: "var(--copilotkit-license-banner-offset, 0px)" }
          : {}),
      }}
      {...props}
    >
      <div className="cpk-chat-input-wrapper">{inputPill}</div>
      {shouldShowDisclaimer && BoundDisclaimer}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace CopilotChatInput {
  /**
   * The icon-only send button. Its accessible name is
   * `labels.chatInputToolbarSendButtonLabel` unless an `aria-label` is passed;
   * the input passes `labels.chatInputToolbarStopButtonLabel` while the button
   * stops a run.
   */
  export const SendButton: React.FC<
    React.ButtonHTMLAttributes<HTMLButtonElement>
  > = ({ className, children, ...props }) => {
    const config = useCopilotChatConfiguration();
    const labels = config?.labels ?? CopilotChatDefaultLabels;
    return (
      <div className="cpk-chat-input-send">
        <Button
          type="button"
          data-testid="copilot-send-button"
          variant="chatInputToolbarPrimary"
          size="chatInputToolbarIcon"
          className={cn("cpk-chat-input-send-button", className)}
          aria-label={labels.chatInputToolbarSendButtonLabel}
          {...props}
        >
          {children ?? (
            <CopilotIcon name="ArrowUp" className="cpk-chat-input-send-icon" />
          )}
        </Button>
      </div>
    );
  };

  /**
   * An icon-only toolbar button. `labels[labelKey]` is both its accessible
   * name and its tooltip text.
   */
  export const ToolbarButton: React.FC<
    React.ButtonHTMLAttributes<HTMLButtonElement> & {
      icon: React.ReactNode;
      labelKey: keyof CopilotChatLabels;
      defaultClassName?: string;
    }
  > = ({ icon, labelKey, defaultClassName, className, ...props }) => {
    const config = useCopilotChatConfiguration();
    const labels = config?.labels ?? CopilotChatDefaultLabels;
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="chatInputToolbarSecondary"
            size="chatInputToolbarIcon"
            className={cn(defaultClassName, className)}
            aria-label={labels[labelKey]}
            {...props}
          >
            {icon}
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>{labels[labelKey]}</p>
        </TooltipContent>
      </Tooltip>
    );
  };

  export const StartTranscribeButton: React.FC<
    React.ButtonHTMLAttributes<HTMLButtonElement>
  > = (props) => (
    <ToolbarButton
      data-testid="copilot-start-transcribe-button"
      icon={<CopilotIcon name="Mic" className="cpk-chat-input-toolbar-icon" />}
      labelKey="chatInputToolbarStartTranscribeButtonLabel"
      defaultClassName="cpk-chat-input-start-transcribe-button"
      {...props}
    />
  );

  export const CancelTranscribeButton: React.FC<
    React.ButtonHTMLAttributes<HTMLButtonElement>
  > = (props) => (
    <ToolbarButton
      data-testid="copilot-cancel-transcribe-button"
      icon={<CopilotIcon name="X" className="cpk-chat-input-toolbar-icon" />}
      labelKey="chatInputToolbarCancelTranscribeButtonLabel"
      defaultClassName="cpk-chat-input-cancel-transcribe-button"
      {...props}
    />
  );

  export const FinishTranscribeButton: React.FC<
    React.ButtonHTMLAttributes<HTMLButtonElement>
  > = (props) => (
    <ToolbarButton
      data-testid="copilot-finish-transcribe-button"
      icon={
        <CopilotIcon name="Check" className="cpk-chat-input-toolbar-icon" />
      }
      labelKey="chatInputToolbarFinishTranscribeButtonLabel"
      defaultClassName="cpk-chat-input-finish-transcribe-button"
      {...props}
    />
  );

  /**
   * The "+" button that opens the attachment and tools menu. Its accessible
   * name and tooltip come from `labels.chatInputToolbarAddButtonLabel`.
   */
  export const AddMenuButton: React.FC<
    React.ButtonHTMLAttributes<HTMLButtonElement> & {
      toolsMenu?: (ToolsMenuItem | "-")[];
      onAddFile?: () => void;
    }
  > = ({ className, toolsMenu, onAddFile, disabled, ...props }) => {
    const config = useCopilotChatConfiguration();
    const labels = config?.labels ?? CopilotChatDefaultLabels;

    // Defer Radix UI rendering until after hydration to avoid ID mismatches
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);

    const menuItems = useMemo(
      () =>
        ɵnormalizeToolsMenu<ToolsMenuItem>(
          toolsMenu,
          onAddFile
            ? {
                label: labels.chatInputToolbarAddButtonLabel,
                action: onAddFile,
              }
            : undefined,
        ),
      [onAddFile, toolsMenu, labels.chatInputToolbarAddButtonLabel],
    );

    const renderMenuItems = useCallback(
      (items: (ToolsMenuItem | "-")[]): React.ReactNode =>
        items.map((item, index) => {
          if (item === "-") {
            return <DropdownMenuSeparator key={`separator-${index}`} />;
          }

          if (item.items && item.items.length > 0) {
            return (
              <DropdownMenuSub key={`group-${index}`}>
                <DropdownMenuSubTrigger>{item.label}</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {renderMenuItems(item.items)}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            );
          }

          return (
            <DropdownMenuItem key={`item-${index}`} onClick={item.action}>
              {item.label}
            </DropdownMenuItem>
          );
        }),
      [],
    );

    const hasMenuItems = menuItems.length > 0;
    const isDisabled = disabled || !hasMenuItems;

    const button = (
      <Button
        type="button"
        data-testid="copilot-add-menu-button"
        variant="chatInputToolbarSecondary"
        size="chatInputToolbarIcon"
        className={cn("cpk-chat-input-add-menu-button", className)}
        disabled={isDisabled}
        aria-label={labels.chatInputToolbarAddButtonLabel}
        {...props}
      >
        <CopilotIcon name="Plus" className="cpk-chat-input-add-menu-icon" />
      </Button>
    );

    // Render plain button during SSR; Radix wrappers only after hydration
    if (!mounted) return button;

    return (
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>{button}</DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p className="cpk-chat-input-add-menu-tooltip">
              <span>{labels.chatInputToolbarAddButtonLabel}</span>
              <code className="cpk-chat-input-add-menu-shortcut">/</code>
            </p>
          </TooltipContent>
        </Tooltip>
        {hasMenuItems && (
          <DropdownMenuContent side="top" align="start">
            {renderMenuItems(menuItems)}
          </DropdownMenuContent>
        )}
      </DropdownMenu>
    );
  };

  export type TextAreaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

  export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(
    function TextArea(
      { style, className, autoFocus, placeholder, ...props },
      ref,
    ) {
      const internalTextareaRef = useRef<HTMLTextAreaElement>(null);
      const config = useCopilotChatConfiguration();
      const labels = config?.labels ?? CopilotChatDefaultLabels;

      useImperativeHandle(
        ref,
        () => internalTextareaRef.current as HTMLTextAreaElement,
      );

      useEffect(() => {
        if (autoFocus) {
          internalTextareaRef.current?.focus({ preventScroll: true });
        }
      }, [autoFocus]);

      return (
        <textarea
          ref={internalTextareaRef}
          data-testid="copilot-chat-textarea"
          placeholder={placeholder ?? labels.chatInputPlaceholder}
          className={cn("cpk-chat-input-textarea", className)}
          style={{
            overflow: "auto",
            resize: "none",
            ...style,
          }}
          rows={1}
          {...props}
        />
      );
    },
  );

  export const AudioRecorder = CopilotChatAudioRecorder;

  export const Disclaimer: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
    className,
    ...props
  }) => {
    const config = useCopilotChatConfiguration();
    const labels = config?.labels ?? CopilotChatDefaultLabels;
    return (
      <div className={cn("cpk-chat-input-disclaimer", className)} {...props}>
        {labels.chatDisclaimerText}
      </div>
    );
  };
}

CopilotChatInput.TextArea.displayName = "CopilotChatInput.TextArea";
CopilotChatInput.SendButton.displayName = "CopilotChatInput.SendButton";
CopilotChatInput.ToolbarButton.displayName = "CopilotChatInput.ToolbarButton";
CopilotChatInput.StartTranscribeButton.displayName =
  "CopilotChatInput.StartTranscribeButton";
CopilotChatInput.CancelTranscribeButton.displayName =
  "CopilotChatInput.CancelTranscribeButton";
CopilotChatInput.FinishTranscribeButton.displayName =
  "CopilotChatInput.FinishTranscribeButton";
CopilotChatInput.AddMenuButton.displayName = "CopilotChatInput.AddMenuButton";
CopilotChatInput.Disclaimer.displayName = "CopilotChatInput.Disclaimer";

export default CopilotChatInput;
