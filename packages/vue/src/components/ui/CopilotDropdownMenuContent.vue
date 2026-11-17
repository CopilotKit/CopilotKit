<script setup lang="ts">
/**
 * React's `<DropdownMenuContent>` and `<DropdownMenuSubContent>` (Radix) for
 * Vue, drawn from a list of entries: items, separators, and submenus. It is
 * teleported to `document.body` and positioned next to `anchor`.
 *
 * Keyboard: ArrowUp/ArrowDown move between items, Home/End jump, typing
 * jumps to the next item that starts with the typed text, Enter/Space
 * activate, ArrowRight/Enter/Space open a submenu and ArrowLeft closes it,
 * Escape and Tab close the whole menu. Hovering an item focuses it; hovering
 * a submenu trigger opens its submenu.
 *
 * @internal
 */
import { computed, nextTick, onBeforeUnmount, ref, toRef, watch } from "vue";
import type { ComponentPublicInstance } from "vue";
import { IconChevronRight } from "../icons";
import type { FloatingAlign, FloatingSide } from "./floating";
import { useFloating } from "./floating";
import { usePresence } from "./presence";
import { useCopilotId } from "./use-id";
import type {
  CopilotDropdownMenuDismissReason,
  CopilotDropdownMenuEntry,
  CopilotDropdownMenuItem,
} from "./dropdown-menu";

defineOptions({ name: "CopilotDropdownMenuContent", inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    open: boolean;
    anchor: HTMLElement | null;
    items: CopilotDropdownMenuEntry[];
    /** Shared by a menu and its submenus, to tell inside from outside. */
    menuId: string;
    id?: string;
    labelledBy?: string;
    side?: FloatingSide;
    align?: FloatingAlign;
    sideOffset?: number;
    /** Where focus goes when it opens. */
    initialFocus?: "first" | "last" | "content" | "none";
    /** A submenu, drawn with `.cpk-dropdown-menu-sub-content`. */
    sub?: boolean;
  }>(),
  {
    id: undefined,
    labelledBy: undefined,
    side: "bottom",
    align: "start",
    sideOffset: 4,
    initialFocus: "content",
    sub: false,
  },
);

const emit = defineEmits<{
  /** An item was chosen; the menu should close and run it. */
  select: [item: CopilotDropdownMenuItem];
  /** The whole menu should close. */
  dismiss: [reason: CopilotDropdownMenuDismissReason];
  /** ArrowLeft in a submenu: close it and focus its trigger. */
  "close-sub": [];
  /** The pointer reached this content. */
  "pointer-enter": [];
  /** The pointer left this content. */
  "pointer-leave": [];
}>();

defineSlots<{
  /** Content before the items, such as a label. */
  header?: () => unknown;
  /** The content of an item; defaults to its label. */
  item?: (props: { item: CopilotDropdownMenuItem }) => unknown;
}>();

// Radix waits this long on a submenu trigger before opening it on hover.
const SUB_OPEN_DELAY_MS = 100;
// Time the pointer has to cross from a submenu trigger onto its submenu.
const SUB_GRACE_MS = 300;
// Type-ahead text resets after this long without typing.
const TYPEAHEAD_RESET_MS = 1000;

const generatedId = useCopilotId("cpk-menu");
const contentId = computed(() => props.id ?? generatedId);
const wrapper = ref<HTMLElement | null>(null);
const content = ref<HTMLElement | null>(null);
const itemElements = ref<(HTMLElement | null)[]>([]);
const open = toRef(props, "open");
const anchor = toRef(props, "anchor");
const present = usePresence(open, content);
const openSub = ref<number | null>(null);
const subInitialFocus = ref<"first" | "none">("none");
const highlighted = ref<number | null>(null);

const { placement, wrapperStyle } = useFloating(anchor, wrapper, open, () => ({
  side: props.side,
  align: props.align,
  sideOffset: props.sideOffset,
}));

const isGroup = (
  entry: CopilotDropdownMenuEntry,
): entry is CopilotDropdownMenuItem & {
  items: CopilotDropdownMenuEntry[];
} => entry !== "-" && Array.isArray(entry.items) && entry.items.length > 0;

const setItemElement = (
  index: number,
  element: Element | ComponentPublicInstance | null,
) => {
  itemElements.value[index] = element instanceof HTMLElement ? element : null;
};

const focusableIndexes = () =>
  props.items.flatMap((entry, index) =>
    entry !== "-" && itemElements.value[index] ? [index] : [],
  );

const focusItem = (index: number | undefined) => {
  if (index === undefined) return;
  itemElements.value[index]?.focus();
};

const focusedIndex = () => {
  const active = document.activeElement;
  const index = itemElements.value.findIndex((element) => element === active);
  return index === -1 ? null : index;
};

watch(
  [open, content],
  async ([isOpen, element]) => {
    if (!isOpen || !element) {
      if (!isOpen) openSub.value = null;
      return;
    }
    await nextTick();
    const indexes = focusableIndexes();
    if (props.initialFocus === "first") focusItem(indexes[0]);
    else if (props.initialFocus === "last") focusItem(indexes.at(-1));
    else if (props.initialFocus === "content") element.focus();
  },
  { flush: "post" },
);

