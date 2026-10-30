import {
  Component,
  PLATFORM_ID,
  computed,
  inject,
  input,
  signal,
} from "@angular/core";
import { isPlatformBrowser } from "@angular/common";
import {
  ACCENT,
  FONT_WEIGHT,
  ON_ACCENT,
  backgroundColor,
  borderColor,
  firstFailedCheck,
  radius,
  textColor,
} from "@copilotkit/shared/generative-ui";
import type {
  ResolvedChecks,
  buttonSchema,
} from "@copilotkit/shared/generative-ui";
import type { z } from "zod";
import type { GenerativeUIChildren } from "../../children";
import { CopilotGenerativeUIChildren } from "../../children.directive";
import { injectGenerativeUIAccessibility } from "../../node-context";
import { GenerativeUIStyles } from "../../styles";
import type { GenerativeUIEventProp } from "../context";
import { provideContainerContext } from "../context";
import { CopilotGenerativeUIIcon } from "../media";
import { layoutStyle, px } from "../style";
import type { StyleMap } from "../style";
import { openUrl } from "../url";
import { connectVisibleOnce } from "../visible-once";
import { FONT_SIZE, HEIGHT, PAD_X, asText } from "./control";
import { CopilotGenerativeUILayoutInputs } from "./layout-inputs";

type ButtonProps = z.output<typeof buttonSchema>;
type ButtonVariant = NonNullable<ButtonProps["variant"]>;

/** Copies text to the clipboard. False when the API is not there. */
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** True when a slot got content to render. */
function hasChildren(handle: GenerativeUIChildren | undefined) {
  if (!handle) return false;
  return Array.isArray(handle.value) ? handle.value.length > 0 : true;
}

