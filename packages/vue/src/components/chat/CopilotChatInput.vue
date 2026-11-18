<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  useAttrs,
  watch,
} from "vue";
import {
  ɵComposerController,
  ɵcomposerButtonState,
  ɵcreateComposerAutosize,
  ɵflattenToolsMenuForDisplay,
  ɵnormalizeToolsMenu,
  ɵshowsComposerDisclaimer,
  ɵsyncRecorderToMode,
} from "@copilotkit/core";
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
const isComposing = ref(false);
// The text, controlled or not, and the slash-command menu: see core's
// ɵComposerController.
const composer = new ɵComposerController<ToolsMenuItem>({
  initialValue: props.modelValue ?? "",
  onChange: (value) => emit("update:modelValue", value),
});
const composerState = shallowRef(composer.getSnapshot());
composer.subscribe(() => {
  composerState.value = composer.getSnapshot();
});
// Sizes the text box and picks the compact or expanded layout.
const autosize = ɵcreateComposerAutosize({
  getElements: () => ({
    textarea: textareaRef.value,
    grid: gridRef.value,
    start: addButtonContainerRef.value,
    actions: actionsContainerRef.value,
  }),
  maxRows: props.maxRows,
});
const layout = shallowRef(autosize.getSnapshot());
autosize.subscribe(() => {
  layout.value = autosize.getSnapshot();
});
const addMenuOpen = ref(false);
// Where focus goes as the add menu opens: its first or last item for the
// keyboard, the menu itself for a pointer, as Radix's DropdownMenu does.
const addMenuInitialFocus = ref<"first" | "last" | "content">("content");
const addMenuAnchor = ref<HTMLElement | null>(null);
const addMenuId = useCopilotId("cpk-add-menu");
const addMenuTriggerId = `${addMenuId}-trigger`;

const inputValue = computed(() => composerState.value.value);
const filteredCommands = computed(() => composerState.value.slashCommands);
const slashHighlightIndex = computed(
  () => composerState.value.slashHighlightIndex,
);
const slashMenuVisible = computed(
  () => composerState.value.slashQuery !== null,
);
const labels = useChatLabels();
const resolvedPlaceholder = computed(
  () => props.placeholder ?? labels.value.chatInputPlaceholder,
);
const isExpanded = computed(
  () => props.mode === "input" && layout.value === "expanded",
);
const shouldShowDisclaimer = computed(() =>
  ɵshowsComposerDisclaimer({
    showDisclaimer: props.showDisclaimer,
    positioning: props.positioning,
  }),
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

const menuItems = computed(() =>
  ɵnormalizeToolsMenu<ToolsMenuItem>(
    props.toolsMenu,
    hasAddFileAction.value
      ? {
          label: labels.value.chatInputToolbarAddButtonLabel,
          action: () => emit("add-file"),
        }
      : undefined,
  ),
);
const hasMenuItems = computed(() => menuItems.value.length > 0);
const menuDisplayItems = computed(() =>
  ɵflattenToolsMenuForDisplay(menuItems.value),
);

watch(
  [() => props.modelValue, () => props.mode, menuItems],
  ([value, mode, menu]) => composer.setInputs({ value, mode, menu }),
  { immediate: true },
);

function updateInputValue(nextValue: string) {
  composer.setValue(nextValue);
}

function focusTextareaSoon() {
  requestAnimationFrame(() => {
    textareaRef.value?.focus();
  });
}

function runCommand(command: ToolsMenuItem) {
  composer.runCommand(command);
  focusTextareaSoon();
}

function submit() {
  if (props.mode !== "input" || props.disabled || !hasSubmitAction.value) {
    return;
  }
  // In controlled mode, parent-updated modelValue can lag one tick behind
  // the actual textarea value during intense runtime/connect churn.
  const sent = composer.submit((text) => emit("submit-message", text), {
    value: textareaRef.value?.value ?? inputValue.value,
    clear: props.clearOnSubmit,
  });
  if (sent) textareaRef.value?.focus();
}

function handleInput(event: Event) {
  updateInputValue((event.target as HTMLTextAreaElement).value);
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
  if (props.disabled || props.mode !== "input") {
    return;
  }

  // Enter with text sends, also while a run is going. Enter in an empty input
  // stops the run. Read the textarea: a controlled modelValue can lag a tick.
  const { preventDefault, action } = composer.keyDown(
    {
      key: event.key,
      shiftKey: event.shiftKey,
      isComposing: isComposing.value || event.isComposing,
      keyCode: event.keyCode,
    },
    {
      ...composerInput.value,
      value: textareaRef.value?.value ?? inputValue.value,
    },
  );
  if (preventDefault) event.preventDefault();
  if (action === "command") {
    focusTextareaSoon();
  } else if (action === "send") {
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

watch(
  [inputValue, () => props.mode],
  ([value, mode]) => {
    autosize.evaluate(value, mode);
  },
  { flush: "post" },
);

watch(
  () => props.maxRows,
  (maxRows) => {
    autosize.setMaxRows(maxRows);
  },
);

watch(
  () => props.mode,
  (mode) => {
    if (mode !== "input") {
      closeAddMenu();
    }
  },
);

// Recording follows the mode: it starts in transcribe mode and stops when the
// mode changes. The recorder renders only in transcribe mode, so also sync
// when it appears.
watch(
  [audioRecorderRef, () => props.mode],
  ([recorder, mode]) => {
    void ɵsyncRecorderToMode(recorder, mode);
  },
  { immediate: true, flush: "post" },
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

  autosize.evaluate(inputValue.value, props.mode);
});

onBeforeUnmount(() => {
  autosize.dispose();
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
                    @mouseenter="composer.highlight(index)"
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
