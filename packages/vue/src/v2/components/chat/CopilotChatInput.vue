<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useAttrs,
  watch,
} from "vue";
import { useCopilotChatConfiguration } from "../../providers/useCopilotChatConfiguration";
import { CopilotChatDefaultLabels } from "../../providers/types";
import {
  IconArrowUp,
  IconCheck,
  IconChevronRight,
  IconLoader2,
  IconMic,
  IconPlus,
  IconSquare,
  IconX,
} from "../icons";
import CopilotChatAudioRecorder from "./CopilotChatAudioRecorder.vue";
import { highlightMarkdownInput } from "./markdown-input-highlight";
import type { CopilotChatAudioRecorderRef } from "./audioRecorder";
import type { CopilotChatInputMode, ToolsMenuItem } from "./types";

defineOptions({ inheritAttrs: false });

type MenuEntry = ToolsMenuItem | "-";
type MenuDisplayEntry =
  | { type: "separator"; key: string }
  | { type: "label"; key: string; label: string; depth: number }
  | {
      type: "item";
      key: string;
      label: string;
      depth: number;
      action: () => void;
    };

const props = withDefaults(
  defineProps<{
    modelValue?: string;
    disabled?: boolean;
    placeholder?: string;
    autoFocus?: boolean;
    clearOnSubmit?: boolean;
    mode?: CopilotChatInputMode;
    toolsMenu?: MenuEntry[];
    isRunning?: boolean;
    positioning?: "static" | "absolute";
    keyboardHeight?: number;
    showDisclaimer?: boolean;
    /** The input grows to this many lines of text, then scrolls. */
    maxRows?: number;
    /**
     * How the text and the action buttons are arranged.
     *
     * - `"auto"` (default): a single row while the text fits on one line, so
     *   the input stays short. Once the text wraps it moves onto its own
     *   full-width row above the actions.
     * - `"stacked"`: always text on top, actions underneath.
     *
     * In either layout, very narrow inputs (under ~320px, e.g. a small popup)
     * fold voice input into the "+" menu so the actions fit.
     */
    layout?: "auto" | "stacked";
    /**
     * Set to `true` when the input sits at the bottom of its container as a
     * flex-last-child (visible position is driven by layout, not CSS
     * positioning). Triggers reservation of bottom space for the fixed
     * CopilotKit license banner via the
     * `--copilotkit-license-banner-offset` CSS var so the two don't overlap.
     *
     * Not needed when `positioning === "absolute"`; that mode already pins
     * the input to the bottom and picks up the same reservation
     * automatically. Leave unset (default `false`) for inputs rendered
     * mid-layout such as the welcome screen, where the banner offset would
     * push the input off-center.
     */
    bottomAnchored?: boolean;
    /**
     * Show lightweight markdown styling (lists, links, code, emphasis) as the
     * user types. Defaults to `true`; set `false` for plain text.
     */
    highlightMarkdown?: boolean;
    onSubmitMessage?: (value: string) => void;
    onStop?: () => void;
    onAddFile?: () => void;
    onStartTranscribe?: () => void;
    onCancelTranscribe?: () => void;
    onFinishTranscribe?: () => void;
    onFinishTranscribeWithAudio?: (audioBlob: Blob) => void | Promise<void>;
  }>(),
  {
    disabled: false,
    autoFocus: true,
    clearOnSubmit: true,
    mode: "input",
    toolsMenu: () => [],
    isRunning: false,
    positioning: "static",
    keyboardHeight: 0,
    showDisclaimer: undefined,
    maxRows: 8,
    layout: "auto",
    bottomAnchored: false,
    highlightMarkdown: true,
  },
);

const emit = defineEmits<{
  "update:modelValue": [value: string];
  "submit-message": [value: string];
  stop: [];
  "add-file": [];
  "start-transcribe": [];
  "cancel-transcribe": [];
  "finish-transcribe": [];
  "finish-transcribe-with-audio": [audioBlob: Blob];
}>();

const attrs = useAttrs();
const config = useCopilotChatConfiguration();
const shellRef = ref<HTMLElement | null>(null);
const textareaRef = ref<HTMLTextAreaElement | null>(null);
const previewRef = ref<HTMLElement | null>(null);

/** Renders the composer text with markdown styling for the preview layer. */
const MarkdownInputPreview = (previewProps: { text: string }) =>
  previewProps.text ? highlightMarkdownInput(previewProps.text) : null;

function syncPreviewScroll(event: Event) {
  if (previewRef.value) {
    previewRef.value.scrollTop = (
      event.target as HTMLTextAreaElement
    ).scrollTop;
  }
}
const gridRef = ref<HTMLElement | null>(null);
const addButtonContainerRef = ref<HTMLElement | null>(null);
const actionsContainerRef = ref<HTMLElement | null>(null);
const slashMenuRef = ref<HTMLElement | null>(null);
const addMenuRef = ref<HTMLElement | null>(null);
const audioRecorderRef = ref<CopilotChatAudioRecorderRef | null>(null);
const localValue = ref(props.modelValue ?? "");
const isComposing = ref(false);
// Shared by the textarea and its markdown preview layer so both lay out the
// text identically.
const textAreaClass = computed(() => [
  "cpk:w-full cpk:text-[16px] cpk:font-normal cpk:leading-6 cpk:antialiased",
  isExpanded.value ? "cpk:px-3 cpk:pt-1.5 cpk:pb-1" : "cpk:pr-3 cpk:py-2",
]);

