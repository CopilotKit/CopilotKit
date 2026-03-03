import React, {
  useState,
  useRef,
  KeyboardEvent,
  ChangeEvent,
  useEffect,
  useLayoutEffect,
  forwardRef,
  useImperativeHandle,
  useCallback,
  useMemo,
} from "react";
import { twMerge } from "tailwind-merge";
import { Plus, Mic, ArrowUp, X, Check, Square, Loader2 } from "lucide-react";

import {
  CopilotChatLabels,
  useCopilotChatConfiguration,
  CopilotChatDefaultLabels,
} from "@/providers/CopilotChatConfigurationProvider";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

import { CopilotChatAudioRecorder } from "./CopilotChatAudioRecorder";
import { renderSlot, WithSlots } from "@/lib/slots";
import { cn } from "@/lib/utils";

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
  autoFocus = true,
  positioning = "static",
  keyboardHeight = 0,
  containerRef,
  showDisclaimer,
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
      inputRef.current?.focus();
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

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
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

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (isProcessing) {
        onStop?.();
      } else {
        send();
      }
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

    if (!isControlled) {
      setInternalValue("");
      onChange?.("");
    }

    if (inputRef.current) {
      inputRef.current.focus();
    }
  };

  const BoundTextArea = renderSlot(textArea, CopilotChatInput.TextArea, {
    ref: inputRef,
    value: resolvedValue,
    onChange: handleChange,
    onKeyDown: handleKeyDown,
    autoFocus: autoFocus,
    className: twMerge(
      "cpk:w-full cpk:py-3",
      isExpanded ? "cpk:px-5" : "cpk:pr-5",
    ),
  });

  const isProcessing = mode !== "transcribe" && isRunning;
  const canSend = resolvedValue.trim().length > 0 && !!onSubmitMessage;
  const canStop = !!onStop;

  const handleSendButtonClick = () => {
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

  const BoundSendButton = renderSlot(sendButton, CopilotChatInput.SendButton, {
    onClick: handleSendButtonClick,
    disabled: isProcessing ? !canStop : !canSend,
    children:
      isProcessing && canStop ? (
        <Square className="cpk:size-[18px] cpk:fill-current" />
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
    } as CopilotChatInputChildrenArgs;

    return (
      <div data-copilotkit style={{ display: "contents" }}>
        {children(childProps)}
      </div>
    );
  }

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

  const ensureMeasurements = useCallback(() => {
    const textarea = inputRef.current;
    if (!textarea) {
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
        ensureMeasurements();
        adjustTextareaHeight();
        updateLayout("expanded");
        return;
      }
    }

    const textarea = inputRef.current;
    const grid = gridRef.current;
    const addContainer = addButtonContainerRef.current;
    const actionsContainer = actionsContainerRef.current;

    if (!textarea || !grid || !addContainer || !actionsContainer) {
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
      const gridStyles = window.getComputedStyle(grid);
      const paddingLeft = parseFloat(gridStyles.paddingLeft) || 0;
      const paddingRight = parseFloat(gridStyles.paddingRight) || 0;
      const columnGap = parseFloat(gridStyles.columnGap) || 0;
      const gridAvailableWidth = grid.clientWidth - paddingLeft - paddingRight;

      if (gridAvailableWidth > 0) {
        const addWidth = addContainer.getBoundingClientRect().width;
        const actionsWidth = actionsContainer.getBoundingClientRect().width;
        const compactWidth = Math.max(
          gridAvailableWidth - addWidth - actionsWidth - columnGap * 2,
          0,
        );

        const canvas =
          measurementCanvasRef.current ?? document.createElement("canvas");
        if (!measurementCanvasRef.current) {
          measurementCanvasRef.current = canvas;
        }

        const context = canvas.getContext("2d");
        if (context) {
          const textareaStyles = window.getComputedStyle(textarea);
          const font =
            textareaStyles.font ||
            `${textareaStyles.fontStyle} ${textareaStyles.fontVariant} ${textareaStyles.fontWeight} ${textareaStyles.fontSize}/${textareaStyles.lineHeight} ${textareaStyles.fontFamily}`;
          context.font = font;

          const compactInnerWidth = Math.max(
            compactWidth -
              (measurementsRef.current.paddingLeft || 0) -
              (measurementsRef.current.paddingRight || 0),
            0,
          );

          if (compactInnerWidth > 0) {
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

    const scheduleEvaluation = () => {
      if (ignoreResizeRef.current) {
        ignoreResizeRef.current = false;
        return;
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

    const observer = new ResizeObserver(() => {
      scheduleEvaluation();
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
      aria-label="Slash commands"
      ref={slashMenuRef}
      className="cpk:absolute cpk:bottom-full cpk:left-0 cpk:right-0 cpk:z-30 cpk:mb-2 cpk:max-h-64 cpk:overflow-y-auto cpk:rounded-lg cpk:border cpk:border-border cpk:bg-white cpk:shadow-lg cpk:dark:border-[#3a3a3a] cpk:dark:bg-[#1f1f1f]"
      style={{
        maxHeight: `${SLASH_MENU_MAX_VISIBLE_ITEMS * SLASH_MENU_ITEM_HEIGHT_PX}px`,
      }}
    >
      {filteredCommands.length === 0 ? (
        <div className="cpk:px-3 cpk:py-2 cpk:text-sm cpk:text-muted-foreground">
          No commands found
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
              className={twMerge(
                "cpk:w-full cpk:px-3 cpk:py-2 cpk:text-left cpk:text-sm cpk:transition-colors",
                "cpk:hover:bg-muted cpk:dark:hover:bg-[#2f2f2f]",
                isActive
                  ? "cpk:bg-muted cpk:dark:bg-[#2f2f2f]"
                  : "cpk:bg-transparent",
              )}
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
      className={twMerge(
        // Layout
        "cpk:flex cpk:w-full cpk:flex-col cpk:items-center cpk:justify-center",
        // Interaction
        "cpk:cursor-text",
        // Overflow and clipping
        "cpk:overflow-visible cpk:bg-clip-padding cpk:contain-inline-size",
        // Background
        "cpk:bg-white cpk:dark:bg-[#303030]",
        // Visual effects
        "cpk:shadow-[0_4px_4px_0_#0000000a,0_0_1px_0_#0000009e] cpk:rounded-[28px]",
      )}
      onClick={handleContainerClick}
      data-layout={isExpanded ? "expanded" : "compact"}
    >
      <div
        ref={gridRef}
        className={twMerge(
          "cpk:grid cpk:w-full cpk:gap-x-3 cpk:gap-y-3 cpk:px-3 cpk:py-2",
          isExpanded
            ? "cpk:grid-cols-[auto_minmax(0,1fr)_auto] cpk:grid-rows-[auto_auto]"
            : "cpk:grid-cols-[auto_minmax(0,1fr)_auto] cpk:items-center",
        )}
        data-layout={isExpanded ? "expanded" : "compact"}
      >
        <div
          ref={addButtonContainerRef}
          className={twMerge(
            "cpk:flex cpk:items-center",
            isExpanded ? "cpk:row-start-2" : "cpk:row-start-1",
            "cpk:col-start-1",
          )}
        >
          {BoundAddMenuButton}
        </div>
        <div
          className={twMerge(
            "cpk:relative cpk:flex cpk:min-w-0 cpk:flex-col cpk:min-h-[50px] cpk:justify-center",
            isExpanded
              ? "cpk:col-span-3 cpk:row-start-1"
              : "cpk:col-start-2 cpk:row-start-1",
          )}
        >
          {mode === "transcribe" ? (
            BoundAudioRecorder
          ) : mode === "processing" ? (
            <div className="cpk:flex cpk:w-full cpk:items-center cpk:justify-center cpk:py-3 cpk:px-5">
              <Loader2 className="cpk:size-[26px] cpk:animate-spin cpk:text-muted-foreground" />
            </div>
          ) : (
            <>
              {BoundTextArea}
              {slashMenu}
            </>
          )}
        </div>
        <div
          ref={actionsContainerRef}
          className={twMerge(
            "cpk:flex cpk:items-center cpk:justify-end cpk:gap-2",
            isExpanded
              ? "cpk:col-start-3 cpk:row-start-2"
              : "cpk:col-start-3 cpk:row-start-1",
          )}
        >
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

  return (
    <div
      data-copilotkit
      ref={containerRef}
      className={cn(
        positioning === "absolute" &&
          "cpk:absolute cpk:bottom-0 cpk:left-0 cpk:right-0 cpk:z-20 cpk:pointer-events-none",
        className,
      )}
      style={{
        transform:
          keyboardHeight > 0 ? `translateY(-${keyboardHeight}px)` : undefined,
        transition: "transform 0.2s ease-out",
      }}
      {...props}
    >
      <div className="cpk:max-w-3xl cpk:mx-auto cpk:py-0 cpk:px-4 cpk:sm:px-0 cpk:[div[data-sidebar-chat]_&]:px-8 cpk:[div[data-popup-chat]_&]:px-4 cpk:pointer-events-auto">
        {inputPill}
      </div>
      {shouldShowDisclaimer && BoundDisclaimer}
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace CopilotChatInput {
  export const SendButton: React.FC<
    React.ButtonHTMLAttributes<HTMLButtonElement>
  > = ({ className, children, ...props }) => (
    <div className="cpk:mr-[10px]">
      <Button
        type="button"
        data-testid="copilot-send-button"
        variant="chatInputToolbarPrimary"
        size="chatInputToolbarIcon"
        className={className}
        {...props}
      >
        {children ?? <ArrowUp className="cpk:size-[18px]" />}
      </Button>
    </div>
  );

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
            className={twMerge(defaultClassName, className)}
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
      icon={<Mic className="cpk:size-[18px]" />}
      labelKey="chatInputToolbarStartTranscribeButtonLabel"
      defaultClassName="cpk:mr-2"
      {...props}
    />
  );

  export const CancelTranscribeButton: React.FC<
    React.ButtonHTMLAttributes<HTMLButtonElement>
  > = (props) => (
    <ToolbarButton
      data-testid="copilot-cancel-transcribe-button"
      icon={<X className="cpk:size-[18px]" />}
      labelKey="chatInputToolbarCancelTranscribeButtonLabel"
      defaultClassName="cpk:mr-2"
      {...props}
    />
  );

  export const FinishTranscribeButton: React.FC<
    React.ButtonHTMLAttributes<HTMLButtonElement>
  > = (props) => (
    <ToolbarButton
      data-testid="copilot-finish-transcribe-button"
      icon={<Check className="cpk:size-[18px]" />}
      labelKey="chatInputToolbarFinishTranscribeButtonLabel"
      defaultClassName="cpk:mr-[10px]"
      {...props}
    />
  );

  export const AddMenuButton: React.FC<
    React.ButtonHTMLAttributes<HTMLButtonElement> & {
      toolsMenu?: (ToolsMenuItem | "-")[];
      onAddFile?: () => void;
    }
  > = ({ className, toolsMenu, onAddFile, disabled, ...props }) => {
    const config = useCopilotChatConfiguration();
    const labels = config?.labels ?? CopilotChatDefaultLabels;

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

    return (
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                data-testid="copilot-add-menu-button"
                variant="chatInputToolbarSecondary"
                size="chatInputToolbarIcon"
                className={twMerge("cpk:ml-1", className)}
                disabled={isDisabled}
                {...props}
              >
                <Plus className="cpk:size-[20px]" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p className="cpk:flex cpk:items-center cpk:gap-1 cpk:text-xs cpk:font-medium">
              <span>Add files and more</span>
              <code className="cpk:rounded cpk:bg-[#4a4a4a] cpk:px-1 cpk:py-[1px] cpk:font-mono cpk:text-[11px] cpk:text-white cpk:dark:bg-[#e0e0e0] cpk:dark:text-black">
                /
              </code>
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

      // Auto-scroll input into view on mobile when focused
      useEffect(() => {
        const textarea = internalTextareaRef.current;
        if (!textarea) return;

        const handleFocus = () => {
          // Small delay to let the keyboard start appearing
          setTimeout(() => {
            textarea.scrollIntoView({ behavior: "smooth", block: "nearest" });
          }, 300);
        };

        textarea.addEventListener("focus", handleFocus);
        return () => textarea.removeEventListener("focus", handleFocus);
      }, []);

      useEffect(() => {
        if (autoFocus) {
          internalTextareaRef.current?.focus();
        }
      }, [autoFocus]);

      return (
        <textarea
          ref={internalTextareaRef}
          data-testid="copilot-chat-textarea"
          placeholder={placeholder ?? labels.chatInputPlaceholder}
          className={twMerge(
            "cpk:bg-transparent cpk:outline-none cpk:antialiased cpk:font-regular cpk:leading-relaxed cpk:text-[16px] cpk:placeholder:text-[#00000077] cpk:dark:placeholder:text-[#fffc]",
            className,
          )}
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
      <div
        className={cn(
          "cpk:text-center cpk:text-xs cpk:text-muted-foreground cpk:py-3 cpk:px-4 cpk:max-w-3xl cpk:mx-auto",
          className,
        )}
        {...props}
      >
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
