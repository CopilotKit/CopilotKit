import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  TemplateRef,
  ViewContainerRef,
  ViewEncapsulation,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from "@angular/core";
import { CdkMenu, CdkMenuItem } from "@angular/cdk/menu";
import { Overlay, OverlayRef } from "@angular/cdk/overlay";
import { TemplatePortal } from "@angular/cdk/portal";
import { CopilotIcon, EyeOff, Wrench } from "../icons/copilot-icon";
import { CopilotTooltip } from "../../directives/tooltip";
import { CopilotInspector } from "../../inspector";
import { injectChatLabels } from "../../chat-config";
import { cn } from "../../utils";

// Page-lifetime preference, shared by every message and chat, as in React.
// It is not stored, so it does not survive a reload.
const shortcutsHidden = signal(false);

/** Whether the user hid the Inspector shortcuts until the page reloads. */
export const inspectorShortcutsHidden = shortcutsHidden.asReadonly();

/** @internal Resets the page-lifetime preference. For tests. */
export function ɵresetInspectorShortcuts(): void {
  shortcutsHidden.set(false);
}

let nextId = 0;

/**
 * The Inspector shortcut in an assistant message's toolbar, like React's
 * `CopilotChatInspectorButton`. Shown only while the Inspector is enabled
 * (in development). A click opens the message in the Inspector; hovering, or
 * ArrowDown on the button, opens a menu that explains it and can hide it until
 * the page reloads.
 */
