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
import { Plus, Mic, ArrowUp, X, Check, Square } from "lucide-react";

import {
  CopilotChatLabels,
  useCopilotChatConfiguration,
  CopilotChatDefaultLabels,
} from "@/providers/CopilotChatConfigurationProvider";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
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
  onAddFile?: () => void;
  value?: string;
  onChange?: (value: string) => void;
} & Omit<React.HTMLAttributes<HTMLDivElement>, "onChange">;

type CopilotChatInputBaseProps = WithSlots<CopilotChatInputSlots, CopilotChatInputRestProps>;

type CopilotChatInputChildrenArgs = CopilotChatInputBaseProps extends { children?: infer C }
  ? C extends (props: infer P) => React.ReactNode
    ? P
    : never
  : never;

export type CopilotChatInputProps = Omit<CopilotChatInputBaseProps, "children"> & {
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
  onAddFile,
  onChange,
  value,
  toolsMenu,
  autoFocus = true,
  textArea,
  sendButton,
  startTranscribeButton,
  cancelTranscribeButton,
  finishTranscribeButton,
  addMenuButton,
  audioRecorder,
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
  const audioRecorderRef = useRef<React.ElementRef<typeof CopilotChatAudioRecorder>>(null);
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
    } else if (slashHighlightIndex < 0 || slashHighlightIndex >= filteredCommands.length) {
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
        const selected = slashHighlightIndex >= 0 ? filteredCommands[slashHighlightIndex] : undefined;
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
      "w-full py-3",
      isExpanded ? "px-5" : "pr-5",
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

  const BoundAudioRecorder = renderSlot(audioRecorder, CopilotChatAudioRecorder, {
    ref: audioRecorderRef,
  });

  const BoundSendButton = renderSlot(sendButton, CopilotChatInput.SendButton, {
    onClick: handleSendButtonClick,
    disabled: isProcessing ? !canStop : !canSend,
    children: isProcessing && canStop ? <Square className="size-[18px] fill-current" /> : undefined,
  });

  const BoundStartTranscribeButton = renderSlot(startTranscribeButton, CopilotChatInput.StartTranscribeButton, {
    onClick: onStartTranscribe,
  });

  const BoundCancelTranscribeButton = renderSlot(cancelTranscribeButton, CopilotChatInput.CancelTranscribeButton, {
    onClick: onCancelTranscribe,
  });

  const BoundFinishTranscribeButton = renderSlot(finishTranscribeButton, CopilotChatInput.FinishTranscribeButton, {
    onClick: onFinishTranscribe,
  });

  const BoundAddMenuButton = renderSlot(addMenuButton, CopilotChatInput.AddMenuButton, {
    disabled: mode === "transcribe",
    onAddFile,
    toolsMenu,
  });

  if (children) {
    const childProps = {
      textArea: BoundTextArea,
      audioRecorder: BoundAudioRecorder,
      sendButton: BoundSendButton,
      startTranscribeButton: BoundStartTranscribeButton,
      cancelTranscribeButton: BoundCancelTranscribeButton,
      finishTranscribeButton: BoundFinishTranscribeButton,
      addMenuButton: BoundAddMenuButton,
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
    } as CopilotChatInputChildrenArgs;

    return <>{children(childProps)}</>;
  }

  const handleContainerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Don't focus if clicking on buttons or other interactive elements
    const target = e.target as HTMLElement;
    if (target.tagName !== "BUTTON" && !target.closest("button") && inputRef.current && mode === "input") {
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

    if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
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
    const renderedMultiline = baseline > 0 ? scrollHeight > baseline + 1 : false;
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
        const compactWidth = Math.max(gridAvailableWidth - addWidth - actionsWidth - columnGap * 2, 0);

        const canvas = measurementCanvasRef.current ?? document.createElement("canvas");
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
            compactWidth - (measurementsRef.current.paddingLeft || 0) - (measurementsRef.current.paddingRight || 0),
            0,
          );

          if (compactInnerWidth > 0) {
            const lines = resolvedValue.length > 0 ? resolvedValue.split("\n") : [""];
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
  }, [adjustTextareaHeight, ensureMeasurements, mode, resolvedValue, updateLayout]);

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
      if (typeof window !== "undefined" && resizeEvaluationRafRef.current !== null) {
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
      className="absolute bottom-full left-0 right-0 z-30 mb-2 max-h-64 overflow-y-auto rounded-lg border border-border bg-white shadow-lg dark:border-[#3a3a3a] dark:bg-[#1f1f1f]"
      style={{ maxHeight: `${SLASH_MENU_MAX_VISIBLE_ITEMS * SLASH_MENU_ITEM_HEIGHT_PX}px` }}
    >
      {filteredCommands.length === 0 ? (
        <div className="px-3 py-2 text-sm text-muted-foreground">No commands found</div>
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
                "w-full px-3 py-2 text-left text-sm transition-colors",
                "hover:bg-muted dark:hover:bg-[#2f2f2f]",
                isActive ? "bg-muted dark:bg-[#2f2f2f]" : "bg-transparent",
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

  return (
    <div
      className={twMerge(
        // Layout
        "flex w-full flex-col items-center justify-center",
        // Interaction
        "cursor-text",
        // Overflow and clipping
        "overflow-visible bg-clip-padding contain-inline-size",
        // Background
        "bg-white dark:bg-[#303030]",
        // Visual effects
        "shadow-[0_4px_4px_0_#0000000a,0_0_1px_0_#0000009e] rounded-[28px]",
        className,
      )}
      onClick={handleContainerClick}
      {...props}
      data-layout={isExpanded ? "expanded" : "compact"}
    >
      <div
        ref={gridRef}
        className={twMerge(
          "grid w-full gap-x-3 gap-y-3 px-3 py-2",
          isExpanded
            ? "grid-cols-[auto_minmax(0,1fr)_auto] grid-rows-[auto_auto]"
            : "grid-cols-[auto_minmax(0,1fr)_auto] items-center",
        )}
        data-layout={isExpanded ? "expanded" : "compact"}
      >
        <div
          ref={addButtonContainerRef}
          className={twMerge(
            "flex items-center",
            isExpanded ? "row-start-2" : "row-start-1",
            "col-start-1",
          )}
        >
          {BoundAddMenuButton}
        </div>
        <div
          className={twMerge(
            "relative flex min-w-0 flex-col",
            isExpanded ? "col-span-3 row-start-1" : "col-start-2 row-start-1",
          )}
        >
          {mode === "transcribe" ? (
            BoundAudioRecorder
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
            "flex items-center justify-end gap-2",
            isExpanded ? "col-start-3 row-start-2" : "col-start-3 row-start-1",
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
}

// eslint-disable-next-line @typescript-eslint/no-namespace
export namespace CopilotChatInput {
  export const SendButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = ({ className, children, ...props }) => (
    <div className="mr-[10px]">
      <Button
        type="button"
        variant="chatInputToolbarPrimary"
        size="chatInputToolbarIcon"
        className={className}
        {...props}
      >
        {children ?? <ArrowUp className="size-[18px]" />}
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

  export const StartTranscribeButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = (props) => (
    <ToolbarButton
      icon={<Mic className="size-[18px]" />}
      labelKey="chatInputToolbarStartTranscribeButtonLabel"
      defaultClassName="mr-2"
      {...props}
    />
  );

  export const CancelTranscribeButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = (props) => (
    <ToolbarButton
      icon={<X className="size-[18px]" />}
      labelKey="chatInputToolbarCancelTranscribeButtonLabel"
      defaultClassName="mr-2"
      {...props}
    />
  );

  export const FinishTranscribeButton: React.FC<React.ButtonHTMLAttributes<HTMLButtonElement>> = (props) => (
    <ToolbarButton
      icon={<Check className="size-[18px]" />}
      labelKey="chatInputToolbarFinishTranscribeButtonLabel"
      defaultClassName="mr-[10px]"
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
                <DropdownMenuSubContent>{renderMenuItems(item.items)}</DropdownMenuSubContent>
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
                variant="chatInputToolbarSecondary"
                size="chatInputToolbarIcon"
                className={twMerge("ml-1", className)}
                disabled={isDisabled}
                {...props}
              >
                <Plus className="size-[20px]" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <p className="flex items-center gap-1 text-xs font-medium">
              <span>Add files and more</span>
              <code className="rounded bg-[#4a4a4a] px-1 py-[1px] font-mono text-[11px] text-white dark:bg-[#e0e0e0] dark:text-black">/</code>
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

  export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
    { style, className, autoFocus, ...props },
    ref,
  ) {
    const internalTextareaRef = useRef<HTMLTextAreaElement>(null);
    const config = useCopilotChatConfiguration();
    const labels = config?.labels ?? CopilotChatDefaultLabels;

    useImperativeHandle(ref, () => internalTextareaRef.current as HTMLTextAreaElement);

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
        {...props}
        style={{
          overflow: "auto",
          resize: "none",
          ...style,
        }}
        placeholder={labels.chatInputPlaceholder}
        className={twMerge(
          "bg-transparent outline-none antialiased font-regular leading-relaxed text-[16px] placeholder:text-[#00000077] dark:placeholder:text-[#fffc]",
          className,
        )}
        rows={1}
      />
    );
  });

  export const AudioRecorder = CopilotChatAudioRecorder;
}

CopilotChatInput.TextArea.displayName = "CopilotChatInput.TextArea";
CopilotChatInput.SendButton.displayName = "CopilotChatInput.SendButton";
CopilotChatInput.ToolbarButton.displayName = "CopilotChatInput.ToolbarButton";
CopilotChatInput.StartTranscribeButton.displayName = "CopilotChatInput.StartTranscribeButton";
CopilotChatInput.CancelTranscribeButton.displayName = "CopilotChatInput.CancelTranscribeButton";
CopilotChatInput.FinishTranscribeButton.displayName = "CopilotChatInput.FinishTranscribeButton";
CopilotChatInput.AddMenuButton.displayName = "CopilotChatInput.AddMenuButton";

export default CopilotChatInput;
