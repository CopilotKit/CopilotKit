import {
  Component,
  DestroyRef,
  ElementRef,
  InjectionToken,
  PLATFORM_ID,
  computed,
  effect,
  forwardRef,
  inject,
  input,
  model,
} from "@angular/core";
import { isPlatformBrowser } from "@angular/common";
import { controlAria } from "@copilotkit/core/generative-ui";
import {
  SHADOW_MD,
  backgroundColor,
  borderColor,
  radius,
  spacing,
} from "@copilotkit/shared/generative-ui";
import type { popoverContentSchema } from "@copilotkit/shared/generative-ui";
import type { z } from "zod";
import type { GenerativeUIChildren } from "../../children";
import { CopilotGenerativeUIChildren } from "../../children.directive";
import { injectGenerativeUIAccessibility } from "../../node-context";
import { px } from "../style";
import type { StyleMap } from "../style";
import { BUTTON_RESET, injectFeedbackStyles } from "./styles";

type PopoverContentProps = z.output<typeof popoverContentSchema>;
type Side = NonNullable<PopoverContentProps["side"]>;
type Align = NonNullable<PopoverContentProps["align"]>;

/** What a PopoverTrigger and a PopoverContent read from their Popover. */
export interface GenerativeUIPopoverState {
  /** True while the Popover is open. */
  readonly isOpen: () => boolean;
  setOpen(value: boolean): void;
  readonly triggerId: string;
  readonly contentId: string;
  /** The trigger button, set by the PopoverTrigger. */
  trigger: HTMLElement | undefined;
}

/** The Popover around a PopoverTrigger or a PopoverContent. */
export const GENERATIVE_UI_POPOVER =
  new InjectionToken<GenerativeUIPopoverState>("GENERATIVE_UI_POPOVER");

let popoverIds = 0;

/**
 * A non-modal overlay. It does not trap focus. Escape closes it and moves
 * focus back to the trigger. A pointer press outside of it closes it.
 * `open` is writable, so a `{ "@path" }` binding keeps the open state in the
 * data model. The content sits in the flow of the surface, positioned
 * against this root, as in React.
 */
@Component({
  selector: "div[copilotGenerativeUIPopover]",
  imports: [CopilotGenerativeUIChildren],
  providers: [
    {
      provide: GENERATIVE_UI_POPOVER,
      useExisting: forwardRef(() => CopilotGenerativeUIPopover),
    },
  ],
  template: `
    <ng-container *copilotGenerativeUIChildren="children()" />
  `,
  host: {
    "data-a2ui-std": "",
    style: "position:relative;display:inline-flex",
    "(keydown)": "onKeyDown($event)",
    "(mouseenter)": "onMouseEnter()",
    "(mouseleave)": "onMouseLeave()",
  },
})
export class CopilotGenerativeUIPopover implements GenerativeUIPopoverState {
  readonly open = model<boolean>();
  readonly showOnHover = input<boolean>();
  readonly hoverOpenDelay = input<number>();
  readonly children = input<GenerativeUIChildren>();

  readonly #id = `a2ui-popover-${++popoverIds}`;
  readonly triggerId = `${this.#id}-trigger`;
  readonly contentId = `${this.#id}-content`;
  trigger: HTMLElement | undefined;

  readonly #element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  readonly #isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  #hoverTimer: ReturnType<typeof setTimeout> | undefined;

  readonly isOpen = computed(() => this.open() ?? false);

