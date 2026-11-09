<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  useId,
  useTemplateRef,
  watch,
} from "vue";
import type { CSSProperties, VNode } from "vue";
import type { z } from "zod";
import {
  BACKDROP,
  SHADOW_MD,
  backgroundColor,
  radius,
  spacing,
  textColor,
} from "@copilotkit/shared/generative-ui";
import type { modalSchema } from "@copilotkit/shared/generative-ui";
import { useGenerativeUIAccessibility, wrapperAria } from "../../accessibility";
import { useGenerativeUIRuntime } from "../../runtime-context";
import { useThemeStyleSheet } from "../../standard-styles";
import { useOverlayEscape } from "../overlay-stack";
import { useFeedbackStyles } from "./styles";

defineOptions({ name: "CopilotGenerativeUIModal" });

type ModalProps = z.output<typeof modalSchema>;

/**
 * A modal dialog. A click anywhere on the `trigger` slot opens the
 * `content` slot in the dialog. A trigger that is not a control itself (a
 * Text) gets the button role and a tab stop, so Enter and Space open the
 * dialog too. A Button inside keeps its own semantics and still sends its
 * own event. A disabled control in the trigger keeps the dialog closed.
 *
 * While open, Tab cycles inside the dialog. Escape (only the newest
 * overlay: a Lightbox inside the dialog closes first), the close button or
 * a click on the backdrop closes it, and the focus returns to where it was.
 *
 * The dialog is teleported to `body`, so a transformed chat row does not
 * clip its backdrop. It keeps the surface style scope and the theme, and
 * takes the envelope of the component itself. On the server, and before
 * the component mounts, only the trigger renders.
 *
 * `open` is writable (`v-model:open`). Bind it with `{ "@path": "/x" }` to
 * read it.
 */
const props = defineProps<{
  title?: ModalProps["title"];
  maxWidth?: ModalProps["maxWidth"];
  weight?: ModalProps["weight"];
}>();

const open = defineModel<ModalProps["open"]>("open");

defineSlots<{ trigger?: () => VNode[]; content?: () => VNode[] }>();

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),iframe,video[controls],audio[controls],[tabindex]:not([tabindex="-1"])';
/**
 * A control, enabled or not: a disabled Button, or a Pressable (a div with
 * the button role) is still the trigger, and the wrapper must not open the
 * dialog in its place.
 */
const CONTROL =
  'a[href],button,input,select,textarea,[role="button"],[tabindex]:not([tabindex="-1"])';
/** A click inside one of these never opens the dialog. */
const DISABLED = '[disabled],[aria-disabled="true"]';

const PORTAL_STYLE: CSSProperties = { display: "contents" };
const BACKDROP_STYLE: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 1000,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: spacing(4),
  background: BACKDROP,
};
const HEADER_STYLE: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: spacing(3),
};
const TITLE_STYLE: CSSProperties = {
  margin: 0,
  fontSize: "1.125em",
  fontWeight: 600,
};
const CLOSE_STYLE: CSSProperties = {
  width: "32px",
  height: "32px",
  border: "none",
  borderRadius: radius("full"),
  background: "transparent",
  color: textColor("secondary"),
  fontSize: "20px",
  lineHeight: 1,
  cursor: "pointer",
};

useFeedbackStyles();
// The dialog is teleported, outside the wrapper the engine puts around
// the component, so it takes the envelope itself.
const aria = useGenerativeUIAccessibility();
const wrapper = computed(() => wrapperAria(aria.value));
const titleId = `${useId()}-title`;
const labelledBy = computed(() =>
  props.title && aria.value["aria-label"] === undefined ? titleId : undefined,
);

// The dialog takes the theme of the surface with it: the surface root
// holds the stylesheet of this id.
const runtime = useGenerativeUIRuntime();
const theme = useThemeStyleSheet(() => runtime.value?.theme);

const isOpen = computed(() => open.value ?? false);
const setOpen = (value: boolean) => {
  open.value = value;
};
useOverlayEscape(isOpen, () => setOpen(false));

const isMounted = ref(false);
const isShown = computed(() => isOpen.value && isMounted.value);

const dialogStyle = computed(
  (): CSSProperties => ({
    display: "flex",
    flexDirection: "column",
    gap: spacing(3),
    width: "100%",
    maxWidth: spacing(props.maxWidth ?? 480),
    maxHeight: "90vh",
    overflow: "auto",
    padding: spacing(5),
    borderRadius: radius("xl"),
    background: backgroundColor("surface"),
    color: textColor("default"),
    boxShadow: SHADOW_MD,
  }),
);

