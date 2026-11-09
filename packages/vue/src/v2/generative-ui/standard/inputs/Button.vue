<script setup lang="ts">
import { computed, ref, useTemplateRef } from "vue";
import {
  ACCENT,
  FONT_WEIGHT,
  ON_ACCENT,
  backgroundColor,
  borderColor,
  firstFailedCheck,
  openUrl,
  px,
  radius,
  textColor,
} from "@copilotkit/shared/generative-ui";
import type { StyleMap, buttonSchema } from "@copilotkit/shared/generative-ui";
import type { z } from "zod";
import { useGenerativeUIAccessibility } from "../../accessibility";
import { useStandardStyles } from "../../standard-styles";
import type { GenerativeUIEventProp } from "../context";
import CopilotGenerativeUILucideIcon from "../media/LucideIcon.vue";
import { FONT_SIZE, HEIGHT, ICON_PX, PAD_X, asText } from "./control";

defineOptions({ name: "CopilotGenerativeUIButton" });

type ButtonProps = z.output<typeof buttonSchema>;
type ButtonVariant = NonNullable<ButtonProps["variant"]>;

/**
 * A button that sends its `onClick` event, opens `href`, or copies `copy`.
 * Inside a Form, a `submit` button submits the Form instead. Its `child` or
 * `children` slot renders instead of the label. With `checks`, it is
 * disabled while a check fails with an error.
 *
 * The boolean props default to `undefined`, not `false`: `pill: false` is a
 * choice (square corners), an unset `pill` is a pill.
 */
const props = withDefaults(
  defineProps<{
    label?: ButtonProps["label"];
    checks?: ButtonProps["checks"];
    /** Same as label. Used when label is not set. */
    text?: ButtonProps["text"];
    variant?: ButtonProps["variant"];
    color?: ButtonProps["color"];
    size?: ButtonProps["size"];
    /** Full width. */
    block?: ButtonProps["block"];
    weight?: ButtonProps["weight"];
    pill?: ButtonProps["pill"];
    disabled?: ButtonProps["disabled"];
    loading?: ButtonProps["loading"];
    /** Submits the Form around it. The Form sends its onSubmit event. */
    submit?: ButtonProps["submit"];
    /** A lucide icon name, shown before the label. */
    icon?: ButtonProps["icon"];
    /** A square button, for an icon. */
    uniform?: ButtonProps["uniform"];
    /** Opens this URL in a new tab on click, instead of onClick. */
    href?: ButtonProps["href"];
    /** Copies this text to the clipboard on click, instead of onClick. */
    copy?: ButtonProps["copy"];
    /** Sent when the user clicks the button. */
    onClick?: GenerativeUIEventProp;
  }>(),
  {
    block: undefined,
    pill: undefined,
    disabled: undefined,
    loading: undefined,
    submit: undefined,
    uniform: undefined,
  },
);

defineSlots<{
  /** One child that renders instead of the label. */
  child?: () => unknown;
  /** Children that render instead of the label. */
  children?: () => unknown;
}>();

useStandardStyles();
const aria = useGenerativeUIAccessibility();
const button = useTemplateRef<HTMLButtonElement>("button");
const isCopied = ref(false);

/** Copies text to the clipboard. False when the API is not there. */
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function variantStyle(
  variant: ButtonVariant,
  color: ButtonProps["color"],
): StyleMap {
  const accent =
    color === "danger"
      ? textColor("danger")
      : color === "secondary"
        ? backgroundColor("surface-tertiary")
        : ACCENT;
  const foreground =
    color === "danger" ? textColor("danger") : textColor("default");
  switch (variant) {
    case "primary":
      return {
        background: accent,
        color: color === "secondary" ? foreground : ON_ACCENT,
        border: "1px solid transparent",
      };
    case "soft":
      return {
        background: backgroundColor("surface-secondary"),
        color: foreground,
        border: "1px solid transparent",
      };
    case "default":
      return {
        background: "transparent",
        color: foreground,
        border: `1px solid ${color === "danger" ? accent : borderColor("default")}`,
      };
    case "borderless":
      return { background: "transparent", color: foreground, border: "none" };
  }
}

const buttonSize = computed(() => props.size ?? "lg");
// A warning or an info does not hold the button back.
const failedCheck = computed(() => firstFailedCheck(props.checks));
const isDisabled = computed(() =>
  Boolean(
    props.disabled || props.loading || failedCheck.value?.severity === "error",
  ),
);
const style = computed<StyleMap>(() => {
  const size = buttonSize.value;
  return {
    display: props.block ? "flex" : "inline-flex",
    width: props.block ? "100%" : undefined,
    flexGrow: props.weight,
    alignItems: "center",
    justifyContent: "center",
    gap: px(6),
    boxSizing: "border-box",
    maxWidth: "100%",
    minHeight: px(HEIGHT[size]),
    minWidth: props.uniform ? px(HEIGHT[size]) : undefined,
    padding: props.uniform ? 0 : `0 ${PAD_X[size] + 4}px`,
    fontSize: FONT_SIZE[size],
    fontFamily: "inherit",
    fontWeight: FONT_WEIGHT.medium,
    lineHeight: 1,
    borderRadius: props.pill === false ? radius("md") : "9999px",
    cursor: isDisabled.value ? "not-allowed" : "pointer",
    opacity: isDisabled.value ? 0.5 : undefined,
    ...variantStyle(props.variant ?? "default", props.color),
  };
});

function onButtonClick(event: MouseEvent) {
  // A disabled button sends nothing, also where the DOM still dispatches
  // the click.
  if (isDisabled.value) return;
  // Inside a Pressable, only the innermost control sends its event.
  event.stopPropagation();
  // A submit button inside a <form> lets the Form send onSubmit. Outside
  // of a form, it sends its own onClick.
  const submitsForm = Boolean(props.submit && button.value?.form);
  if (submitsForm) return;
  // The client-side verbs (open a URL, copy text) never reach the agent.
  if (props.href) {
    openUrl(props.href);
    return;
  }
  if (props.copy !== undefined && props.copy !== "") {
    void copyText(props.copy).then((isOk) => {
      if (!isOk) return;
      isCopied.value = true;
      setTimeout(() => {
        isCopied.value = false;
      }, 1500);
    });
    return;
  }
  void props.onClick?.({});
}
</script>

<template>
  <button
    ref="button"
    data-a2ui-input=""
    :type="submit ? 'submit' : 'button'"
    :disabled="isDisabled"
    :title="failedCheck?.message"
    :aria-busy="loading ? true : undefined"
    :data-a2ui-copied="isCopied ? '' : undefined"
    :style="style"
    v-bind="aria"
    @click="onButtonClick"
  >
    <span
      v-if="isCopied"
      aria-hidden="true"
      data-icon="check"
      style="display: flex"
    >
      <CopilotGenerativeUILucideIcon name="check" :size="ICON_PX[buttonSize]" />
    </span>
    <span
      v-else-if="icon"
      aria-hidden="true"
      :data-icon="icon"
      style="display: flex"
    >
      <CopilotGenerativeUILucideIcon :name="icon" :size="ICON_PX[buttonSize]" />
    </span>
    <slot name="child"
      ><slot name="children">{{ asText(label ?? text) }}</slot></slot
    >
  </button>
</template>