// Secondary toolbar buttons ("+", voice input and its cancel/finish).
const toolbarSecondaryClass =
  "cpk:inline-flex cpk:size-9 cpk:shrink-0 cpk:items-center cpk:justify-center cpk:rounded-full cpk:cursor-pointer cpk:bg-transparent cpk:text-muted-foreground cpk:transition-colors cpk:hover:bg-accent cpk:hover:text-foreground cpk:disabled:cursor-not-allowed cpk:disabled:opacity-50 cpk:disabled:hover:bg-transparent";

/** Inputs narrower than this (px) fold voice input into the "+" menu. */
const NARROW_INPUT_WIDTH = 320;
const resolvedLayout = ref<"compact" | "expanded">("compact");
const isNarrow = ref(false);
const commandQuery = ref<string | null>(null);
const slashHighlightIndex = ref(0);
const previousCommandQuery = ref<string | null>(null);
const addMenuOpen = ref(false);
const measurements = ref({
  singleLineHeight: 0,
  maxHeight: 0,
  paddingLeft: 0,
  paddingRight: 0,
});
const resizeEvaluationRafRef = ref<number | null>(null);
const ignoreResizeRef = ref(false);
const measurementCanvasRef = ref<HTMLCanvasElement | null>(null);
const containerCacheRef = ref<{
  compactWidth: number;
} | null>(null);
const didWarnMissingFontRef = ref(false);
const didWarnMissingCanvasContextRef = ref(false);
let resizeObserver: ResizeObserver | null = null;
let documentPointerDownHandler: ((event: MouseEvent) => void) | null = null;

const isControlled = computed(() => props.modelValue !== undefined);
const inputValue = computed(() =>
  isControlled.value ? (props.modelValue ?? "") : localValue.value,
);
const labels = computed(() => config.value?.labels ?? CopilotChatDefaultLabels);
const resolvedPlaceholder = computed(
  () => props.placeholder ?? labels.value.chatInputPlaceholder,
);
const isExpanded = computed(
  () => props.mode === "input" && resolvedLayout.value === "expanded",
);
const isProcessing = computed(
  () => props.mode !== "transcribe" && props.isRunning,
);
const shouldShowDisclaimer = computed(
  () => props.showDisclaimer ?? props.positioning === "absolute",
);
const hasSubmitAction = computed(
  () => typeof props.onSubmitMessage === "function",
);
const hasStopAction = computed(() => typeof props.onStop === "function");
const hasAddFileAction = computed(() => typeof props.onAddFile === "function");
const hasStartTranscribeAction = computed(
  () => typeof props.onStartTranscribe === "function",
);
const hasCancelTranscribeAction = computed(
  () => typeof props.onCancelTranscribe === "function",
);
const hasFinishTranscribeAction = computed(
  () =>
    typeof props.onFinishTranscribe === "function" ||
    typeof props.onFinishTranscribeWithAudio === "function",
);
const canSend = computed(
  () =>
    props.mode === "input" &&
    !props.disabled &&
    hasSubmitAction.value &&
    inputValue.value.trim().length > 0,
);
const sendDisabled = computed(() =>
  isProcessing.value ? !hasStopAction.value : !canSend.value,
);

const containerClass = computed(() => [
  props.positioning === "absolute" &&
    "cpk:absolute cpk:bottom-0 cpk:left-0 cpk:right-0 cpk:z-20 cpk:pointer-events-none",
  attrs.class,
]);

const rootAttrs = computed(() => {
  const rest = { ...attrs };
  delete rest.class;
  return rest;
});

function isMenuGroup(
  item: ToolsMenuItem,
): item is ToolsMenuItem & { items: MenuEntry[] } {
  return Array.isArray((item as ToolsMenuItem).items);
}

function createDefaultAddItem(): ToolsMenuItem | null {
  if (!hasAddFileAction.value) {
    return null;
  }
  return {
    label: labels.value.chatInputToolbarAddButtonLabel,
    action: () => emit("add-file"),
  };
}

function normalizeMenuItems(tools: MenuEntry[]) {
  const items: MenuEntry[] = [];
  const addItem = createDefaultAddItem();
  if (addItem) {
    items.push(addItem);
  }

  if (tools.length > 0) {
    if (items.length > 0) {
      items.push("-");
    }

    for (const menuEntry of tools) {
      if (menuEntry === "-") {
        if (items.length === 0 || items[items.length - 1] === "-") {
          continue;
        }
        items.push("-");
        continue;
      }

      items.push(menuEntry);
    }
  }

  while (items.length > 0 && items[items.length - 1] === "-") {
    items.pop();
  }

  return items;
}

const menuItems = computed(() => normalizeMenuItems(props.toolsMenu));

// Narrow inputs move voice input from the toolbar into the "+" menu.
const foldTranscribe = computed(
  () => isNarrow.value && hasStartTranscribeAction.value,
);
const addMenuItems = computed(() => {
  if (!foldTranscribe.value) return menuItems.value;
  const transcribe: ToolsMenuItem = {
    label: labels.value.chatInputToolbarStartTranscribeButtonLabel,
    action: () => emit("start-transcribe"),
  };
  return normalizeMenuItems(
    props.toolsMenu.length > 0
      ? [transcribe, "-", ...props.toolsMenu]
      : [transcribe],
  );
});
const hasMenuItems = computed(() => addMenuItems.value.length > 0);