const triggerWrapper = useTemplateRef<HTMLDivElement>("triggerWrapper");
const dialogElement = useTemplateRef<HTMLDivElement>("dialogElement");

// A trigger that is not a control itself (a Text) gets the button role and
// a tab stop, so the keyboard can open the dialog. A Button inside keeps its
// own semantics: nesting buttons is invalid. The trigger component can
// stream in after the Modal, so the DOM of the trigger is observed, and the
// classification follows what is rendered in it.
const isPlainTrigger = ref(false);
const triggerStyle = computed(
  (): CSSProperties => ({
    display: "inline-flex",
    flexGrow: props.weight,
    cursor: isPlainTrigger.value ? "pointer" : undefined,
  }),
);

let observer: MutationObserver | undefined;
onMounted(() => {
  isMounted.value = true;
  const element = triggerWrapper.value;
  if (!element) return;
  // A disabled control is still a control: the wrapper must not open the
  // dialog in its place.
  const classify = () => {
    isPlainTrigger.value = element.querySelector(CONTROL) === null;
  };
  classify();
  if (typeof MutationObserver === "undefined") return;
  observer = new MutationObserver(classify);
  observer.observe(element, { childList: true, subtree: true });
});
onBeforeUnmount(() => observer?.disconnect());

// The capture phase sees the click before a Button inside handles it, and
// lets it through: the Button still sends its own event, opens its href or
// copies its text.
function onTriggerClick(event: MouseEvent) {
  const target = event.target;
  const control = target instanceof Element ? target.closest(CONTROL) : null;
  // A disabled control inside the trigger (a Pressable, a Button) keeps the
  // dialog closed, also before its own click handler.
  const isDisabledControl =
    control !== null &&
    triggerWrapper.value?.contains(control) === true &&
    control.matches(DISABLED);
  if (isDisabledControl) return;
  setOpen(true);
}

function onTriggerKeyDown(event: KeyboardEvent) {
  if (!isPlainTrigger.value) return;
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  setOpen(true);
}

// While shown: the focus moves into the dialog, Tab cycles inside it, and
// on close the focus returns to where it was. Escape is handled by the
// overlay stack: only the newest overlay.
watch(
  isShown,
  (shown, _previous, onCleanup) => {
    if (!shown) return;
    const dialog = dialogElement.value;
    const previous = document.activeElement;
    const focusables = () =>
      Array.from(dialog?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []);
    (focusables()[0] ?? dialog)?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = focusables();
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    onCleanup(() => {
      document.removeEventListener("keydown", onKeyDown);
      if (previous instanceof HTMLElement) previous.focus();
      else triggerWrapper.value?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    });
  },
  { flush: "post" },
);
</script>

<template>
  <div
    ref="triggerWrapper"
    data-a2ui-std=""
    data-a2ui-modal-trigger=""
    :role="isPlainTrigger ? 'button' : undefined"
    :tabindex="isPlainTrigger ? 0 : undefined"
    :aria-haspopup="isPlainTrigger ? 'dialog' : undefined"
    :aria-expanded="isPlainTrigger ? isOpen : undefined"
    :style="triggerStyle"
    @click.capture="onTriggerClick"
    @keydown="onTriggerKeyDown"
  >
    <slot name="trigger" />
  </div>
  <Teleport v-if="isShown" to="body">
    <div
      class="a2ui-surface"
      :data-a2ui-theme="theme?.id"
      :style="PORTAL_STYLE"
    >
      <div
        data-a2ui-modal-backdrop=""
        :style="BACKDROP_STYLE"
        @click="setOpen(false)"
      >
        <div
          ref="dialogElement"
          role="dialog"
          aria-modal="true"
          :aria-labelledby="labelledBy"
          :aria-label="aria['aria-label']"
          :aria-description="aria['aria-description']"
          v-bind="wrapper"
          tabindex="-1"
          :style="dialogStyle"
          @click.stop
        >
          <div :style="HEADER_STYLE">
            <h2 v-if="title" :id="titleId" :style="TITLE_STYLE">
              {{ title }}
            </h2>
            <span v-else />
            <button
              type="button"
              aria-label="Close"
              data-a2ui-input=""
              :style="CLOSE_STYLE"
              @click="setOpen(false)"
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
          <slot name="content" />
        </div>
      </div>
    </div>
  </Teleport>
</template>