@Component({
  selector: "copilot-chat-inspector-button",
  imports: [CdkMenu, CdkMenuItem, CopilotIcon, CopilotTooltip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  host: { style: "display: contents" },
  template: `
    @if (visible()) {
      <button
        #trigger
        type="button"
        data-testid="copilot-inspector-button"
        aria-haspopup="menu"
        [attr.aria-expanded]="open()"
        [attr.aria-controls]="open() ? menuId : null"
        [attr.data-state]="open() ? 'open' : 'closed'"
        [attr.aria-label]="
          labels.assistantMessageToolbarInspectorTitle +
          ' (' +
          labels.assistantMessageToolbarInspectorLocalOnlyLabel.toLowerCase() +
          ')'
        "
        [disabled]="disabled()"
        [class]="buttonClass()"
        (pointerenter)="onPointerEnter($event)"
        (pointerleave)="scheduleClose()"
        (click)="inspect()"
        (keydown)="onKeydown($event)"
      >
        <copilot-icon
          [img]="WrenchIcon"
          iconClass="cpk-inspector-button-icon"
          data-testid="copilot-inspector-icon"
        />
      </button>
    }

    <ng-template #menu>
      <div
        data-copilotkit
        cdkMenu
        [id]="menuId"
        data-state="open"
        data-side="top"
        data-align="start"
        [class]="menuClass()"
        (pointerenter)="cancelClose()"
        (pointerleave)="scheduleClose()"
        (keydown)="openedByHover = false"
        (focusout)="onMenuFocusOut($event)"
      >
        <div class="cpk-dropdown-menu-label cpk-inspector-button-menu-header">
          <span class="cpk-inspector-button-menu-title">
            {{ labels.assistantMessageToolbarInspectorTitle }}
          </span>
          <span
            tabindex="0"
            class="cpk-inspector-button-local-badge"
            [copilotTooltip]="
              labels.assistantMessageToolbarInspectorLocalOnlyDescription
            "
            tooltipPosition="above"
            [tooltipDelay]="1000"
            [tooltipClass]="localTooltipClass()"
            >{{ labels.assistantMessageToolbarInspectorLocalOnlyLabel }}</span
          >
        </div>
        <div role="separator" class="cpk-dropdown-menu-separator"></div>
        <button
          type="button"
          cdkMenuItem
          class="cpk-dropdown-menu-item cpk-inspector-button-menu-item cpk-inspector-button-inspect-item"
          (cdkMenuItemTriggered)="inspect()"
        >
          <svg
            aria-hidden="true"
            class="cpk-inspector-button-kite-icon cpk-inspector-button-menu-item-icon"
            viewBox="4.57 3.36 17.8 17.8"
            fill="none"
          >
            <path
              d="M6.36084 10.9855C8.34277 8.393 9.98843 5.82939 10.6204 3.75914C10.6382 3.70281 10.7043 3.67888 10.7534 3.7114C12.9536 5.16894 16.9635 6.12833 20.5086 6.15085C20.5703 6.15124 20.6124 6.2114 20.5895 6.26829C19.4109 9.25938 17.9705 14.6189 17.9148 20.7392C17.9148 20.8301 17.7873 20.8627 17.7419 20.7837C15.7236 17.2522 9.26021 12.2898 6.39414 11.1186C6.34112 11.0968 6.32556 11.0313 6.36084 10.9855Z"
              [attr.fill]="'url(#' + svgId + '-paint0_linear)'"
            />
            <path
              d="M13.0475 9.39974C9.95016 10.3806 7.11935 10.9259 6.44331 11.0498C6.40027 11.0577 6.39115 11.1172 6.43152 11.134C9.3203 12.3347 15.7516 17.2826 17.7511 20.7998C17.7551 20.8075 17.7647 20.8103 17.7728 20.8068C17.7809 20.803 17.7853 20.793 17.7819 20.7844L13.0475 9.39974Z"
              [attr.fill]="'url(#' + svgId + '-paint1_linear)'"
            />
            <path
              d="M10.762 3.705C13.4137 5.15161 16.4787 5.80132 20.545 6.14367C20.5703 6.14585 20.5787 6.18008 20.5557 6.19197C20.0359 6.45923 17.0574 7.97512 14.8455 8.78701C14.2524 9.00453 13.6564 9.20632 13.0692 9.39249C13.0562 9.39656 13.0419 9.39015 13.0369 9.37774L10.7005 3.75979C10.6849 3.72196 10.7257 3.68538 10.762 3.705Z"
              [attr.fill]="'url(#' + svgId + '-paint2_linear)'"
            />
            <path
              d="M10.7145 3.79041L17.8305 20.7659"
              stroke="#513C9F"
              stroke-width="0.17284"
              stroke-linecap="round"
            />
            <path
              d="M6.44531 11.0476C6.44531 11.0476 10.375 10.3422 14.0686 9.06804C17.7623 7.7939 20.5122 6.23373 20.5122 6.23373"
              stroke="#513C9F"
              stroke-width="0.17284"
              stroke-linecap="round"
            />
            <path
              d="M11.6914 5.93518L9.05534 14.7068M9.05534 14.7068H15.3203M9.05534 14.7068L0.15625 26.3646"
              stroke="#ABABAB"
              stroke-width="0.302474"
              stroke-linecap="round"
            />
            <path
              d="M6.02539 23.9646L4.85806 24.1287C5.46272 25.7287 6.70381 26.4276 8.18528 26.4276C11.8147 26.4276 10.707 22.3227 12.8103 22.3227C14.3358 22.3227 13.7155 25.6498 16.9992 25.6498C19.0029 25.6498 19.2028 23.631 18.8607 22.7625C18.8589 22.7572 18.8568 22.7524 18.8538 22.7476L18.3166 21.9253C18.2817 21.8706 18.1968 21.8912 18.1907 21.9562L18.0908 22.9529C18.0838 23.0222 18.0857 23.0913 18.0936 23.1605C18.1764 23.8491 18.2291 25.5202 16.9992 25.5202C15.7015 25.5202 15.3895 22.2362 12.8103 22.2362C9.78393 22.2362 10.1726 26.298 8.31487 26.298C7.08938 26.298 6.15447 24.9153 6.02539 23.9646Z"
              [attr.fill]="'url(#' + svgId + '-paint3_linear)'"
            />
            <defs>
              <linearGradient
                [attr.id]="svgId + '-paint0_linear'"
                x1="15.5372"
                y1="5.0278"
                x2="12.0802"
                y2="14.534"
                gradientUnits="userSpaceOnUse"
              >
                <stop stop-color="#6430AB" />
                <stop offset="1" stop-color="#AA89D8" />
              </linearGradient>
              <linearGradient
                [attr.id]="svgId + '-paint1_linear'"
                x1="12.8583"
                y1="10.3858"
                x2="8.40764"
                y2="18.9846"
                gradientUnits="userSpaceOnUse"
              >
                <stop stop-color="#005DBB" />
                <stop offset="1" stop-color="#3D92E8" />
              </linearGradient>
              <linearGradient
                [attr.id]="svgId + '-paint2_linear'"
                x1="14.8452"
                y1="5.02774"
                x2="13.5047"
                y2="9.21911"
                gradientUnits="userSpaceOnUse"
              >
                <stop stop-color="#1B70C4" />
                <stop offset="1" stop-color="#54A4F2" />
              </linearGradient>
              <linearGradient
                [attr.id]="svgId + '-paint3_linear'"
                x1="4.85806"
                y1="24.2455"
                x2="18.9963"
                y2="24.2455"
                gradientUnits="userSpaceOnUse"
              >
                <stop stop-color="#4497EA" />
                <stop offset="0.254755" stop-color="#1463B2" />
                <stop offset="0.498725" stop-color="#0A437D" />
                <stop offset="0.666667" stop-color="#2476C8" />
                <stop offset="0.972542" stop-color="#0C549A" />
              </linearGradient>
            </defs>
          </svg>
          <span>
            <span class="cpk-inspector-button-menu-item-label">{{
              primaryLabel()
            }}</span>
            <span class="cpk-inspector-button-menu-item-description">{{
              labels.assistantMessageToolbarInspectorDescription
            }}</span>
          </span>
        </button>
        <!-- A div, like React's (Radix) menu item; CdkMenuItem makes it a
             focusable menuitem. -->
        <div
          cdkMenuItem
          class="cpk-dropdown-menu-item cpk-inspector-button-menu-item cpk-inspector-button-hide-item"
          (cdkMenuItemTriggered)="hideShortcuts()"
        >
          <copilot-icon
            [img]="EyeOffIcon"
            iconClass="cpk-inspector-button-menu-item-icon"
          />
          <span>
            <span class="cpk-inspector-button-menu-item-label">{{
              labels.assistantMessageToolbarInspectorHideLabel
            }}</span>
            <span class="cpk-inspector-button-menu-item-description">{{
              labels.assistantMessageToolbarInspectorHideDescription
            }}</span>
          </span>
        </div>
      </div>
    </ng-template>
  `,
})
export class CopilotChatInspectorButton {
  /** The message to open in the Inspector. */
  readonly messageId = input.required<string>();
  readonly threadId = input<string | undefined>();
  readonly agentId = input<string | undefined>();
  /** Replaces the "View in Inspector" label of the menu item. */
  readonly title = input<string | undefined>();
  readonly disabled = input(false);
  readonly inputClass = input<string | undefined>();
  /** Emits after the message opens in the Inspector. */
  readonly clicked = output<void>();

  protected readonly labels = injectChatLabels();
  protected readonly WrenchIcon = Wrench;
  protected readonly EyeOffIcon = EyeOff;
  protected readonly menuId = `cpk-inspector-menu-${nextId}`;
  protected readonly svgId = `cpk-inspector-kite-${nextId++}`;
  protected readonly open = signal(false);
  protected readonly dark = signal(false);
  protected openedByHover = false;

  readonly #inspector = inject(CopilotInspector);
  readonly #overlay = inject(Overlay);
  readonly #viewContainerRef = inject(ViewContainerRef);
  private readonly _trigger =
    viewChild<ElementRef<HTMLButtonElement>>("trigger");
  private readonly _menuTemplate =
    viewChild.required<TemplateRef<unknown>>("menu");
  private readonly _menu = viewChild(CdkMenu);
  #overlayRef?: OverlayRef;
  #closeTimer?: ReturnType<typeof setTimeout>;

  protected readonly visible = computed(
    () => this.#inspector.isInspectorEnabled && !shortcutsHidden(),
  );
  protected readonly primaryLabel = computed(
    () => this.title() || this.labels.assistantMessageToolbarInspectorLabel,
  );
  protected readonly buttonClass = computed(() =>
    cn(
      "cpk-button cpk-button-assistant-message-toolbar cpk-button-size-icon cpk-inspector-button",
      this.inputClass(),
    ),
  );
  protected readonly menuClass = computed(() =>
    cn(
      "cpk-dropdown-menu-content cpk-inspector-button-menu",
      this.dark() && "dark",
    ),
  );
  protected readonly localTooltipClass = computed(() =>
    cn("cpk-inspector-button-local-tooltip", this.dark() && "dark"),
  );

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.cancelClose();
      this.#overlayRef?.dispose();
    });
  }

  protected onPointerEnter(event: PointerEvent): void {
    if (this.disabled() || event.pointerType === "touch") return;
    this.openedByHover = true;
    this.openMenu();
  }

  protected onKeydown(event: KeyboardEvent): void {
    this.openedByHover = false;
    if (event.key === "Enter" || event.key === " ") {
      // Like a click: open the message, not the menu.
      event.preventDefault();
      this._trigger()?.nativeElement.click();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      this.openMenu();
      this._menu()?.focusFirstItem("keyboard");
    }
  }

  protected inspect(): void {
    this.closeMenu();
    this.#inspector.openInspector({
      messageId: this.messageId(),
      threadId: this.threadId(),
      agentId: this.agentId(),
    });
    this.clicked.emit();
  }

  protected hideShortcuts(): void {
    this.closeMenu();
    shortcutsHidden.set(true);
  }

  protected cancelClose(): void {
    clearTimeout(this.#closeTimer);
    this.#closeTimer = undefined;
  }

  protected scheduleClose(): void {
    this.cancelClose();
    this.#closeTimer = setTimeout(() => {
      // Keep the menu open while the keyboard is using it.
      if (this.openedByHover) this.closeMenu();
    }, 180);
  }

  protected onMenuFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget as Node | null;
    if (!next) return;
    if (this.#overlayRef?.overlayElement.contains(next)) return;
    if (this._trigger()?.nativeElement.contains(next)) return;
    this.closeMenu();
  }

  private openMenu(): void {
    this.cancelClose();
    const trigger = this._trigger()?.nativeElement;
    if (this.#overlayRef || !trigger) return;
    this.dark.set(!!trigger.closest(".dark"));
    const positionStrategy = this.#overlay
      .position()
      .flexibleConnectedTo(trigger)
      .withPositions([
        {
          originX: "start",
          originY: "top",
          overlayX: "start",
          overlayY: "bottom",
          offsetY: -6,
        },
        {
          originX: "start",
          originY: "bottom",
          overlayX: "start",
          overlayY: "top",
          offsetY: 6,
        },
      ]);
    this.#overlayRef = this.#overlay.create({
      positionStrategy,
      scrollStrategy: this.#overlay.scrollStrategies.reposition(),
    });
    this.#overlayRef.attach(
      new TemplatePortal(this._menuTemplate(), this.#viewContainerRef),
    );
    this.#overlayRef.keydownEvents().subscribe((event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      const hadFocus = this.#overlayRef?.overlayElement.contains(
        trigger.ownerDocument.activeElement,
      );
      this.closeMenu();
      if (hadFocus) this._trigger()?.nativeElement.focus();
    });
    this.open.set(true);
  }

  private closeMenu(): void {
    this.cancelClose();
    this.#overlayRef?.dispose();
    this.#overlayRef = undefined;
    this.open.set(false);
  }
}
