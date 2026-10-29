import { Component, inject, input, signal } from "@angular/core";
import {
  ON_ACCENT,
  SHADOW_MD,
  backgroundColor,
  radius,
  textFont,
} from "@copilotkit/shared/generative-ui";
import type { GenerativeUIChildren } from "../../children";
import { CopilotGenerativeUIChildren } from "../../children.directive";
import { GenerativeUIStyles } from "../../styles";
import type { StyleMap } from "../style";
import { ensureTextStyles } from "./typography";

let tooltipCount = 0;

/**
 * Shows `content` while the pointer is over `trigger` or while `trigger`
 * has keyboard focus. Escape hides it. The trigger can take focus, and
 * screen readers read the content as its description. Like React's, the
 * tip is positioned next to the trigger (not in an overlay), so the
 * description element is always there for `aria-describedby`.
 */
@Component({
  selector: "span[copilotGenerativeUITooltip]",
  imports: [CopilotGenerativeUIChildren],
  template: `
    <span
      tabindex="0"
      data-a2ui-tooltip-trigger
      [attr.aria-describedby]="id"
      style="display: inline-flex"
      (focus)="open()"
      (blur)="onBlur($event)"
      (keydown)="onKeyDown($event)"
    >
      <ng-container *copilotGenerativeUIChildren="trigger()" />
    </span>
    <span
      role="tooltip"
      [id]="id"
      [hidden]="!isOpen()"
      style="
        position: absolute;
        bottom: 100%;
        left: 50%;
        transform: translateX(-50%);
        padding-bottom: 6px;
        z-index: 10;
      "
    >
      <span [style]="tipStyle">
        <ng-container *copilotGenerativeUIChildren="content()" />
      </span>
    </span>
  `,
  host: {
    // The wrapper hugs the trigger, so the tip centers on the trigger and
    // not on a stretched flex item.
    style:
      "position:relative;display:inline-flex;align-self:flex-start;width:max-content;max-width:100%",
    "(mouseenter)": "open()",
    "(mouseleave)": "close()",
  },
})
export class CopilotGenerativeUITooltip {
  readonly trigger = input<GenerativeUIChildren>();
  readonly content = input<GenerativeUIChildren>();

  protected readonly id = `a2ui-tooltip-${++tooltipCount}`;
  protected readonly isOpen = signal(false);
  // The padding keeps the tooltip open while the pointer moves onto it.
  protected readonly tipStyle: StyleMap = {
    display: "block",
    width: "max-content",
    maxWidth: "240px",
    padding: "4px 8px",
    borderRadius: radius("sm"),
    background: backgroundColor("surface-inverted"),
    color: ON_ACCENT,
    boxShadow: SHADOW_MD,
    ...textFont("xs"),
  };

  constructor() {
    ensureTextStyles(inject(GenerativeUIStyles));
  }

  protected open() {
    this.isOpen.set(true);
  }

  protected close() {
    this.isOpen.set(false);
  }

  protected onBlur(event: FocusEvent) {
    const target = event.currentTarget as HTMLElement | null;
    const isFocusInside = target?.contains(event.relatedTarget as Node | null);
    if (!isFocusInside) this.close();
  }

  protected onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") this.close();
  }
}
