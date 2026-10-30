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
} from "react";
import { CopilotIcon } from "../icons/CopilotIcon";

import {
  CopilotChatDefaultLabels,
  ɵcomposerButtonState,
  ɵresolveComposerKey,
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
  const isControlled = value !== undefined;
  const [internalValue, setInternalValue] = useState<string>(() => value ?? "");

  useEffect(() => {
    if (!isControlled && value !== undefined) {
      setInternalValue(value);
    }
  }, [isControlled, value]);

  const resolvedValue = isControlled ? (value ?? "") : internalValue;

  const [layout, setLayout] = useState<"compact" | "expanded">("compact");
  const ignoreResizeRef = useRef(false);
  const resizeEvaluationRafRef = useRef<number | null>(null);
  const isExpanded = mode === "input" && layout === "expanded";
  const [commandQuery, setCommandQuery] = useState<string | null>(null);
  const [slashHighlightIndex, setSlashHighlightIndex] = useState(0);

  const inputRef = useRef<HTMLTextAreaElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const addButtonContainerRef = useRef<HTMLDivElement>(null);
  const actionsContainerRef = useRef<HTMLDivElement>(null);
  const audioRecorderRef =
    useRef<React.ElementRef<typeof CopilotChatAudioRecorder>>(null);
  const slashMenuRef = useRef<HTMLDivElement>(null);
  const config = useCopilotChatConfiguration();
  const labels = config?.labels ?? CopilotChatDefaultLabels;

  const previousModalStateRef = useRef<boolean | undefined>(undefined);
  const measurementCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const measurementsRef = useRef({
    singleLineHeight: 0,
    maxHeight: 0,
    paddingLeft: 0,
    paddingRight: 0,
  });

  // Cached container dimensions — invalidated on resize, lazily repopulated on next layout pass.
  // Eliminates getComputedStyle(grid) + 2x getBoundingClientRect per compact-layout evaluation.
  const containerCacheRef = useRef<{
    compactWidth: number;
  } | null>(null);

  const commandItems = useMemo(() => {
    const entries: ToolsMenuItem[] = [];
    const seen = new Set<string>();

    const pushItem = (item: ToolsMenuItem | "-") => {
      if (item === "-") {
        return;
      }

      if (item.items && item.items.length > 0) {
        for (const nested of item.items) {
          pushItem(nested);
        }
        return;
      }

      if (!seen.has(item.label)) {
        seen.add(item.label);
        entries.push(item);
      }
    };

    if (onAddFile) {
      pushItem({
        label: labels.chatInputToolbarAddButtonLabel,
        action: onAddFile,
      });
    }

    if (toolsMenu && toolsMenu.length > 0) {
      for (const item of toolsMenu) {
        pushItem(item);
      }
    }

    return entries;
  }, [labels.chatInputToolbarAddButtonLabel, onAddFile, toolsMenu]);

  const filteredCommands = useMemo(() => {
    if (commandQuery === null) {
      return [] as ToolsMenuItem[];
    }

    if (commandItems.length === 0) {
      return [] as ToolsMenuItem[];
    }

    const query = commandQuery.trim().toLowerCase();
    if (query.length === 0) {
      return commandItems;
    }

    const startsWith: ToolsMenuItem[] = [];
    const contains: ToolsMenuItem[] = [];
    for (const item of commandItems) {
      const label = item.label.toLowerCase();
      if (label.startsWith(query)) {
        startsWith.push(item);
      } else if (label.includes(query)) {
        contains.push(item);
      }
    }

    return [...startsWith, ...contains];
  }, [commandItems, commandQuery]);

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

  useEffect(() => {
    if (commandItems.length === 0 && commandQuery !== null) {
      setCommandQuery(null);
    }
  }, [commandItems.length, commandQuery]);

  const previousCommandQueryRef = useRef<string | null>(null);

  useEffect(() => {
    if (
      commandQuery !== null &&
      commandQuery !== previousCommandQueryRef.current &&
      filteredCommands.length > 0
    ) {
      setSlashHighlightIndex(0);
    }

    previousCommandQueryRef.current = commandQuery;
  }, [commandQuery, filteredCommands.length]);

  useEffect(() => {
    if (commandQuery === null) {
      setSlashHighlightIndex(0);
      return;
    }

    if (filteredCommands.length === 0) {
      setSlashHighlightIndex(-1);
    } else if (
      slashHighlightIndex < 0 ||
      slashHighlightIndex >= filteredCommands.length
    ) {
      setSlashHighlightIndex(0);
    }
  }, [commandQuery, filteredCommands, slashHighlightIndex]);

  // Handle recording based on mode changes
  useEffect(() => {
    const recorder = audioRecorderRef.current;
    if (!recorder) {
      return;
    }

    if (mode === "transcribe") {
      // Start recording when entering transcribe mode
      recorder.start().catch(console.error);
    } else {
      // Stop recording when leaving transcribe mode
      if (recorder.state === "recording") {
        recorder.stop().catch(console.error);
      }
    }
  }, [mode]);

  useEffect(() => {
    if (mode !== "input") {
      setLayout("compact");
      setCommandQuery(null);
    }
  }, [mode]);

  const updateSlashState = useCallback(
    (value: string) => {
      if (commandItems.length === 0) {
        setCommandQuery((prev) => (prev === null ? prev : null));
        return;
      }

      if (value.startsWith("/")) {
        const firstLine = value.split(/\r?\n/, 1)[0] ?? "";
        const query = firstLine.slice(1);
        setCommandQuery((prev) => (prev === query ? prev : query));
      } else {
        setCommandQuery((prev) => (prev === null ? prev : null));
      }
    },
    [commandItems.length],
  );

  useEffect(() => {
    updateSlashState(resolvedValue);
  }, [resolvedValue, updateSlashState]);

  // Handlers
  const handleChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const nextValue = e.target.value;
    if (!isControlled) {
      setInternalValue(nextValue);
    }
    onChange?.(nextValue);
    updateSlashState(nextValue);
  };

  const clearInputValue = useCallback(() => {
    if (!isControlled) {
      setInternalValue("");
    }

    if (onChange) {
      onChange("");
    }
  }, [isControlled, onChange]);

  const runCommand = useCallback(
    (item: ToolsMenuItem) => {
      clearInputValue();

      item.action?.();

      setCommandQuery(null);
      setSlashHighlightIndex(0);

      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    },
    [clearInputValue],
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
    // Skip key handling during IME composition (e.g. CJK input).
    // The compositionend event will fire separately when composition ends.
    if (e.nativeEvent.isComposing || e.keyCode === 229) {
      return;
    }

    if (commandQuery !== null && mode === "input") {
      if (e.key === "ArrowDown") {
        if (filteredCommands.length > 0) {
          e.preventDefault();
          setSlashHighlightIndex((prev) => {
            if (filteredCommands.length === 0) {
              return prev;
            }
            const next = prev === -1 ? 0 : (prev + 1) % filteredCommands.length;
            return next;
          });
        }
        return;
      }

      if (e.key === "ArrowUp") {
        if (filteredCommands.length > 0) {
          e.preventDefault();
          setSlashHighlightIndex((prev) => {
            if (filteredCommands.length === 0) {
              return prev;
            }
            if (prev === -1) {
              return filteredCommands.length - 1;
            }
            return prev <= 0 ? filteredCommands.length - 1 : prev - 1;
          });
        }
        return;
      }

      if (e.key === "Enter") {
        const selected =
          slashHighlightIndex >= 0
            ? filteredCommands[slashHighlightIndex]
            : undefined;
        if (selected) {
          e.preventDefault();
          runCommand(selected);
          return;
        }
      }

      if (e.key === "Escape") {
        e.preventDefault();
        setCommandQuery(null);
        return;
      }
    }

    // Enter without Shift never adds a line break, even when it does nothing.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
    }
    // Text in the composer means send, even while a run is in flight: after
    // picking one interrupt's option the resume run still streams when the
    // user types the next prompt, and stopping it would lose the next
    // interrupt. Enter stops the run only when the composer is empty.
    const action = ɵresolveComposerKey(
      {
        key: e.key,
        shiftKey: e.shiftKey,
        isComposing: e.nativeEvent.isComposing,
        keyCode: e.keyCode,
      },
      composerInput,
    );
    if (action === "stop") {
      onStop?.();
    } else if (action === "send") {
      send();
    }
  };

  const send = () => {
    if (!onSubmitMessage) {
      return;
    }
    const trimmed = resolvedValue.trim();
    if (!trimmed) {
      return;
    }

    onSubmitMessage(trimmed);

    // Always clear the input after sending, including controlled mode.
    // In controlled mode, onChange("") notifies the parent to reset its state.
    if (!isControlled) {
      setInternalValue("");
    }
    onChange?.("");

    if (inputRef.current) {
      inputRef.current.focus();
    }
  };

  const BoundTextArea = renderSlot(textArea, CopilotChatInput.TextArea, {
    ref: inputRef,
    value: resolvedValue,
    onChange: handleChange,
    onKeyDown: handleKeyDown,
    onCompositionStart: () => {
      isComposingRef.current = true;
    },
    onCompositionEnd: () => {
      isComposingRef.current = false;
    },
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

  // Determine whether to show disclaimer based on prop or positioning default
  const shouldShowDisclaimer = showDisclaimer ?? positioning === "absolute";

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

  // Track whether an IME composition is active so we can avoid
  // resetting textarea.value during measurement (which would break
  // the composition session).
  const isComposingRef = useRef(false);

  const ensureMeasurements = useCallback(() => {
    const textarea = inputRef.current;
    if (!textarea || isComposingRef.current) {
      return;
    }

    const previousValue = textarea.value;
    const previousHeight = textarea.style.height;

    textarea.style.height = "auto";

    const computedStyle = window.getComputedStyle(textarea);
    const paddingLeft = parseFloat(computedStyle.paddingLeft) || 0;
    const paddingRight = parseFloat(computedStyle.paddingRight) || 0;
    const paddingTop = parseFloat(computedStyle.paddingTop) || 0;
    const paddingBottom = parseFloat(computedStyle.paddingBottom) || 0;

    textarea.value = "";
    const singleLineHeight = textarea.scrollHeight;
    textarea.value = previousValue;

    const contentHeight = singleLineHeight - paddingTop - paddingBottom;
    const maxHeight = contentHeight * 5 + paddingTop + paddingBottom;

    measurementsRef.current = {
      singleLineHeight,
      maxHeight,
      paddingLeft,
      paddingRight,
    };

    textarea.style.height = previousHeight;
    textarea.style.maxHeight = `${maxHeight}px`;
  }, []);

  const adjustTextareaHeight = useCallback(() => {
    const textarea = inputRef.current;
    if (!textarea) {
      return 0;
    }

    if (measurementsRef.current.singleLineHeight === 0) {
      ensureMeasurements();
    }

    const { maxHeight } = measurementsRef.current;
    if (maxHeight) {
      textarea.style.maxHeight = `${maxHeight}px`;
    }

    textarea.style.height = "auto";
    const scrollHeight = textarea.scrollHeight;
    if (maxHeight) {
      textarea.style.height = `${Math.min(scrollHeight, maxHeight)}px`;
    } else {
      textarea.style.height = `${scrollHeight}px`;
    }

    return scrollHeight;
  }, [ensureMeasurements]);

  const updateLayout = useCallback((nextLayout: "compact" | "expanded") => {
    setLayout((prev) => {
      if (prev === nextLayout) {
        return prev;
      }
      ignoreResizeRef.current = true;
      return nextLayout;
    });
  }, []);

  const updateContainerCache = useCallback((): {
    compactWidth: number;
  } | null => {
    const grid = gridRef.current;
    const addContainer = addButtonContainerRef.current;
    const actionsContainer = actionsContainerRef.current;
    if (!grid || !addContainer || !actionsContainer) return null;

    const gridStyles = window.getComputedStyle(grid);
    const paddingLeft = parseFloat(gridStyles.paddingLeft) || 0;
    const paddingRight = parseFloat(gridStyles.paddingRight) || 0;
    const columnGap = parseFloat(gridStyles.columnGap) || 0;
    const gridAvailableWidth = grid.clientWidth - paddingLeft - paddingRight;

    if (gridAvailableWidth <= 0) return null;

    const addWidth = addContainer.getBoundingClientRect().width;
    const actionsWidth = actionsContainer.getBoundingClientRect().width;
    const compactWidth = Math.max(
      gridAvailableWidth - addWidth - actionsWidth - columnGap * 2,
      0,
    );

    if (compactWidth <= 0) return null;

    const result = { compactWidth };
    containerCacheRef.current = result;
    return result;
  }, []);

  const evaluateLayout = useCallback(() => {
    if (mode !== "input") {
      updateLayout("compact");
      return;
    }

    if (
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function"
    ) {
      const isMobileViewport = window.matchMedia("(max-width: 767px)").matches;
      if (isMobileViewport) {
        adjustTextareaHeight();
        updateLayout("expanded");
        return;
      }
    }

    const textarea = inputRef.current;
    const grid = gridRef.current;
    const addContainer = addButtonContainerRef.current;
    const actionsContainer = actionsContainerRef.current;

    if (!textarea) {
      return;
    }

    if (!grid || !addContainer || !actionsContainer) {
      // A custom `children` layout renders none of the default containers, so
      // there is no compact or expanded layout to pick; the textarea still
      // grows with its content.
      adjustTextareaHeight();
      return;
    }

    if (measurementsRef.current.singleLineHeight === 0) {
      ensureMeasurements();
    }

    const scrollHeight = adjustTextareaHeight();
    const baseline = measurementsRef.current.singleLineHeight;
    const hasExplicitBreak = resolvedValue.includes("\n");
    const renderedMultiline =
      baseline > 0 ? scrollHeight > baseline + 1 : false;
    let shouldExpand = hasExplicitBreak || renderedMultiline;

    if (!shouldExpand) {
      // Use cached container dimensions (lazily populated on first access, invalidated on resize).
      const cache = containerCacheRef.current ?? updateContainerCache();

      if (cache && cache.compactWidth > 0) {
        const compactInnerWidth = Math.max(
          cache.compactWidth -
            (measurementsRef.current.paddingLeft || 0) -
            (measurementsRef.current.paddingRight || 0),
          0,
        );

        if (compactInnerWidth > 0) {
          // Read font fresh each evaluation — getComputedStyle for style-only
          // properties is cheap and avoids stale values after CSS/theme changes.
          const textareaStyles = window.getComputedStyle(textarea);
          let font = textareaStyles.font;
          if (!font) {
            const {
              fontStyle,
              fontVariant,
              fontWeight,
              fontSize,
              lineHeight,
              fontFamily,
            } = textareaStyles;
            if (fontSize && fontFamily) {
              font = `${fontStyle} ${fontVariant} ${fontWeight} ${fontSize}/${lineHeight} ${fontFamily}`;
            }
          }

          if (font?.trim()) {
            const canvas =
              measurementCanvasRef.current ?? document.createElement("canvas");
            if (!measurementCanvasRef.current) {
              measurementCanvasRef.current = canvas;
            }

            const context = canvas.getContext("2d");
            if (context) {
              context.font = font;

              const lines =
                resolvedValue.length > 0 ? resolvedValue.split("\n") : [""];
              let longestWidth = 0;
              for (const line of lines) {
                const metrics = context.measureText(line || " ");
                if (metrics.width > longestWidth) {
                  longestWidth = metrics.width;
                }
              }

              if (longestWidth > compactInnerWidth) {
                shouldExpand = true;
              }
            } else if (process.env.NODE_ENV !== "production") {
              console.warn(
                "[CopilotChatInput] canvas.getContext('2d') returned null. " +
                  "Text-width-based expansion will be unavailable.",
              );
            }
          } else if (process.env.NODE_ENV !== "production") {
            console.warn(
              "[CopilotChatInput] Could not resolve textarea font for layout measurement. " +
                "Text-width-based expansion will be skipped until the next evaluation.",
            );
          }
        }
      }
    }

    const nextLayout = shouldExpand ? "expanded" : "compact";
    updateLayout(nextLayout);
  }, [
    adjustTextareaHeight,
    ensureMeasurements,
    mode,
    resolvedValue,
    updateContainerCache,
    updateLayout,
  ]);

  useLayoutEffect(() => {
    evaluateLayout();
  }, [evaluateLayout]);

  useEffect(() => {
    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const textarea = inputRef.current;
    const grid = gridRef.current;
    const addContainer = addButtonContainerRef.current;
    const actionsContainer = actionsContainerRef.current;

    if (!textarea || !grid || !addContainer || !actionsContainer) {
      return;
    }

    const containerTargets = new Set<Element>([
      grid,
      addContainer,
      actionsContainer,
    ]);

    const scheduleEvaluation = (invalidateCache: boolean) => {
      if (ignoreResizeRef.current) {
        ignoreResizeRef.current = false;
        // Self-inflicted resize from a layout toggle — container dimensions
        // are unchanged, so keep the cache warm.
        return;
      }

      if (invalidateCache) {
        containerCacheRef.current = null;
      }

      if (typeof window === "undefined") {
        evaluateLayout();
        return;
      }

      if (resizeEvaluationRafRef.current !== null) {
        cancelAnimationFrame(resizeEvaluationRafRef.current);
      }

      resizeEvaluationRafRef.current = window.requestAnimationFrame(() => {
        resizeEvaluationRafRef.current = null;
        evaluateLayout();
      });
    };

    // Single observer for all elements — inspect entry.target to decide
    // whether to invalidate the container dimension cache.  Container
    // targets (grid, buttons) changing size means compactWidth may have
    // changed; textarea height changes (typing) do not affect it.
    const observer = new ResizeObserver((entries) => {
      let shouldInvalidate = false;
      for (const entry of entries) {
        if (containerTargets.has(entry.target)) {
          shouldInvalidate = true;
          break;
        }
      }
      scheduleEvaluation(shouldInvalidate);
    });

    observer.observe(grid);
    observer.observe(addContainer);
    observer.observe(actionsContainer);
    observer.observe(textarea);

    return () => {
      observer.disconnect();
      if (
        typeof window !== "undefined" &&
        resizeEvaluationRafRef.current !== null
      ) {
        cancelAnimationFrame(resizeEvaluationRafRef.current);
        resizeEvaluationRafRef.current = null;
      }
    };
  }, [evaluateLayout]);

  const slashMenuVisible = commandQuery !== null && commandItems.length > 0;

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
              onMouseEnter={() => setSlashHighlightIndex(index)}
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

    const menuItems = useMemo<(ToolsMenuItem | "-")[]>(() => {
      const items: (ToolsMenuItem | "-")[] = [];

      if (onAddFile) {
        items.push({
          label: labels.chatInputToolbarAddButtonLabel,
          action: onAddFile,
        });
      }

      if (toolsMenu && toolsMenu.length > 0) {
        if (items.length > 0) {
          items.push("-");
        }

        for (const item of toolsMenu) {
          if (item === "-") {
            if (items.length === 0 || items[items.length - 1] === "-") {
              continue;
            }
            items.push(item);
          } else {
            items.push(item);
          }
        }

        while (items.length > 0 && items[items.length - 1] === "-") {
          items.pop();
        }
      }

      return items;
    }, [onAddFile, toolsMenu, labels.chatInputToolbarAddButtonLabel]);

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