function flattenMenuForCommands(items: MenuEntry[]) {
  const seen = new Set<string>();
  const commands: ToolsMenuItem[] = [];

  const walk = (entryList: MenuEntry[]) => {
    for (const entry of entryList) {
      if (entry === "-") {
        continue;
      }

      if (isMenuGroup(entry) && entry.items.length > 0) {
        walk(entry.items);
        continue;
      }

      if (!entry.action || seen.has(entry.label)) {
        continue;
      }

      seen.add(entry.label);
      commands.push(entry);
    }
  };

  walk(items);
  return commands;
}

const commandItems = computed(() => flattenMenuForCommands(menuItems.value));

function flattenMenuDisplay(items: MenuEntry[], depth = 0, prefix = "root") {
  const entries: MenuDisplayEntry[] = [];
  for (const [index, item] of items.entries()) {
    const key = `${prefix}-${index}`;
    if (item === "-") {
      entries.push({ type: "separator", key: `sep-${key}` });
      continue;
    }
    if (isMenuGroup(item) && item.items.length > 0) {
      entries.push({
        type: "label",
        key: `label-${key}`,
        label: item.label,
        depth,
      });
      entries.push(...flattenMenuDisplay(item.items, depth + 1, key));
      continue;
    }
    if (item.action) {
      entries.push({
        type: "item",
        key: `item-${key}`,
        label: item.label,
        depth,
        action: item.action,
      });
    }
  }
  return entries;
}

const menuDisplayItems = computed(() => flattenMenuDisplay(addMenuItems.value));

const filteredCommands = computed(() => {
  if (commandQuery.value === null || commandItems.value.length === 0) {
    return [] as ToolsMenuItem[];
  }

  const normalized = commandQuery.value.trim().toLowerCase();
  if (normalized.length === 0) {
    return commandItems.value;
  }

  const startsWith: ToolsMenuItem[] = [];
  const contains: ToolsMenuItem[] = [];

  for (const command of commandItems.value) {
    const label = command.label.toLowerCase();
    if (label.startsWith(normalized)) {
      startsWith.push(command);
      continue;
    }
    if (label.includes(normalized)) {
      contains.push(command);
    }
  }

  return [...startsWith, ...contains];
});

const slashMenuVisible = computed(
  () => commandQuery.value !== null && commandItems.value.length > 0,
);

function updateInputValue(nextValue: string) {
  if (!isControlled.value) {
    localValue.value = nextValue;
  }
  emit("update:modelValue", nextValue);
}

function clearInputValue() {
  updateInputValue("");
}

function updateSlashState(value: string) {
  if (commandItems.value.length === 0) {
    commandQuery.value = null;
    return;
  }

  if (value.startsWith("/")) {
    const firstLine = value.split(/\r?\n/, 1)[0] ?? "";
    commandQuery.value = firstLine.slice(1);
    return;
  }

  commandQuery.value = null;
}

function runCommand(command: ToolsMenuItem) {
  clearInputValue();
  command.action?.();
  commandQuery.value = null;
  slashHighlightIndex.value = 0;
  requestAnimationFrame(() => {
    textareaRef.value?.focus();
  });
}

function submit() {
  if (props.mode !== "input" || props.disabled || !hasSubmitAction.value) {
    return;
  }
  // In controlled mode, parent-updated modelValue can lag one tick behind
  // the actual textarea value during intense runtime/connect churn.
  const rawValue = textareaRef.value?.value ?? inputValue.value;
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return;
  }

  emit("submit-message", trimmed);

  if (props.clearOnSubmit) {
    clearInputValue();
  }

  textareaRef.value?.focus();
}

function handleInput(event: Event) {
  const nextValue = (event.target as HTMLTextAreaElement).value;
  updateInputValue(nextValue);
  updateSlashState(nextValue);
}

function handleSendButtonClick() {
  if (isProcessing.value) {
    if (hasStopAction.value) {
      emit("stop");
    }
    return;
  }
  submit();
}

function handleKeydown(event: KeyboardEvent) {
  if (props.disabled) {
    return;
  }

  if (isComposing.value || event.isComposing || event.keyCode === 229) {
    return;
  }

  if (commandQuery.value !== null && props.mode === "input") {
    if (event.key === "ArrowDown") {
      if (filteredCommands.value.length > 0) {
        event.preventDefault();
        slashHighlightIndex.value =
          slashHighlightIndex.value < 0
            ? 0
            : (slashHighlightIndex.value + 1) % filteredCommands.value.length;
      }
      return;
    }

    if (event.key === "ArrowUp") {
      if (filteredCommands.value.length > 0) {
        event.preventDefault();
        if (slashHighlightIndex.value < 0) {
          slashHighlightIndex.value = filteredCommands.value.length - 1;
        } else {
          slashHighlightIndex.value =
            slashHighlightIndex.value <= 0
              ? filteredCommands.value.length - 1
              : slashHighlightIndex.value - 1;
        }
      }
      return;
    }

    if (event.key === "Enter") {
      const selected =
        slashHighlightIndex.value >= 0
          ? filteredCommands.value[slashHighlightIndex.value]
          : undefined;
      if (selected) {
        event.preventDefault();
        runCommand(selected);
        return;
      }
    }

    if (event.key === "Escape") {
      event.preventDefault();
      commandQuery.value = null;
      return;
    }
  }

  if (event.key === "Enter" && !event.shiftKey && props.mode === "input") {
    event.preventDefault();
    if (isProcessing.value) {
      if (hasStopAction.value) {
        emit("stop");
      }
      return;
    }
    submit();
  }
}