let subOpenTimer: ReturnType<typeof setTimeout> | undefined;
let graceUntil = 0;

const clearSubTimer = () => {
  clearTimeout(subOpenTimer);
  subOpenTimer = undefined;
};

const openSubmenu = (index: number, focus: "first" | "none") => {
  clearSubTimer();
  subInitialFocus.value = focus;
  openSub.value = index;
};

const closeSubmenu = () => {
  clearSubTimer();
  openSub.value = null;
};

const onSubClosedByKey = (index: number) => {
  closeSubmenu();
  focusItem(index);
};

let typeahead = "";
let typeaheadTimer: ReturnType<typeof setTimeout> | undefined;

const labelOf = (index: number) => {
  const entry = props.items[index];
  return entry && entry !== "-" ? entry.label.trim().toLowerCase() : "";
};

const runTypeahead = (key: string) => {
  clearTimeout(typeaheadTimer);
  typeahead += key.toLowerCase();
  typeaheadTimer = setTimeout(() => {
    typeahead = "";
  }, TYPEAHEAD_RESET_MS);
  const indexes = focusableIndexes();
  const current = focusedIndex();
  const position = current === null ? -1 : indexes.indexOf(current);
  // Repeating one letter cycles through the items that start with it; a
  // longer search may still match the focused item.
  const repeated = typeahead.split("").every((c) => c === typeahead[0]);
  const search = repeated ? typeahead[0]! : typeahead;
  const start = Math.max(0, position + (repeated ? 1 : 0));
  const ordered = [...indexes.slice(start), ...indexes.slice(0, start)];
  focusItem(ordered.find((index) => labelOf(index).startsWith(search)));
};

const activate = (index: number, focus: "first" | "none") => {
  const entry = props.items[index];
  if (!entry || entry === "-") return;
  if (isGroup(entry)) {
    openSubmenu(index, focus);
    return;
  }
  emit("select", entry);
};

const onKeyDown = (event: KeyboardEvent) => {
  const indexes = focusableIndexes();
  const current = focusedIndex();
  const position = current === null ? -1 : indexes.indexOf(current);
  const currentEntry = current === null ? undefined : props.items[current];

  switch (event.key) {
    case "ArrowDown":
      event.preventDefault();
      focusItem(indexes[Math.min(position + 1, indexes.length - 1)]);
      return;
    case "ArrowUp":
      event.preventDefault();
      focusItem(
        position === -1 ? indexes.at(-1) : indexes[Math.max(position - 1, 0)],
      );
      return;
    case "Home":
    case "PageUp":
      event.preventDefault();
      focusItem(indexes[0]);
      return;
    case "End":
    case "PageDown":
      event.preventDefault();
      focusItem(indexes.at(-1));
      return;
    case "Enter":
    case " ":
      if (current === null) return;
      if (event.key === " " && typeahead) {
        event.preventDefault();
        runTypeahead(" ");
        return;
      }
      event.preventDefault();
      activate(current, "first");
      return;
    case "ArrowRight":
      if (current !== null && currentEntry && isGroup(currentEntry)) {
        event.preventDefault();
        openSubmenu(current, "first");
      }
      return;
    case "ArrowLeft":
      if (props.sub) {
        event.preventDefault();
        emit("close-sub");
      }
      return;
    case "Escape":
      event.preventDefault();
      // Escape closes only the menu, not a chat popup around it.
      event.stopPropagation();
      emit("dismiss", "escape");
      return;
    case "Tab":
      event.preventDefault();
      emit("dismiss", "tab");
      return;
  }

  if (
    event.key.length === 1 &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.altKey
  ) {
    runTypeahead(event.key);
  }
};

const onItemPointerMove = (index: number, event: PointerEvent) => {
  if (event.pointerType !== "mouse" && event.pointerType !== "pen") return;
  if (Date.now() < graceUntil && openSub.value !== index) return;
  graceUntil = 0;
  const element = itemElements.value[index];
  if (element && document.activeElement !== element) element.focus();
  const entry = props.items[index];
  if (entry && isGroup(entry)) {
    if (openSub.value !== index && subOpenTimer === undefined) {
      subOpenTimer = setTimeout(
        () => openSubmenu(index, "none"),
        SUB_OPEN_DELAY_MS,
      );
    }
  } else if (openSub.value !== null) {
    closeSubmenu();
  }
};

const onItemPointerLeave = (index: number, event: PointerEvent) => {
  if (event.pointerType !== "mouse" && event.pointerType !== "pen") return;
  const entry = props.items[index];
  if (entry && isGroup(entry)) {
    clearSubTimer();
    if (openSub.value === index) {
      graceUntil = Date.now() + SUB_GRACE_MS;
      return;
    }
  }
  if (Date.now() < graceUntil) return;
  // As Radix does, focus leaves the item for the menu itself.
  if (document.activeElement === itemElements.value[index]) {
    content.value?.focus();
  }
};

