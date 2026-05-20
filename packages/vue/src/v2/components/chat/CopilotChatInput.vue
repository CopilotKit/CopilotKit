<script setup lang="ts">
import {
  computed,
  getCurrentInstance,
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
const config = useCopilotChatConfiguration();
const instance = getCurrentInstance();
const shellRef = ref<HTMLElement | null>(null);
const textareaRef = ref<HTMLTextAreaElement | null>(null);
const gridRef = ref<HTMLElement | null>(null);
const addButtonContainerRef = ref<HTMLElement | null>(null);
const actionsContainerRef = ref<HTMLElement | null>(null);
const slashMenuRef = ref<HTMLElement | null>(null);
const addMenuRef = ref<HTMLElement | null>(null);
const audioRecorderRef = ref<CopilotChatAudioRecorderRef | null>(null);
const localValue = ref(props.modelValue ?? "");
const isComposing = ref(false);
const layout = ref<"compact" | "expanded">("compact");
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

const vnodeProps = computed(
  () => (instance?.vnode.props ?? {}) as Record<string, unknown>,
);

const isControlled = computed(() => props.modelValue !== undefined);
const inputValue = computed(() =>
  isControlled.value ? (props.modelValue ?? "") : localValue.value,
);
const labels = computed(() => config.value?.labels ?? CopilotChatDefaultLabels);
const resolvedPlaceholder = computed(
  () => props.placeholder ?? labels.value.chatInputPlaceholder,
);
const isExpanded = computed(
  () => props.mode === "input" && layout.value === "expanded",
);
const isProcessing = computed(
  () => props.mode !== "transcribe" && props.isRunning,
);
const shouldShowDisclaimer = computed(
  () => props.showDisclaimer ?? props.positioning === "absolute",
);
const hasSubmitAction = computed(() => hasListener("onSubmitMessage"));
const hasStopAction = computed(() => hasListener("onStop"));
const hasAddFileAction = computed(() => hasListener("onAddFile"));
const hasStartTranscribeAction = computed(() =>
  hasListener("onStartTranscribe"),
);
const hasCancelTranscribeAction = computed(() =>
  hasListener("onCancelTranscribe"),
);
const hasFinishTranscribeAction = computed(() =>
  hasListener("onFinishTranscribe"),
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

function hasListener(listenerName: string) {
  const listener = vnodeProps.value[listenerName];
  if (Array.isArray(listener)) {
    return listener.length > 0;
  }
  return !!listener;
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
      class="cpk:pointer-events-auto cpk:mx-auto cpk:max-w-3xl cpk:px-4 cpk:py-0 cpk:sm:px-0 cpk:[div[data-sidebar-chat]_&]:px-8 cpk:[div[data-popup-chat]_&]:px-4"
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
          class="cpk:flex cpk:w-full cpk:cursor-text cpk:flex-col cpk:items-center cpk:justify-center cpk:overflow-visible cpk:rounded-[28px] cpk:bg-white cpk:bg-clip-padding cpk:shadow-[0_4px_4px_0_#0000000a,0_0_1px_0_#0000009e] cpk:contain-inline-size cpk:dark:bg-[#303030]"
          :data-layout="isExpanded ? 'expanded' : 'compact'"
          @click="handleContainerClick"
        >
          <div
            ref="gridRef"
            :class="[
              'cpk:grid cpk:w-full cpk:gap-x-3 cpk:gap-y-3 cpk:px-3 cpk:py-2',
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
                isExpanded ? 'cpk:row-start-2' : 'cpk:row-start-1',
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
                  class="cpk:ml-1 cpk:inline-flex cpk:h-9 cpk:w-9 cpk:shrink-0 cpk:items-center cpk:justify-center cpk:rounded-full cpk:bg-transparent cpk:text-[#444444] cpk:transition-colors cpk:hover:bg-[#f8f8f8] cpk:hover:text-[#333333] cpk:disabled:cursor-not-allowed cpk:disabled:opacity-50 cpk:disabled:hover:bg-transparent cpk:disabled:hover:text-[#444444] cpk:dark:text-white cpk:dark:hover:bg-[#404040] cpk:dark:hover:text-[#FFFFFF] cpk:dark:disabled:hover:bg-transparent cpk:dark:disabled:hover:text-[#CCCCCC]"
                  @click.stop="toggleAddMenu"
                >
                  <IconPlus class="cpk:size-[20px]" />
                </button>
              </slot>

              <div
                v-if="addMenuOpen && hasMenuItems"
                ref="addMenuRef"
                class="cpk:absolute cpk:bottom-full cpk:left-0 cpk:z-30 cpk:mb-2 cpk:min-w-[220px] cpk:overflow-hidden cpk:rounded-lg cpk:border cpk:border-border cpk:bg-white cpk:shadow-lg cpk:dark:border-[#3a3a3a] cpk:dark:bg-[#1f1f1f]"
                data-testid="copilot-chat-input-add-menu"
              >
                <template v-for="entry in menuDisplayItems" :key="entry.key">
                  <div
                    v-if="entry.type === 'separator'"
                    class="cpk:my-1 cpk:h-px cpk:bg-border cpk:dark:bg-[#333333]"
                  />
                  <div
                    v-else-if="entry.type === 'label'"
                    class="cpk:flex cpk:items-center cpk:gap-1 cpk:px-3 cpk:py-1.5 cpk:text-xs cpk:font-semibold cpk:text-muted-foreground"
                    :style="{ paddingLeft: `${12 + entry.depth * 12}px` }"
                  >
                    <span>{{ entry.label }}</span>
                    <IconChevronRight class="cpk:size-3" />
                  </div>
                  <button
                    v-else
                    type="button"
                    role="menuitem"
                    class="cpk:w-full cpk:px-3 cpk:py-2 cpk:text-left cpk:text-sm cpk:transition-colors cpk:hover:bg-muted cpk:dark:hover:bg-[#2f2f2f]"
                    :style="{ paddingLeft: `${12 + entry.depth * 12}px` }"
                    @click="handleMenuAction(entry.action)"
                  >
                    {{ entry.label }}
                  </button>
                </template>
              </div>
            </div>

            <div
              :class="[
                'cpk:relative cpk:flex cpk:min-h-[50px] cpk:min-w-0 cpk:flex-col cpk:justify-center',
                isExpanded
                  ? 'cpk:col-span-3 cpk:row-start-1'
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
                  class="cpk:flex cpk:w-full cpk:items-center cpk:justify-center cpk:px-5 cpk:py-3"
                >
                  <IconLoader2
                    class="cpk:size-[26px] cpk:animate-spin cpk:text-muted-foreground"
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
                  <textarea
                    ref="textareaRef"
                    data-testid="copilot-chat-input-textarea"
                    :value="inputValue"
                    :placeholder="resolvedPlaceholder"
                    :disabled="disabled"
                    rows="1"
                    :class="[
                      'cpk:w-full cpk:bg-transparent cpk:py-3 cpk:text-[16px] cpk:font-normal cpk:leading-relaxed cpk:text-foreground cpk:antialiased cpk:outline-none cpk:placeholder:text-[#00000077] cpk:dark:placeholder:text-[#fffc]',
                      isExpanded ? 'cpk:px-5' : 'cpk:pr-5',
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
                  aria-label="Slash commands"
                  class="cpk:absolute cpk:bottom-full cpk:left-0 cpk:right-0 cpk:z-30 cpk:mb-2 cpk:max-h-64 cpk:overflow-y-auto cpk:rounded-lg cpk:border cpk:border-border cpk:bg-white cpk:shadow-lg cpk:dark:border-[#3a3a3a] cpk:dark:bg-[#1f1f1f]"
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
                      'cpk:w-full cpk:px-3 cpk:py-2 cpk:text-left cpk:text-sm cpk:transition-colors cpk:hover:bg-muted cpk:dark:hover:bg-[#2f2f2f]',
                      index === slashHighlightIndex
                        ? 'cpk:bg-muted cpk:dark:bg-[#2f2f2f]'
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
                'cpk:flex cpk:items-center cpk:justify-end cpk:gap-2',
                isExpanded
                  ? 'cpk:col-start-3 cpk:row-start-2'
                  : 'cpk:col-start-3 cpk:row-start-1',
              ]"
            >
              <template v-if="mode === 'transcribe'">
                <slot
                  v-if="hasCancelTranscribeAction"
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
                    class="cpk:mr-2 cpk:inline-flex cpk:h-9 cpk:w-9 cpk:shrink-0 cpk:items-center cpk:justify-center cpk:rounded-full cpk:bg-transparent cpk:text-[#444444] cpk:transition-colors cpk:hover:bg-[#f8f8f8] cpk:hover:text-[#333333] cpk:disabled:cursor-not-allowed cpk:disabled:opacity-50 cpk:dark:text-white cpk:dark:hover:bg-[#404040] cpk:dark:hover:text-[#FFFFFF]"
                    @click="emit('cancel-transcribe')"
                  >
                    <IconX class="cpk:size-[18px]" />
                  </button>
                </slot>
                <slot
                  v-if="hasFinishTranscribeAction"
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
                    class="cpk:mr-[10px] cpk:inline-flex cpk:h-9 cpk:w-9 cpk:shrink-0 cpk:items-center cpk:justify-center cpk:rounded-full cpk:bg-transparent cpk:text-[#444444] cpk:transition-colors cpk:hover:bg-[#f8f8f8] cpk:hover:text-[#333333] cpk:disabled:cursor-not-allowed cpk:disabled:opacity-50 cpk:dark:text-white cpk:dark:hover:bg-[#404040] cpk:dark:hover:text-[#FFFFFF]"
                    @click="handleFinishTranscribe"
                  >
                    <IconCheck class="cpk:size-[18px]" />
                  </button>
                </slot>
              </template>
              <template v-else>
                <slot
                  v-if="hasStartTranscribeAction"
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
                    class="cpk:mr-2 cpk:inline-flex cpk:h-9 cpk:w-9 cpk:shrink-0 cpk:items-center cpk:justify-center cpk:rounded-full cpk:bg-transparent cpk:text-[#444444] cpk:transition-colors cpk:hover:bg-[#f8f8f8] cpk:hover:text-[#333333] cpk:disabled:cursor-not-allowed cpk:disabled:opacity-50 cpk:disabled:hover:bg-transparent cpk:disabled:hover:text-[#444444] cpk:dark:text-white cpk:dark:hover:bg-[#404040] cpk:dark:hover:text-[#FFFFFF] cpk:dark:disabled:hover:bg-transparent cpk:dark:disabled:hover:text-[#CCCCCC]"
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
                  <div class="cpk:mr-[10px]">
                    <button
                      type="button"
                      data-testid="copilot-chat-input-send"
                      aria-label="Send message"
                      :disabled="sendDisabled"
                      class="cpk:inline-flex cpk:h-9 cpk:w-9 cpk:shrink-0 cpk:items-center cpk:justify-center cpk:rounded-full cpk:bg-black cpk:text-white cpk:transition-colors cpk:hover:opacity-70 cpk:disabled:cursor-not-allowed cpk:disabled:opacity-50 cpk:disabled:bg-[#00000014] cpk:disabled:text-[rgb(13,13,13)] cpk:disabled:hover:opacity-100 cpk:dark:bg-white cpk:dark:text-black cpk:dark:disabled:bg-[#454545] cpk:dark:disabled:text-white"
                      @click="handleSendButtonClick"
                    >
                      <IconSquare
                        v-if="isProcessing && hasStopAction"
                        class="cpk:size-[18px] cpk:fill-current"
                      />
                      <IconArrowUp v-else class="cpk:size-[18px]" />
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
