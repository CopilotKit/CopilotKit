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
import {
  ɵHoverMenuController,
  ɵinspectorKiteFill,
  ɵinspectorKiteIcon,
  ɵinspectorShortcuts,
} from "@copilotkit/core";

// Core's `ɵinspectorShortcuts` holds the page-lifetime preference, shared by
// every message and chat; this signal mirrors it for templates.
const shortcutsHidden = signal(ɵinspectorShortcuts.hidden);
ɵinspectorShortcuts.subscribe(() =>
  shortcutsHidden.set(ɵinspectorShortcuts.hidden),
);

/** Whether the user hid the Inspector shortcuts until the page reloads. */
export const inspectorShortcutsHidden = shortcutsHidden.asReadonly();

/** @internal Resets the page-lifetime preference. For tests. */
export function ɵresetInspectorShortcuts(): void {
  ɵinspectorShortcuts.reset();
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
        (keydown)="keyboardUsed()"
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
            [attr.viewBox]="kite.viewBox"
            fill="none"
          >
            @for (path of kite.paths; track path.d) {
              <path
                [attr.d]="path.d"
                [attr.fill]="kiteFill(svgId, path) ?? null"
                [attr.stroke]="path.stroke ?? null"
                [attr.stroke-width]="path.strokeWidth ?? null"
                [attr.stroke-linecap]="path.strokeLinecap ?? null"
              />
            }
            <defs>
              @for (gradient of kite.gradients; track gradient.id) {
                <linearGradient
                  [attr.id]="svgId + '-' + gradient.id"
                  [attr.x1]="gradient.x1"
                  [attr.y1]="gradient.y1"
                  [attr.x2]="gradient.x2"
                  [attr.y2]="gradient.y2"
                  gradientUnits="userSpaceOnUse"
                >
                  @for (stop of gradient.stops; track $index) {
                    <stop
                      [attr.offset]="stop.offset ?? null"
                      [attr.stop-color]="stop.color"
                    />
                  }
                </linearGradient>
              }
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
  readonly clicked = output();

  protected readonly labels = injectChatLabels();
  protected readonly WrenchIcon = Wrench;
  protected readonly EyeOffIcon = EyeOff;
  protected readonly menuId = `cpk-inspector-menu-${nextId}`;
  protected readonly svgId = `cpk-inspector-kite-${nextId++}`;
  protected readonly kite = ɵinspectorKiteIcon;
  protected readonly kiteFill = ɵinspectorKiteFill;
  readonly #menu = new ɵHoverMenuController();
  readonly #menuState = signal(this.#menu.getSnapshot());
  protected readonly open = computed(() => this.#menuState().open);
  protected readonly dark = computed(() => this.#menuState().dark);

  readonly #inspector = inject(CopilotInspector);
  readonly #overlay = inject(Overlay);
  readonly #viewContainerRef = inject(ViewContainerRef);
  private readonly _trigger =
    viewChild<ElementRef<HTMLButtonElement>>("trigger");
  private readonly _menuTemplate =
    viewChild.required<TemplateRef<unknown>>("menu");
  private readonly _menu = viewChild(CdkMenu);
  #overlayRef?: OverlayRef;

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
    // The controller decides when the menu is open; the overlay follows it.
    const unsubscribe = this.#menu.subscribe(() => {
      const state = this.#menu.getSnapshot();
      this.#menuState.set(state);
      if (state.open) this.attachOverlay();
      else this.detachOverlay();
    });
    inject(DestroyRef).onDestroy(() => {
      unsubscribe();
      this.#menu.dispose();
      this.detachOverlay();
    });
  }

  protected onPointerEnter(event: PointerEvent): void {
    const trigger = this._trigger()?.nativeElement;
    if (!trigger) return;
    this.#menu.pointerEnter({
      pointerType: event.pointerType,
      disabled: this.disabled(),
      trigger,
    });
  }

  protected keyboardUsed(): void {
    this.#menu.keyboardUsed();
  }

  protected onKeydown(event: KeyboardEvent): void {
    this.#menu.keyboardUsed();
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
    ɵinspectorShortcuts.hide();
  }

  protected cancelClose(): void {
    this.#menu.cancelClose();
  }

  protected scheduleClose(): void {
    this.#menu.scheduleClose();
  }

  protected onMenuFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget as Node | null;
    if (!next) return;
    if (this.#overlayRef?.overlayElement.contains(next)) return;
    if (this._trigger()?.nativeElement.contains(next)) return;
    this.closeMenu();
  }

  private openMenu(): void {
    const trigger = this._trigger()?.nativeElement;
    if (!trigger) return;
    this.#menu.setOpen(true, trigger);
  }

  private closeMenu(): void {
    this.#menu.setOpen(false);
  }

  private attachOverlay(): void {
    const trigger = this._trigger()?.nativeElement;
    if (this.#overlayRef || !trigger) return;
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
  }

  private detachOverlay(): void {
    this.#overlayRef?.dispose();
    this.#overlayRef = undefined;
  }
}