const onItemClick = (index: number) => {
  activate(index, "none");
};

const onSubPointerEnter = () => {
  graceUntil = 0;
};

// The root closes on a pointer down or focus outside the menu, its
// submenus, and its trigger, which toggles the menu itself.
const isInsideMenu = (target: EventTarget | null) =>
  target instanceof Element &&
  (target.closest(`[data-cpk-menu="${props.menuId}"]`) !== null ||
    (props.anchor?.contains(target) ?? false));

const onOutside = (event: Event) => {
  if (!isInsideMenu(event.target)) emit("dismiss", "outside");
};

const listen = (on: boolean) => {
  if (props.sub || typeof document === "undefined") return;
  const method = on ? "addEventListener" : "removeEventListener";
  document[method]("pointerdown", onOutside, { capture: true });
  document[method]("focusin", onOutside, { capture: true });
};

watch(open, (isOpen) => listen(isOpen), { immediate: true });

onBeforeUnmount(() => {
  listen(false);
  clearSubTimer();
  clearTimeout(typeaheadTimer);
});

const contentStyle = computed(() => ({
  outline: "none",
  "--radix-dropdown-menu-content-transform-origin":
    placement.value?.transformOrigin ?? "center",
  "--radix-dropdown-menu-content-available-height": placement.value
    ? `${placement.value.availableHeight}px`
    : undefined,
}));

const subId = (index: number) => `${contentId.value}-sub-${index}`;
</script>

<template>
  <Teleport to="body">
    <div
      v-if="present"
      ref="wrapper"
      data-radix-popper-content-wrapper
      :style="wrapperStyle()"
    >
      <div
        :id="contentId"
        ref="content"
        data-copilotkit
        :data-cpk-menu="menuId"
        :data-slot="sub ? 'dropdown-menu-sub-content' : 'dropdown-menu-content'"
        :class="
          sub ? 'cpk-dropdown-menu-sub-content' : 'cpk-dropdown-menu-content'
        "
        role="menu"
        aria-orientation="vertical"
        :aria-labelledby="labelledBy"
        tabindex="-1"
        :data-state="open ? 'open' : 'closed'"
        :data-side="placement?.side ?? side"
        :data-align="placement?.align ?? align"
        :style="contentStyle"
        v-bind="$attrs"
        @keydown="onKeyDown"
        @pointerenter="emit('pointer-enter')"
        @pointerleave="emit('pointer-leave')"
      >
        <slot name="header" />
        <template v-for="(entry, index) in items" :key="index">
          <div
            v-if="entry === '-'"
            role="separator"
            aria-orientation="horizontal"
            data-slot="dropdown-menu-separator"
            class="cpk-dropdown-menu-separator"
          />
          <template v-else-if="isGroup(entry)">
            <div
              :id="`${subId(index)}-trigger`"
              :ref="(element) => setItemElement(index, element)"
              role="menuitem"
              tabindex="-1"
              aria-haspopup="menu"
              :aria-expanded="openSub === index"
              :aria-controls="openSub === index ? subId(index) : undefined"
              data-slot="dropdown-menu-sub-trigger"
              class="cpk-dropdown-menu-sub-trigger"
              :data-state="openSub === index ? 'open' : 'closed'"
              :data-highlighted="highlighted === index ? '' : undefined"
              @focus="highlighted = index"
              @blur="highlighted = null"
              @pointermove="onItemPointerMove(index, $event)"
              @pointerleave="onItemPointerLeave(index, $event)"
              @click="onItemClick(index)"
            >
              {{ entry.label }}
              <IconChevronRight
                class="cpk-dropdown-menu-sub-trigger-icon"
                aria-hidden="true"
              />
            </div>
            <CopilotDropdownMenuContent
              :id="subId(index)"
              :open="open && openSub === index"
              :anchor="itemElements[index] ?? null"
              :items="entry.items"
              :menu-id="menuId"
              :labelled-by="`${subId(index)}-trigger`"
              side="right"
              align="start"
              :side-offset="0"
              :initial-focus="subInitialFocus"
              sub
              @select="emit('select', $event)"
              @dismiss="emit('dismiss', $event)"
              @close-sub="onSubClosedByKey(index)"
              @pointer-enter="onSubPointerEnter"
            />
          </template>
          <div
            v-else
            :ref="(element) => setItemElement(index, element)"
            role="menuitem"
            tabindex="-1"
            data-slot="dropdown-menu-item"
            data-variant="default"
            :class="['cpk-dropdown-menu-item', entry.class]"
            :data-highlighted="highlighted === index ? '' : undefined"
            @focus="highlighted = index"
            @blur="highlighted = null"
            @pointermove="onItemPointerMove(index, $event)"
            @pointerleave="onItemPointerLeave(index, $event)"
            @click="onItemClick(index)"
          >
            <slot name="item" :item="entry">{{ entry.label }}</slot>
          </div>
        </template>
      </div>
    </div>
  </Teleport>
</template>
