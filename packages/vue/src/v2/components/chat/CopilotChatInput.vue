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
import { ɵcomposerButtonState, ɵresolveComposerKey } from "@copilotkit/core";
import {
  IconArrowUp,
  IconCheck,
  IconLoader2,
  IconMic,
  IconPlus,
  IconSquare,
  IconX,
} from "../icons";
import CopilotChatAudioRecorder from "./CopilotChatAudioRecorder.vue";
import CopilotTooltip from "../ui/CopilotTooltip.vue";
import CopilotDropdownMenuContent from "../ui/CopilotDropdownMenuContent.vue";
import type {
  CopilotDropdownMenuDismissReason,
  CopilotDropdownMenuItem,
} from "../ui/dropdown-menu";
import { useCopilotId } from "../ui/use-id";
import type { CopilotChatAudioRecorderRef } from "./audioRecorder";
import type { CopilotChatInputMode, ToolsMenuItem } from "./types";
import { useChatLabels } from "./use-chat-labels";

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
    maxRows?: number;
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
    maxRows: 5,
    bottomAnchored: false,
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
const shellRef = ref<HTMLElement | null>(null);
const textareaRef = ref<HTMLTextAreaElement | null>(null);
const gridRef = ref<HTMLElement | null>(null);
const addButtonContainerRef = ref<HTMLElement | null>(null);
const actionsContainerRef = ref<HTMLElement | null>(null);
const slashMenuRef = ref<HTMLElement | null>(null);
const audioRecorderRef = ref<CopilotChatAudioRecorderRef | null>(null);
const localValue = ref(props.modelValue ?? "");
const isComposing = ref(false);
const layout = ref<"compact" | "expanded">("compact");
const commandQuery = ref<string | null>(null);
const slashHighlightIndex = ref(0);
const previousCommandQuery = ref<string | null>(null);
const addMenuOpen = ref(false);
// Where focus goes as the add menu opens: its first or last item for the
// keyboard, the menu itself for a pointer, as Radix's DropdownMenu does.
const addMenuInitialFocus = ref<"first" | "last" | "content">("content");
const addMenuAnchor = ref<HTMLElement | null>(null);
const addMenuId = useCopilotId("cpk-add-menu");
const addMenuTriggerId = `${addMenuId}-trigger`;
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