function buttonVariantStyle(
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

/**
 * A button that sends its `onClick` event, opens `href`, or copies `copy`.
 * Inside a Form, a `submit` button submits the Form instead.
 */
const BUTTON_ICON_PX = { sm: 14, md: 16, lg: 18, xl: 18 } as const;

@Component({
  selector: "button[copilotGenerativeUIButton]",
  imports: [CopilotGenerativeUIChildren, CopilotGenerativeUIIcon],
  template: `
    @if (isCopied()) {
      <span aria-hidden="true" data-icon="check" style="display: flex">
        <svg copilotGenerativeUIIcon name="check" [size]="iconPx()"></svg>
      </span>
    } @else if (icon(); as icon) {
      <span aria-hidden="true" [attr.data-icon]="icon" style="display: flex">
        <svg copilotGenerativeUIIcon [name]="icon" [size]="iconPx()"></svg>
      </span>
    }
    @if (hasChild()) {
      <ng-container *copilotGenerativeUIChildren="child()" />
    } @else if (hasChildrenSlot()) {
      <ng-container *copilotGenerativeUIChildren="children()" />
    } @else {
      {{ content() }}
    }
  `,
  host: {
    "data-a2ui-input": "",
    "[attr.type]": "submit() ? 'submit' : 'button'",
    "[attr.aria-label]": "aria()['aria-label'] ?? null",
    "[attr.aria-description]": "aria()['aria-description'] ?? null",
    "[attr.aria-live]": "aria()['aria-live'] ?? null",
    "[attr.aria-hidden]": "aria()['aria-hidden'] ? 'true' : null",
    "[disabled]": "isDisabled()",
    "[attr.title]": "failedCheck()?.message ?? null",
    "[attr.aria-busy]": "loading() ? 'true' : null",
    "[attr.data-a2ui-copied]": "isCopied() ? '' : null",
    "[style]": "style()",
    "(click)": "onClickHost($event)",
  },
})
export class CopilotGenerativeUIButton {
  readonly label = input<string>();
  readonly checks = input<ResolvedChecks>();
  readonly text = input<string>();
  readonly variant = input<ButtonVariant>();
  readonly color = input<ButtonProps["color"]>();
  readonly size = input<ButtonProps["size"]>();
  /** The icon follows the button scale, not the Icon scale. */
  protected readonly iconPx = computed(
    () => BUTTON_ICON_PX[this.size() ?? "lg"],
  );
  readonly block = input<boolean>();
  readonly weight = input<number>();
  readonly pill = input<boolean>();
  readonly disabled = input<boolean>();
  readonly loading = input<boolean>();
  readonly submit = input<boolean>();
  readonly icon = input<string>();
  readonly uniform = input<boolean>();
  readonly href = input<string>();
  readonly copy = input<string>();
  readonly onClick = input<GenerativeUIEventProp>();
  readonly child = input<GenerativeUIChildren>();
  readonly children = input<GenerativeUIChildren>();

  protected readonly aria = injectGenerativeUIAccessibility();
  protected readonly isCopied = signal(false);
  readonly #isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  /** A warning or an info does not hold the button back. */
  protected readonly failedCheck = computed(() =>
    firstFailedCheck(this.checks()),
  );
  protected readonly isDisabled = computed(() =>
    Boolean(
      this.disabled() ||
      this.loading() ||
      this.failedCheck()?.severity === "error",
    ),
  );
  protected readonly content = computed(() =>
    asText(this.label() ?? this.text()),
  );
  protected readonly hasChild = computed(() => hasChildren(this.child()));
  protected readonly hasChildrenSlot = computed(() =>
    hasChildren(this.children()),
  );
  protected readonly style = computed<StyleMap>(() => {
    const buttonSize = this.size() ?? "lg";
    const isDisabled = this.isDisabled();
    return {
      display: this.block() ? "flex" : "inline-flex",
      width: this.block() ? "100%" : undefined,
      flexGrow: this.weight(),
      alignItems: "center",
      justifyContent: "center",
      gap: px(6),
      boxSizing: "border-box",
      maxWidth: "100%",
      minHeight: px(HEIGHT[buttonSize]),
      minWidth: this.uniform() ? px(HEIGHT[buttonSize]) : undefined,
      padding: this.uniform() ? "0" : `0 ${PAD_X[buttonSize] + 4}px`,
      fontSize: FONT_SIZE[buttonSize],
      fontFamily: "inherit",
      fontWeight: FONT_WEIGHT.medium,
      lineHeight: 1,
      borderRadius: this.pill() === false ? radius("md") : "9999px",
      cursor: isDisabled ? "not-allowed" : "pointer",
      opacity: isDisabled ? 0.5 : undefined,
      ...buttonVariantStyle(this.variant() ?? "default", this.color()),
    };
  });

  constructor() {
    inject(GenerativeUIStyles).ensureStandard();
  }

  protected onClickHost(event: MouseEvent) {
    // Inside a Pressable, only the innermost control sends its event.
    event.stopPropagation();
    // A submit button inside a <form> lets the Form send onSubmit. Outside
    // of a form, it sends its own onClick.
    const button = event.currentTarget as HTMLButtonElement;
    if (this.submit() && button.form !== null) return;
    // The client-side verbs (open a URL, copy text) never reach the agent.
    const href = this.href();
    if (href) {
      openUrl(href);
      return;
    }
    const copy = this.copy();
    if (copy !== undefined && copy !== "") {
      if (!this.#isBrowser) return;
      void copyText(copy).then((isOk) => {
        if (!isOk) return;
        this.isCopied.set(true);
        setTimeout(() => this.isCopied.set(false), 1500);
      });
      return;
    }
    void this.onClick()?.({});
  }
}

/**
 * A clickable container. It is a `div` with the button role, not a
 * `<button>`, because it can hold other controls, and a button cannot.
 * Enter and Space on the container itself press it.
 */
@Component({
  selector: "div[copilotGenerativeUIPressable]",
  imports: [CopilotGenerativeUIChildren],
  providers: [provideContainerContext()],
  template: `
    <ng-container *copilotGenerativeUIChildren="children()" />
  `,
  host: {
    role: "button",
    "data-a2ui-input": "",
    "[attr.tabindex]": "disabled() ? -1 : 0",
    "[attr.aria-disabled]": "disabled() ? 'true' : null",
    "[attr.aria-pressed]": "ariaPressed() ?? null",
    "[attr.title]": "tooltip() ?? null",
    "[attr.aria-label]": "aria()['aria-label'] ?? null",
    "[attr.aria-description]": "aria()['aria-description'] ?? null",
    "[attr.aria-live]": "aria()['aria-live'] ?? null",
    "[attr.aria-hidden]": "aria()['aria-hidden'] ? 'true' : null",
    "[style]": "style()",
    "(click)": "onClickHost($event)",
    "(keydown)": "onKeyDown($event)",
    "(mouseenter)": "isHovered.set(true)",
    "(mouseleave)": "isHovered.set(false)",
  },
})
export class CopilotGenerativeUIPressable extends CopilotGenerativeUILayoutInputs {
  readonly disabled = input<boolean>();
  readonly hoverBackground = input<string>();
  readonly href = input<string>();
  readonly tooltip = input<string>();
  readonly ariaPressed = input<boolean>();
  readonly insetBorder = input<boolean>();
  readonly onClick = input<GenerativeUIEventProp>();
  readonly onVisible = input<GenerativeUIEventProp>();
  readonly children = input<GenerativeUIChildren>();

  protected readonly aria = injectGenerativeUIAccessibility();
  protected readonly isHovered = signal(false);
  protected readonly style = computed<StyleMap>(() => {
    const isDisabled = Boolean(this.disabled());
    const hoverBackground = this.hoverBackground();
    const showHoverBackground =
      this.isHovered() && hoverBackground !== undefined && !isDisabled;
    return {
      flexDirection: "column",
      ...layoutStyle(this.layoutProps()),
      cursor: isDisabled ? "not-allowed" : "pointer",
      opacity: isDisabled ? 0.5 : undefined,
      boxShadow: this.insetBorder()
        ? `inset 0 0 0 1px ${borderColor("default")}`
        : undefined,
      ...(showHoverBackground
        ? { background: backgroundColor(hoverBackground) }
        : {}),
    };
  });

  constructor() {
    super();
    inject(GenerativeUIStyles).ensureStandard();
    connectVisibleOnce(() => this.onVisible());
  }

  #press() {
    if (this.disabled()) return;
    const href = this.href();
    if (href) openUrl(href);
    else void this.onClick()?.({});
  }

  protected onClickHost(event: MouseEvent) {
    event.stopPropagation();
    this.#press();
  }

  protected onKeyDown(event: KeyboardEvent) {
    // A key on a nested control (a Button, an input) belongs to it.
    if (event.target !== event.currentTarget) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    this.#press();
  }
}