  constructor() {
    injectFeedbackStyles();
    effect((onCleanup) => {
      if (!this.isOpen() || !this.#isBrowser) return;
      const onPointerDown = (event: Event) => {
        const isOutside =
          event.target instanceof Node && !this.#element.contains(event.target);
        if (isOutside) this.setOpen(false);
      };
      document.addEventListener("pointerdown", onPointerDown);
      onCleanup(() =>
        document.removeEventListener("pointerdown", onPointerDown),
      );
    });
  }

  setOpen(value: boolean) {
    this.open.set(value);
  }

  protected onKeyDown(event: KeyboardEvent) {
    if (event.key !== "Escape" || !this.isOpen()) return;
    // Escape closes only the topmost overlay.
    event.stopPropagation();
    this.setOpen(false);
    this.trigger?.focus();
  }

  protected onMouseEnter() {
    if (!this.showOnHover()) return;
    if (this.#hoverTimer) clearTimeout(this.#hoverTimer);
    const delay = this.hoverOpenDelay() ?? 0;
    if (delay > 0) {
      this.#hoverTimer = setTimeout(() => this.setOpen(true), delay);
    } else {
      this.setOpen(true);
    }
  }

  protected onMouseLeave() {
    if (!this.showOnHover()) return;
    if (this.#hoverTimer) clearTimeout(this.#hoverTimer);
    this.setOpen(false);
  }
}

/**
 * The trigger of a Popover. Outside of a Popover it is a plain button that
 * does nothing (React renders its children bare there; a host element cannot
 * disappear in Angular).
 */
@Component({
  selector: "button[copilotGenerativeUIPopoverTrigger]",
  imports: [CopilotGenerativeUIChildren],
  template: `
    <ng-container *copilotGenerativeUIChildren="children()" />
  `,
  host: {
    type: "button",
    "data-a2ui-std": "",
    "data-a2ui-feedback-button": "",
    "data-a2ui-popover-trigger": "",
    "[attr.id]": "popover?.triggerId",
    "[attr.aria-haspopup]": "popover ? 'dialog' : null",
    "[attr.aria-expanded]": "popover ? popover.isOpen() : null",
    "[attr.aria-controls]":
      "popover && popover.isOpen() ? popover.contentId : null",
    "[attr.aria-label]": "aria()['aria-label']",
    "[attr.aria-description]": "aria()['aria-description']",
    "[style]": "style()",
  },
})
export class CopilotGenerativeUIPopoverTrigger {
  readonly block = input<boolean>();
  readonly children = input<GenerativeUIChildren>();

  readonly #aria = injectGenerativeUIAccessibility();
  protected readonly aria = computed(() => controlAria(this.#aria()));
  protected readonly popover = inject(GENERATIVE_UI_POPOVER, {
    optional: true,
  });

  protected readonly style = computed<StyleMap>(() => ({
    ...BUTTON_RESET,
    display: this.block() ? "flex" : "inline-flex",
    width: this.block() ? "100%" : undefined,
    "align-items": "center",
    "min-width": "24px",
    "min-height": "24px",
    "border-radius": radius("xs"),
  }));

  constructor() {
    injectFeedbackStyles();
    const element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    const popover = this.popover;
    if (!popover) return;
    popover.trigger = element;
    // The capture phase: a Button child stops the propagation of its own
    // click (so it never bubbles into a Pressable), which would leave the
    // trigger without the click.
    const toggle = () => popover.setOpen(!popover.isOpen());
    element.addEventListener("click", toggle, true);
    inject(DestroyRef).onDestroy(() => {
      element.removeEventListener("click", toggle, true);
      if (popover.trigger === element) popover.trigger = undefined;
    });
  }
}

/** Where the content sits: on `side` of the trigger, `offset` pixels away. */
function sideStyle(side: Side, offset: number): StyleMap {
  switch (side) {
    case "bottom":
      return { top: "100%", "margin-top": px(offset) };
    case "top":
      return { bottom: "100%", "margin-bottom": px(offset) };
    case "left":
      return { right: "100%", "margin-right": px(offset) };
    case "right":
      return { left: "100%", "margin-left": px(offset) };
  }
}

/** Where the content sits along the side of the trigger. */
function alignStyle(side: Side, align: Align): StyleMap {
  const isVertical = side === "top" || side === "bottom";
  switch (align) {
    case "start":
      return isVertical ? { left: 0 } : { top: 0 };
    case "end":
      return isVertical ? { right: 0 } : { bottom: 0 };
    case "center":
      return isVertical
        ? { left: "50%", transform: "translateX(-50%)" }
        : { top: "50%", transform: "translateY(-50%)" };
  }
}

const PANEL_STYLE: StyleMap = {
  "z-index": 50,
  "min-width": "160px",
  "box-sizing": "border-box",
  display: "flex",
  "flex-direction": "column",
  gap: spacing(2),
  padding: spacing(3),
  background: backgroundColor("surface-elevated"),
  border: `1px solid ${borderColor("default")}`,
  "border-radius": radius("lg"),
  "box-shadow": SHADOW_MD,
};

/**
 * The body of a Popover, shown only when the Popover is open. Outside of a
 * Popover, it is a plain panel that always shows.
 */
@Component({
  selector: "div[copilotGenerativeUIPopoverContent]",
  imports: [CopilotGenerativeUIChildren],
  template: `
    @if (isShown()) {
      <ng-container *copilotGenerativeUIChildren="children()" />
    }
  `,
  host: {
    "data-a2ui-std": "",
    "[attr.role]": "popover && isShown() ? 'dialog' : null",
    "[attr.id]": "popover ? popover.contentId : null",
    "[attr.aria-labelledby]": "popover && isShown() ? popover.triggerId : null",
    "[style]": "style()",
  },
})
export class CopilotGenerativeUIPopoverContent {
  readonly side = input<Side>();
  readonly sideOffset = input<number>();
  readonly align = input<Align>();
  readonly width = input<number | string>();
  readonly children = input<GenerativeUIChildren>();

  protected readonly popover = inject(GENERATIVE_UI_POPOVER, {
    optional: true,
  });
  protected readonly isShown = computed(
    () => !this.popover || this.popover.isOpen(),
  );

  protected readonly style = computed<StyleMap>(() => {
    if (!this.popover) {
      return {
        ...PANEL_STYLE,
        position: "relative",
        width: spacing(this.width()),
      };
    }
    if (!this.popover.isOpen()) return { display: "none" };
    const side = this.side() ?? "bottom";
    return {
      ...PANEL_STYLE,
      position: "absolute",
      ...sideStyle(side, this.sideOffset() ?? 6),
      ...alignStyle(side, this.align() ?? "center"),
      width: spacing(this.width()),
    };
  });

  constructor() {
    injectFeedbackStyles();
  }
}