const isControlled = computed(() => props.modelValue !== undefined);
const inputValue = computed(() =>
  isControlled.value ? (props.modelValue ?? "") : localValue.value,
);
const labels = useChatLabels();
const resolvedPlaceholder = computed(
  () => props.placeholder ?? labels.value.chatInputPlaceholder,
);
const isExpanded = computed(
  () => props.mode === "input" && layout.value === "expanded",
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
const composerInput = computed(() => ({
  mode: props.mode,
  isRunning: props.isRunning,
  value: inputValue.value,
  canSubmit: hasSubmitAction.value,
  canStop: hasStopAction.value,
  disabled: props.disabled,
}));
const composerButton = computed(() =>
  ɵcomposerButtonState(composerInput.value),
);
const isProcessing = computed(() => composerButton.value.isProcessing);
const sendDisabled = computed(() => composerButton.value.disabled);
const showsStop = computed(() => composerButton.value.action === "stop");

const containerClass = computed(() => [
  "cpk-chat-input",
  props.positioning === "absolute" && "cpk-chat-input-absolute",
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

function normalizeMenuItems() {
  const items: MenuEntry[] = [];
  const addItem = createDefaultAddItem();
  if (addItem) {
    items.push(addItem);
  }

  if (props.toolsMenu.length > 0) {
    if (items.length > 0) {
      items.push("-");
    }

    for (const menuEntry of props.toolsMenu) {
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

const menuItems = computed(() => normalizeMenuItems());
const hasMenuItems = computed(() => menuItems.value.length > 0);

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

const menuDisplayItems = computed(() => flattenMenuDisplay(menuItems.value));

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

// The button stops a run whatever the input holds. Enter differs: see
// handleKeydown.
function handleSendButtonClick() {
  if (showsStop.value) {
    emit("stop");
    return;
  }
  if (!isProcessing.value) {
    submit();
  }
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

  if (props.mode !== "input") {
    return;
  }

  // Enter with text sends, also while a run is going. Enter in an empty input
  // stops the run. Read the textarea: a controlled modelValue can lag a tick.
  const action = ɵresolveComposerKey(event, {
    ...composerInput.value,
    value: textareaRef.value?.value ?? inputValue.value,
  });
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
  }
  if (action === "send") {
    submit();
  } else if (action === "stop") {
    emit("stop");
  }
}

/** The add button, or the first button of a custom `add-menu-button` slot. */
function getAddMenuTrigger(): HTMLElement | null {
  const container = addButtonContainerRef.value;
  return container?.querySelector<HTMLElement>("button") ?? container ?? null;
}

function toggleAddMenu(focus: "first" | "last" | "content" = "content") {
  if (!hasMenuItems.value || props.mode === "transcribe" || props.disabled) {
    return;
  }
  if (addMenuOpen.value) {
    closeAddMenu();
    return;
  }
  addMenuAnchor.value = getAddMenuTrigger();
  addMenuInitialFocus.value = focus;
  addMenuOpen.value = true;
}

function closeAddMenu(options: { returnFocus?: boolean } = {}) {
  if (!addMenuOpen.value) {
    return;
  }
  addMenuOpen.value = false;
  if (options.returnFocus) {
    getAddMenuTrigger()?.focus();
  }
}

function handleMenuAction(action: () => void) {
  // As Radix does, the menu closes and focus returns to its trigger first, so
  // an action that moves focus (for example into the textarea) keeps it.
  closeAddMenu({ returnFocus: true });
  action();
}

function handleAddMenuSelect(item: CopilotDropdownMenuItem) {
  if (item.action) {
    handleMenuAction(item.action);
  }
}

function handleAddMenuDismiss(reason: CopilotDropdownMenuDismissReason) {
  // A pointer down outside leaves focus where the pointer put it.
  closeAddMenu({ returnFocus: reason !== "outside" });
}

// A pointer down opens the menu, as Radix's trigger does; the click that
// follows it then must not toggle it again. Keyboard and synthetic clicks
// (detail 0) still toggle it from the click.
let addMenuPointerToggled = false;

function handleAddMenuPointerDown(event: PointerEvent) {
  if (event.button !== 0 || event.ctrlKey) {
    return;
  }
  addMenuPointerToggled = true;
  if (!addMenuOpen.value) {
    // Keep focus off the trigger, so the menu can take it.
    event.preventDefault();
  }
  toggleAddMenu("content");
}

function handleAddMenuClick(event: MouseEvent) {
  if (addMenuPointerToggled) {
    addMenuPointerToggled = false;
    return;
  }
  toggleAddMenu(event.detail === 0 ? "first" : "content");
}

function handleAddMenuTriggerKeydown(event: KeyboardEvent) {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    toggleAddMenu("first");
  } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    if (!addMenuOpen.value) {
      toggleAddMenu(event.key === "ArrowDown" ? "first" : "last");
    }
  }
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

  textarea.value = "";
  const singleLineHeight = textarea.scrollHeight;
  textarea.value = previousValue;

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
  if (layout.value === nextLayout) {
    return;
  }
  ignoreResizeRef.value = true;
  layout.value = nextLayout;
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

  if (
    typeof window.matchMedia === "function" &&
    window.matchMedia("(max-width: 767px)").matches
  ) {
    ensureMeasurements();
    adjustTextareaHeight();
    updateLayout("expanded");
    return;
  }

  const textarea = textareaRef.value;
  if (
    !textarea ||
    !gridRef.value ||
    !addButtonContainerRef.value ||
    !actionsContainerRef.value
  ) {
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
      layout.value = "compact";
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
});

onBeforeUnmount(() => {
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
    <div class="cpk-chat-input-wrapper">
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
        :on-toggle-menu="() => toggleAddMenu()"
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
          class="copilotKitInput cpk-chat-input-pill"
          :data-layout="isExpanded ? 'expanded' : 'compact'"
          @click="handleContainerClick"
        >
          <div
            ref="gridRef"
            class="cpk-chat-input-grid"
            :data-layout="isExpanded ? 'expanded' : 'compact'"
          >
            <div ref="addButtonContainerRef" class="cpk-chat-input-start">
              <slot
                name="add-menu-button"
                :disabled="disabled || mode === 'transcribe' || !hasMenuItems"
                :menu-open="addMenuOpen"
                :toggle-menu="() => toggleAddMenu()"
                :labels="labels"
              >
                <CopilotTooltip side="bottom" :suppressed="addMenuOpen">
                  <template #default="{ triggerProps }">
                    <button
                      v-bind="triggerProps"
                      :id="addMenuTriggerId"
                      type="button"
                      data-testid="copilot-chat-input-add"
                      :aria-label="labels.chatInputToolbarAddButtonLabel"
                      aria-haspopup="menu"
                      :aria-expanded="addMenuOpen"
                      :aria-controls="addMenuOpen ? addMenuId : undefined"
                      :data-state="addMenuOpen ? 'open' : 'closed'"
                      :disabled="
                        disabled || mode === 'transcribe' || !hasMenuItems
                      "
                      class="cpk-button cpk-button-chat-input-toolbar-secondary cpk-button-size-chat-input-toolbar-icon cpk-chat-input-add-menu-button"
                      @pointerdown="handleAddMenuPointerDown"
                      @click.stop="handleAddMenuClick"
                      @keydown="handleAddMenuTriggerKeydown"
                    >
                      <IconPlus class="cpk-chat-input-add-menu-icon" />
                    </button>
                  </template>
                  <template #content>
                    <p class="cpk-chat-input-add-menu-tooltip">
                      <span>{{ labels.chatInputToolbarAddButtonLabel }}</span>
                      <code class="cpk-chat-input-add-menu-shortcut">/</code>
                    </p>
                  </template>
                </CopilotTooltip>
              </slot>

              <CopilotDropdownMenuContent
                :id="addMenuId"
                :open="addMenuOpen && hasMenuItems"
                :anchor="addMenuAnchor"
                :items="menuItems"
                :menu-id="addMenuId"
                :labelled-by="addMenuAnchor?.id || undefined"
                side="top"
                align="start"
                :side-offset="4"
                :initial-focus="addMenuInitialFocus"
                data-testid="copilot-chat-input-add-menu"
                @select="handleAddMenuSelect"
                @dismiss="handleAddMenuDismiss"
              />
            </div>

            <div class="cpk-chat-input-field">
              <template v-if="mode === 'transcribe'">
                <slot name="audio-recorder">
                  <CopilotChatAudioRecorder ref="audioRecorderRef" />
                </slot>
              </template>
              <template v-else-if="mode === 'processing'">
                <div class="cpk-chat-input-processing">
                  <IconLoader2 class="cpk-chat-input-processing-spinner" />
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
                  <textarea
                    ref="textareaRef"
                    data-testid="copilot-chat-input-textarea"
                    :value="inputValue"
                    :placeholder="resolvedPlaceholder"
                    :disabled="disabled"
                    rows="1"
                    :class="[
                      'cpk-chat-input-textarea',
                      isExpanded
                        ? 'cpk-chat-input-textarea-expanded'
                        : 'cpk-chat-input-textarea-compact',
                    ]"
                    style="overflow: auto; resize: none"
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
                  :aria-label="labels.chatInputSlashMenuLabel"
                  class="cpk-chat-input-slash-menu"
                  :style="{ maxHeight: `${5 * 40}px` }"
                >
                  <div
                    v-if="filteredCommands.length === 0"
                    class="cpk-chat-input-slash-menu-empty"
                  >
                    {{ labels.chatInputSlashMenuEmptyText }}
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
                    class="cpk-chat-input-slash-menu-item"
                    @mouseenter="slashHighlightIndex = index"
                    @mousedown.prevent="runCommand(command)"
                  >
                    {{ command.label }}
                  </button>
                </div>
              </template>
            </div>

            <div ref="actionsContainerRef" class="cpk-chat-input-actions">
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
                  <CopilotTooltip
                    side="bottom"
                    :content="
                      labels.chatInputToolbarCancelTranscribeButtonLabel
                    "
                  >
                    <template #default="{ triggerProps }">
                      <button
                        v-bind="triggerProps"
                        type="button"
                        data-testid="copilot-chat-input-cancel-transcribe"
                        :aria-label="
                          labels.chatInputToolbarCancelTranscribeButtonLabel
                        "
                        :disabled="disabled"
                        class="cpk-button cpk-button-chat-input-toolbar-secondary cpk-button-size-chat-input-toolbar-icon cpk-chat-input-cancel-transcribe-button"
                        @click="emit('cancel-transcribe')"
                      >
                        <IconX class="cpk-chat-input-toolbar-icon" />
                      </button>
                    </template>
                  </CopilotTooltip>
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
                  <CopilotTooltip
                    side="bottom"
                    :content="
                      labels.chatInputToolbarFinishTranscribeButtonLabel
                    "
                  >
                    <template #default="{ triggerProps }">
                      <button
                        v-bind="triggerProps"
                        type="button"
                        data-testid="copilot-chat-input-finish-transcribe"
                        :aria-label="
                          labels.chatInputToolbarFinishTranscribeButtonLabel
                        "
                        :disabled="disabled"
                        class="cpk-button cpk-button-chat-input-toolbar-secondary cpk-button-size-chat-input-toolbar-icon cpk-chat-input-finish-transcribe-button"
                        @click="handleFinishTranscribe"
                      >
                        <IconCheck class="cpk-chat-input-toolbar-icon" />
                      </button>
                    </template>
                  </CopilotTooltip>
                </slot>
              </template>
              <template v-else>
                <slot
                  v-if="
                    hasStartTranscribeAction ||
                    $slots['start-transcribe-button']
                  "
                  name="start-transcribe-button"
                  :disabled="disabled"
                  :on-click="() => emit('start-transcribe')"
                  :labels="labels"
                >
                  <CopilotTooltip
                    side="bottom"
                    :content="labels.chatInputToolbarStartTranscribeButtonLabel"
                  >
                    <template #default="{ triggerProps }">
                      <button
                        v-bind="triggerProps"
                        type="button"
                        data-testid="copilot-chat-input-start-transcribe"
                        :aria-label="
                          labels.chatInputToolbarStartTranscribeButtonLabel
                        "
                        :disabled="disabled"
                        class="cpk-button cpk-button-chat-input-toolbar-secondary cpk-button-size-chat-input-toolbar-icon cpk-chat-input-start-transcribe-button"
                        @click="emit('start-transcribe')"
                      >
                        <IconMic class="cpk-chat-input-toolbar-icon" />
                      </button>
                    </template>
                  </CopilotTooltip>
                </slot>
                <slot
                  name="send-button"
                  :disabled="sendDisabled"
                  :is-processing="isProcessing"
                  :on-click="handleSendButtonClick"
                >
                  <div class="cpk-chat-input-send">
                    <button
                      type="button"
                      data-testid="copilot-chat-input-send"
                      :aria-label="
                        showsStop
                          ? labels.chatInputToolbarStopButtonLabel
                          : labels.chatInputToolbarSendButtonLabel
                      "
                      :disabled="sendDisabled"
                      class="cpk-button cpk-button-chat-input-toolbar-primary cpk-button-size-chat-input-toolbar-icon cpk-chat-input-send-button"
                      @click="handleSendButtonClick"
                    >
                      <IconSquare
                        v-if="showsStop"
                        class="cpk-chat-input-stop-icon"
                      />
                      <IconArrowUp v-else class="cpk-chat-input-send-icon" />
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
        class="cpk-chat-input-disclaimer"
      >
        {{ labels.chatDisclaimerText }}
      </p>
    </slot>
  </div>
</template>