function toggleAddMenu() {
  if (!hasMenuItems.value || props.mode === "transcribe" || props.disabled) {
    return;
  }
  addMenuOpen.value = !addMenuOpen.value;
}

function closeAddMenu() {
  addMenuOpen.value = false;
}

function handleMenuAction(action: () => void) {
  action();
  closeAddMenu();
  nextTick(() => {
    textareaRef.value?.focus();
  });
}

async function handleFinishTranscribe() {
  const recorder = audioRecorderRef.value;
  if (recorder && recorder.state === "recording") {
    try {
      const blob = await recorder.stop();
      emit("finish-transcribe-with-audio", blob);
    } catch (error) {
      console.error("Failed to stop recording:", error);
    }
  }
  emit("finish-transcribe");
}

function handleContainerClick(event: MouseEvent) {
  const target = event.target as HTMLElement | null;
  if (!target || props.mode !== "input") {
    return;
  }
  if (target.tagName === "BUTTON" || target.closest("button")) {
    return;
  }
  textareaRef.value?.focus();
}

function ensureMeasurements() {
  const textarea = textareaRef.value;
  if (!textarea || isComposing.value) {
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

  // An empty textarea's scroll height is exactly one line.
  const previousPlaceholder = textarea.placeholder;
  textarea.value = "";
  textarea.placeholder = "";
  const singleLineHeight = textarea.scrollHeight;
  textarea.value = previousValue;
  textarea.placeholder = previousPlaceholder;

  const contentHeight = singleLineHeight - paddingTop - paddingBottom;
  const maxHeight = contentHeight * props.maxRows + paddingTop + paddingBottom;

  measurements.value = {
    singleLineHeight,
    maxHeight,
    paddingLeft,
    paddingRight,
  };

  textarea.style.height = previousHeight;
  textarea.style.maxHeight = `${maxHeight}px`;
}

function adjustTextareaHeight() {
  const textarea = textareaRef.value;
  if (!textarea) {
    return 0;
  }

  if (measurements.value.singleLineHeight === 0) {
    ensureMeasurements();
  }

  const { maxHeight } = measurements.value;
  if (maxHeight) {
    textarea.style.maxHeight = `${maxHeight}px`;
  }

  textarea.style.height = "auto";
  const scrollHeight = textarea.scrollHeight;
  textarea.style.height = `${maxHeight ? Math.min(scrollHeight, maxHeight) : scrollHeight}px`;
  return scrollHeight;
}

function updateLayout(nextLayout: "compact" | "expanded") {
  if (resolvedLayout.value === nextLayout) {
    return;
  }
  ignoreResizeRef.value = true;
  resolvedLayout.value = nextLayout;
}

function resolveTextareaFont(textarea: HTMLTextAreaElement): string | null {
  const textareaStyles = window.getComputedStyle(textarea);
  if (textareaStyles.font?.trim()) {
    return textareaStyles.font;
  }

  if (textareaStyles.fontSize && textareaStyles.fontFamily) {
    const fallbackFont =
      `${textareaStyles.fontStyle} ${textareaStyles.fontVariant} ` +
      `${textareaStyles.fontWeight} ${textareaStyles.fontSize}/${textareaStyles.lineHeight} ` +
      `${textareaStyles.fontFamily}`;
    if (fallbackFont.trim()) {
      return fallbackFont;
    }
  }

  if (process.env.NODE_ENV !== "production" && !didWarnMissingFontRef.value) {
    didWarnMissingFontRef.value = true;
    console.warn(
      "[CopilotChatInput] Could not resolve textarea font for layout measurement. " +
        "Text-width-based expansion will be skipped until the next container resize.",
    );
  }
  return null;
}

function updateContainerCache() {
  const grid = gridRef.value;
  const addContainer = addButtonContainerRef.value;
  const actionsContainer = actionsContainerRef.value;
  if (!grid || !addContainer || !actionsContainer) {
    containerCacheRef.value = null;
    return null;
  }

  const gridStyles = window.getComputedStyle(grid);
  const paddingLeft = parseFloat(gridStyles.paddingLeft) || 0;
  const paddingRight = parseFloat(gridStyles.paddingRight) || 0;
  const columnGap = parseFloat(gridStyles.columnGap) || 0;
  const gridAvailableWidth = grid.clientWidth - paddingLeft - paddingRight;
  if (gridAvailableWidth <= 0) {
    containerCacheRef.value = null;
    return null;
  }

  const addWidth = addContainer.getBoundingClientRect().width;
  const actionsWidth = actionsContainer.getBoundingClientRect().width;
  const compactWidth = Math.max(
    gridAvailableWidth - addWidth - actionsWidth - columnGap * 2,
    0,
  );
  if (compactWidth <= 0) {
    containerCacheRef.value = null;
    return null;
  }

  const cache = { compactWidth };
  containerCacheRef.value = cache;
  return cache;
}

function evaluateLayout() {
  if (props.mode !== "input") {
    updateLayout("compact");
    return;
  }

  const textarea = textareaRef.value;
  const grid = gridRef.value;
  if (
    !textarea ||
    !grid ||
    !addButtonContainerRef.value ||
    !actionsContainerRef.value
  ) {
    return;
  }

  // Sized by the input's own width (not the viewport), so a narrow popup or
  // sidebar on a wide screen adapts the same way a phone does.
  isNarrow.value =
    grid.clientWidth > 0 && grid.clientWidth < NARROW_INPUT_WIDTH;

  if (props.layout === "stacked") {
    adjustTextareaHeight();
    updateLayout("expanded");
    return;
  }

  if (measurements.value.singleLineHeight === 0) {
    ensureMeasurements();
  }

  const scrollHeight = adjustTextareaHeight();
  const baseline = measurements.value.singleLineHeight;
  const hasExplicitBreak = inputValue.value.includes("\n");
  const renderedMultiline = baseline > 0 ? scrollHeight > baseline + 1 : false;
  let shouldExpand = hasExplicitBreak || renderedMultiline;

  if (!shouldExpand) {
    const cache = containerCacheRef.value ?? updateContainerCache();
    if (cache && cache.compactWidth > 0) {
      const compactInnerWidth = Math.max(
        cache.compactWidth -
          measurements.value.paddingLeft -
          measurements.value.paddingRight,
        0,
      );

      if (compactInnerWidth > 0) {
        const canvas =
          measurementCanvasRef.value ?? document.createElement("canvas");
        if (!measurementCanvasRef.value) {
          measurementCanvasRef.value = canvas;
        }

        const context = canvas.getContext("2d");
        if (context) {
          const resolvedFont = resolveTextareaFont(textarea);
          if (resolvedFont) {
            context.font = resolvedFont;
            const lines =
              inputValue.value.length > 0 ? inputValue.value.split("\n") : [""];
            let longestLine = 0;
            for (const line of lines) {
              const width = context.measureText(line || " ").width;
              if (width > longestLine) {
                longestLine = width;
              }
            }
            if (longestLine > compactInnerWidth) {
              shouldExpand = true;
            }
          }
        } else if (
          process.env.NODE_ENV !== "production" &&
          !didWarnMissingCanvasContextRef.value
        ) {
          didWarnMissingCanvasContextRef.value = true;
          console.warn(
            "[CopilotChatInput] canvas.getContext('2d') returned null. " +
              "Text-width-based expansion will be skipped.",
          );
        }
      }
    }
  }

  updateLayout(shouldExpand ? "expanded" : "compact");
}

function scheduleLayoutEvaluation(invalidateCache: boolean) {
  if (ignoreResizeRef.value) {
    ignoreResizeRef.value = false;
    return;
  }

  if (invalidateCache) {
    containerCacheRef.value = null;
    didWarnMissingFontRef.value = false;
    didWarnMissingCanvasContextRef.value = false;
  }

  if (resizeEvaluationRafRef.value !== null) {
    cancelAnimationFrame(resizeEvaluationRafRef.value);
  }

  resizeEvaluationRafRef.value = requestAnimationFrame(() => {
    resizeEvaluationRafRef.value = null;
    evaluateLayout();
  });
}

watch(
  () => props.modelValue,
  (next) => {
    if (isControlled.value) {
      localValue.value = next ?? "";
    }
  },
);

watch(inputValue, (value) => {
  updateSlashState(value);
  evaluateLayout();
});

// Switching layouts changes the textarea's width, so its line count (and
// height) can change too.
watch(resolvedLayout, async () => {
  await nextTick();
  adjustTextareaHeight();
});

watch(
  () => props.layout,
  () => evaluateLayout(),
);

watch(commandItems, () => {
  if (commandItems.value.length === 0) {
    commandQuery.value = null;
  }
});

watch(
  [commandQuery, () => filteredCommands.value.length],
  ([query, filteredCount]) => {
    if (
      query !== null &&
      query !== previousCommandQuery.value &&
      filteredCount > 0
    ) {
      slashHighlightIndex.value = 0;
    }

    previousCommandQuery.value = query;
  },
  { immediate: true },
);

watch(
  [commandQuery, filteredCommands],
  () => {
    if (commandQuery.value === null) {
      slashHighlightIndex.value = 0;
      return;
    }
    if (filteredCommands.value.length === 0) {
      slashHighlightIndex.value = -1;
      return;
    }
    if (
      slashHighlightIndex.value < 0 ||
      slashHighlightIndex.value >= filteredCommands.value.length
    ) {
      slashHighlightIndex.value = 0;
    }
  },
  { immediate: true },
);

watch(
  () => props.mode,
  async (mode) => {
    if (mode !== "input") {
      resolvedLayout.value = "compact";
      commandQuery.value = null;
      closeAddMenu();
    }

    const recorder = audioRecorderRef.value;
    if (!recorder) {
      return;
    }

    if (mode === "transcribe") {
      try {
        await recorder.start();
      } catch (error) {
        console.error(error);
      }
      return;
    }

    if (recorder.state === "recording") {
      try {
        await recorder.stop();
      } catch {
        // ignore transition stop failures
      }
    }
  },
  { immediate: true },
);

watch(
  audioRecorderRef,
  async (recorder) => {
    if (!recorder || props.mode !== "transcribe") {
      return;
    }
    if (recorder.state === "idle") {
      try {
        await recorder.start();
      } catch (error) {
        console.error(error);
      }
    }
  },
  { immediate: true },
);

watch(slashHighlightIndex, async (index) => {
  if (!slashMenuVisible.value || index < 0) {
    return;
  }
  await nextTick();
  const active = slashMenuRef.value?.querySelector<HTMLElement>(
    `[data-slash-index="${index}"]`,
  );
  active?.scrollIntoView?.({ block: "nearest" });
});

watch(
  () => props.disabled,
  (disabled) => {
    if (disabled) {
      closeAddMenu();
    }
  },
);

onMounted(() => {
  if (props.autoFocus && props.mode === "input") {
    textareaRef.value?.focus();
  }

  evaluateLayout();

  if (typeof ResizeObserver !== "undefined") {
    const containerTargets = new Set<HTMLElement>();
    if (gridRef.value) containerTargets.add(gridRef.value);
    if (addButtonContainerRef.value)
      containerTargets.add(addButtonContainerRef.value);
    if (actionsContainerRef.value)
      containerTargets.add(actionsContainerRef.value);

    resizeObserver = new ResizeObserver((entries) => {
      const shouldInvalidate = entries.some((entry) =>
        containerTargets.has(entry.target as HTMLElement),
      );
      scheduleLayoutEvaluation(shouldInvalidate);
    });

    if (gridRef.value) resizeObserver.observe(gridRef.value);
    if (addButtonContainerRef.value)
      resizeObserver.observe(addButtonContainerRef.value);
    if (actionsContainerRef.value)
      resizeObserver.observe(actionsContainerRef.value);
    if (textareaRef.value) resizeObserver.observe(textareaRef.value);
  }

  documentPointerDownHandler = (event: MouseEvent) => {
    if (!addMenuOpen.value) {
      return;
    }
    const target = event.target as Node | null;
    if (!target) {
      return;
    }
    if (
      addMenuRef.value?.contains(target) ||
      addButtonContainerRef.value?.contains(target)
    ) {
      return;
    }
    closeAddMenu();
  };

  document.addEventListener("mousedown", documentPointerDownHandler);
});

onBeforeUnmount(() => {
  if (documentPointerDownHandler) {
    document.removeEventListener("mousedown", documentPointerDownHandler);
    documentPointerDownHandler = null;
  }
  resizeObserver?.disconnect();
  resizeObserver = null;
  if (resizeEvaluationRafRef.value !== null) {
    cancelAnimationFrame(resizeEvaluationRafRef.value);
    resizeEvaluationRafRef.value = null;
  }
});
</script>

<template>
  <div
    data-copilotkit
    data-testid="copilot-chat-input-container"
    :class="containerClass"
    :style="{
      transform:
        keyboardHeight > 0 ? `translateY(-${keyboardHeight}px)` : undefined,
      transition: 'transform 0.2s ease-out',
      ...(positioning === 'absolute' || bottomAnchored
        ? { paddingBottom: 'var(--copilotkit-license-banner-offset, 0px)' }
        : {}),
    }"
    v-bind="rootAttrs"
  >
    <div
      class="cpk:pointer-events-auto cpk:mx-auto cpk:max-w-3xl cpk:px-4 cpk:py-0 cpk:@3xl:px-0 cpk:[div[data-sidebar-chat]_&]:px-8 cpk:[div[data-popup-chat]_&]:px-4"
    >
      <slot
        name="layout"
        :mode="mode"
        :is-multiline="isExpanded"
        :value="inputValue"
        :disabled="disabled"
        :placeholder="resolvedPlaceholder"
        :is-processing="isProcessing"
        :send-disabled="sendDisabled"
        :menu-open="addMenuOpen"
        :menu-items="menuDisplayItems"
        :on-toggle-menu="toggleAddMenu"
        :on-menu-action="handleMenuAction"
        :on-update-value="updateInputValue"
        :on-submit="submit"
        :on-keydown="handleKeydown"
        :on-send-click="handleSendButtonClick"
        :on-start-transcribe="() => emit('start-transcribe')"
        :on-cancel-transcribe="() => emit('cancel-transcribe')"
        :on-finish-transcribe="handleFinishTranscribe"
      >
        <div
          ref="shellRef"
          data-testid="copilot-chat-input-shell"
          :class="[
            'cpk:flex cpk:w-full cpk:cursor-text cpk:flex-col cpk:items-center cpk:justify-center',
            'cpk:overflow-visible cpk:bg-clip-padding cpk:contain-inline-size',
            // Surface
            'cpk:rounded-3xl cpk:border cpk:border-input cpk:bg-card',
            'cpk:shadow-[0_1px_2px_0_rgb(0_0_0/0.04),0_6px_20px_-8px_rgb(0_0_0/0.10)]',
            // Focus: the border firms up rather than drawing a ring around the pill
            'cpk:transition-[border-color,box-shadow] cpk:duration-200',
            'cpk:focus-within:border-foreground/20',
          ]"
          :data-layout="isExpanded ? 'expanded' : 'compact'"
          @click="handleContainerClick"
        >
          <div
            ref="gridRef"
            :class="[
              'cpk:grid cpk:w-full cpk:gap-x-2 cpk:px-2.5',
              isExpanded ? 'cpk:py-1.5' : 'cpk:py-2',
              isExpanded
                ? 'cpk:grid-cols-[auto_minmax(0,1fr)_auto] cpk:grid-rows-[auto_auto]'
                : 'cpk:grid-cols-[auto_minmax(0,1fr)_auto] cpk:items-center',
            ]"
            :data-layout="isExpanded ? 'expanded' : 'compact'"
          >
            <div
              ref="addButtonContainerRef"
              :class="[
                'cpk:relative cpk:flex cpk:items-center cpk:col-start-1',
                // Stacked, the action row uses slightly smaller buttons to
                // keep the input short.
                isExpanded
                  ? 'cpk:row-start-2 cpk:[&_button]:size-8'
                  : 'cpk:row-start-1',
              ]"
            >
              <slot
                name="add-menu-button"
                :disabled="disabled || mode === 'transcribe' || !hasMenuItems"
                :menu-open="addMenuOpen"
                :toggle-menu="toggleAddMenu"
                :labels="labels"
              >
                <button
                  type="button"
                  data-testid="copilot-chat-input-add"
                  :aria-label="labels.chatInputToolbarAddButtonLabel"
                  :disabled="disabled || mode === 'transcribe' || !hasMenuItems"
                  :class="toolbarSecondaryClass"
                  @click.stop="toggleAddMenu"
                >
                  <IconPlus class="cpk:size-[20px]" />
                </button>
              </slot>

              <div
                v-if="addMenuOpen && hasMenuItems"
                ref="addMenuRef"
                class="cpk:absolute cpk:bottom-full cpk:left-0 cpk:z-30 cpk:mb-2 cpk:min-w-[220px] cpk:overflow-hidden cpk:rounded-xl cpk:border cpk:border-border cpk:bg-popover cpk:p-1 cpk:text-popover-foreground cpk:shadow-lg"
                data-testid="copilot-chat-input-add-menu"
              >
                <template v-for="entry in menuDisplayItems" :key="entry.key">
                  <div
                    v-if="entry.type === 'separator'"
                    class="cpk:-mx-1 cpk:my-1 cpk:h-px cpk:bg-border"
                  />
                  <div
                    v-else-if="entry.type === 'label'"
                    class="cpk:flex cpk:items-center cpk:gap-1 cpk:px-2.5 cpk:py-1.5 cpk:text-xs cpk:font-semibold cpk:text-muted-foreground"
                    :style="{ paddingLeft: `${10 + entry.depth * 12}px` }"
                  >
                    <span>{{ entry.label }}</span>
                    <IconChevronRight class="cpk:size-3" />
                  </div>
                  <button
                    v-else
                    type="button"
                    role="menuitem"
                    class="cpk:w-full cpk:cursor-pointer cpk:rounded-lg cpk:px-2.5 cpk:py-1.5 cpk:text-left cpk:text-sm cpk:transition-colors cpk:hover:bg-accent"
                    :style="{ paddingLeft: `${10 + entry.depth * 12}px` }"
                    @click="handleMenuAction(entry.action)"
                  >
                    {{ entry.label }}
                  </button>
                </template>
              </div>
            </div>

            <div
              :class="[
                'cpk:relative cpk:flex cpk:min-h-10 cpk:min-w-0 cpk:flex-col cpk:justify-center',
                isExpanded
                  ? 'cpk:col-span-3 cpk:row-start-1 cpk:min-h-0'
                  : 'cpk:col-start-2 cpk:row-start-1',
              ]"
            >
              <template v-if="mode === 'transcribe'">
                <slot name="audio-recorder">
                  <CopilotChatAudioRecorder ref="audioRecorderRef" />
                </slot>
              </template>
              <template v-else-if="mode === 'processing'">
                <div
                  class="cpk:flex cpk:w-full cpk:items-center cpk:justify-center cpk:px-3 cpk:py-2"
                >
                  <IconLoader2
                    class="cpk:size-5 cpk:animate-spin cpk:text-muted-foreground"
                  />
                </div>
              </template>
              <template v-else>
                <slot
                  name="text-area"
                  :value="inputValue"
                  :disabled="disabled"
                  :placeholder="resolvedPlaceholder"
                  :on-input="handleInput"
                  :on-keydown="handleKeydown"
                  :auto-focus="autoFocus"
                  :is-expanded="isExpanded"
                  :rows="1"
                  :labels="labels"
                >
                  <!--
                    The textarea's own text is transparent; this layer
                    underneath draws the same characters with markdown styling.
                    Same typography and padding as the textarea so they align.
                  -->
                  <div
                    v-if="highlightMarkdown"
                    ref="previewRef"
                    aria-hidden="true"
                    data-testid="copilot-chat-input-textarea-preview"
                    :class="[
                      textAreaClass,
                      'cpk-md-preview cpk:pointer-events-none cpk:absolute cpk:inset-0 cpk:overflow-hidden cpk:whitespace-pre-wrap cpk:break-words cpk:text-foreground',
                    ]"
                  >
                    <MarkdownInputPreview :text="inputValue" />
                  </div>
                  <textarea
                    ref="textareaRef"
                    data-testid="copilot-chat-input-textarea"
                    :value="inputValue"
                    :placeholder="resolvedPlaceholder"
                    :disabled="disabled"
                    rows="1"
                    :class="[
                      textAreaClass,
                      'cpk:bg-transparent cpk:outline-none cpk:placeholder:text-muted-foreground cpk:placeholder:truncate',
                      // With the preview, the textarea only draws the caret,
                      // selection and placeholder; its glyphs are transparent.
                      highlightMarkdown
                        ? 'cpk:relative cpk:text-transparent cpk:caret-foreground cpk:[scrollbar-width:none] cpk:[&::-webkit-scrollbar]:hidden'
                        : 'cpk:text-foreground',
                    ]"
                    style="overflow: auto; resize: none"
                    @scroll="syncPreviewScroll"
                    @input="handleInput"
                    @keydown="handleKeydown"
                    @compositionstart="isComposing = true"
                    @compositionend="isComposing = false"
                  />
                </slot>

                <div
                  v-if="slashMenuVisible"
                  ref="slashMenuRef"
                  data-testid="copilot-slash-menu"
                  role="listbox"
                  aria-label="Slash commands"
                  class="cpk:absolute cpk:bottom-full cpk:left-0 cpk:right-0 cpk:z-30 cpk:mb-2 cpk:max-h-64 cpk:overflow-y-auto cpk:rounded-2xl cpk:border cpk:border-border cpk:bg-popover cpk:p-1 cpk:text-popover-foreground cpk:shadow-lg"
                  :style="{ maxHeight: `${5 * 40}px` }"
                >
                  <div
                    v-if="filteredCommands.length === 0"
                    class="cpk:px-3 cpk:py-2 cpk:text-sm cpk:text-muted-foreground"
                  >
                    No commands found
                  </div>
                  <button
                    v-for="(command, index) in filteredCommands"
                    v-else
                    :key="`${command.label}-${index}`"
                    type="button"
                    role="option"
                    :data-slash-index="index"
                    :aria-selected="index === slashHighlightIndex"
                    :data-active="
                      index === slashHighlightIndex ? 'true' : undefined
                    "
                    :class="[
                      'cpk:w-full cpk:rounded-xl cpk:px-3 cpk:py-2.5 cpk:text-left cpk:text-sm cpk:transition-colors cpk:hover:bg-accent',
                      index === slashHighlightIndex
                        ? 'cpk:bg-accent'
                        : 'cpk:bg-transparent',
                    ]"
                    @mouseenter="slashHighlightIndex = index"
                    @mousedown.prevent="runCommand(command)"
                  >
                    {{ command.label }}
                  </button>
                </div>
              </template>
            </div>

            <div
              ref="actionsContainerRef"
              :class="[
                'cpk:flex cpk:items-center cpk:justify-end cpk:gap-1',
                isExpanded
                  ? 'cpk:col-start-3 cpk:row-start-2 cpk:[&_button]:size-8'
                  : 'cpk:col-start-3 cpk:row-start-1',
              ]"
            >
              <template v-if="mode === 'transcribe'">
                <slot
                  v-if="
                    hasCancelTranscribeAction ||
                    $slots['cancel-transcribe-button']
                  "
                  name="cancel-transcribe-button"
                  :disabled="disabled"
                  :on-click="() => emit('cancel-transcribe')"
                  :labels="labels"
                >
                  <button
                    type="button"
                    data-testid="copilot-chat-input-cancel-transcribe"
                    :aria-label="
                      labels.chatInputToolbarCancelTranscribeButtonLabel
                    "
                    :disabled="disabled"
                    :class="toolbarSecondaryClass"
                    @click="emit('cancel-transcribe')"
                  >
                    <IconX class="cpk:size-[18px]" />
                  </button>
                </slot>
                <slot
                  v-if="
                    hasFinishTranscribeAction ||
                    $slots['finish-transcribe-button']
                  "
                  name="finish-transcribe-button"
                  :disabled="disabled"
                  :on-click="handleFinishTranscribe"
                  :labels="labels"
                >
                  <button
                    type="button"
                    data-testid="copilot-chat-input-finish-transcribe"
                    :aria-label="
                      labels.chatInputToolbarFinishTranscribeButtonLabel
                    "
                    :disabled="disabled"
                    :class="toolbarSecondaryClass"
                    @click="handleFinishTranscribe"
                  >
                    <IconCheck class="cpk:size-[18px]" />
                  </button>
                </slot>
              </template>
              <template v-else>
                <slot
                  v-if="
                    (hasStartTranscribeAction && !foldTranscribe) ||
                    $slots['start-transcribe-button']
                  "
                  name="start-transcribe-button"
                  :disabled="disabled"
                  :on-click="() => emit('start-transcribe')"
                  :labels="labels"
                >
                  <button
                    type="button"
                    data-testid="copilot-chat-input-start-transcribe"
                    :aria-label="
                      labels.chatInputToolbarStartTranscribeButtonLabel
                    "
                    :disabled="disabled"
                    :class="toolbarSecondaryClass"
                    @click="emit('start-transcribe')"
                  >
                    <IconMic class="cpk:size-[18px]" />
                  </button>
                </slot>
                <slot
                  name="send-button"
                  :disabled="sendDisabled"
                  :is-processing="isProcessing"
                  :on-click="handleSendButtonClick"
                >
                  <div>
                    <button
                      type="button"
                      data-testid="copilot-chat-input-send"
                      aria-label="Send message"
                      :disabled="sendDisabled"
                      class="cpk:inline-flex cpk:size-9 cpk:shrink-0 cpk:items-center cpk:justify-center cpk:rounded-full cpk:cursor-pointer cpk:bg-primary cpk:text-primary-foreground cpk:transition-[background-color,transform] cpk:hover:bg-primary/85 cpk:active:scale-95 cpk:disabled:cursor-not-allowed cpk:disabled:bg-foreground/10 cpk:disabled:text-foreground/40"
                      @click="handleSendButtonClick"
                    >
                      <IconSquare
                        v-if="isProcessing && hasStopAction"
                        class="cpk:size-3.5 cpk:fill-current"
                      />
                      <IconArrowUp
                        v-else
                        class="cpk:size-[18px]"
                        :stroke-width="2.25"
                      />
                    </button>
                  </div>
                </slot>
              </template>
            </div>
          </div>
        </div>
      </slot>
    </div>

    <slot v-if="shouldShowDisclaimer" name="disclaimer" :labels="labels">
      <p
        data-testid="copilot-chat-input-disclaimer"
        class="cpk:mx-auto cpk:max-w-3xl cpk:px-4 cpk:py-3 cpk:text-center cpk:text-xs cpk:text-muted-foreground"
      >
        {{ labels.chatDisclaimerText }}
      </p>
    </slot>
  </div>
</template>
