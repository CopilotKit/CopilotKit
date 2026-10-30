import {
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  PLATFORM_ID,
  TemplateRef,
  ViewContainerRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  model,
  signal,
  untracked,
  viewChild,
} from "@angular/core";
import { isPlatformBrowser } from "@angular/common";
import { CdkTrapFocus } from "@angular/cdk/a11y";
import { Overlay } from "@angular/cdk/overlay";
import type { OverlayRef } from "@angular/cdk/overlay";
import { TemplatePortal } from "@angular/cdk/portal";
import { wrapperAria } from "@copilotkit/core/generative-ui";
import {
  BACKDROP,
  SHADOW_MD,
  backgroundColor,
  radius,
  spacing,
  textColor,
} from "@copilotkit/shared/generative-ui";
import type { GenerativeUIChildren } from "../../children";
import { CopilotGenerativeUIChildren } from "../../children.directive";
import { injectGenerativeUIAccessibility } from "../../node-context";
import { GENERATIVE_UI_RUNTIME } from "../../runtime";
import type { StyleMap } from "../style";
import { injectFeedbackStyles } from "./styles";

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

let modalIds = 0;

/**
 * A modal dialog. The host is the trigger wrapper: a click anywhere on it
 * opens the dialog, and a trigger that is not a control itself gets the
 * button role and a tab stop. The dialog is a CDK overlay on the body, so a
 * transformed chat row does not clip its backdrop; it keeps the surface
 * style scope and the theme variables. While open, Tab cycles inside the
 * dialog, Escape closes it (only the newest overlay: CDK's keyboard
 * dispatcher), and the focus returns to the trigger.
 */
@Component({
  selector: "div[copilotGenerativeUIModal]",
  imports: [CopilotGenerativeUIChildren, CdkTrapFocus],
  template: `
    <ng-container *copilotGenerativeUIChildren="trigger()" />
    <ng-template #dialog>
      <div class="a2ui-surface" [style]="portalStyle()">
        <div
          data-a2ui-modal-backdrop=""
          (click)="setOpen(false)"
          [style]="backdropStyle"
        >
          <div
            role="dialog"
            aria-modal="true"
            tabindex="-1"
            cdkTrapFocus
            [cdkTrapFocusAutoCapture]="true"
            [attr.aria-labelledby]="labelledBy()"
            [attr.aria-label]="aria()['aria-label']"
            [attr.aria-description]="aria()['aria-description']"
            [attr.aria-hidden]="wrapper()['aria-hidden'] ? 'true' : null"
            [attr.aria-live]="wrapper()['aria-live'] ?? null"
            (click)="$event.stopPropagation()"
            [style]="dialogStyle()"
          >
            <div
              [style]="{
                display: 'flex',
                'align-items': 'center',
                'justify-content': 'space-between',
                gap: gap3,
              }"
            >
              @if (title()) {
                <h2
                  [attr.id]="titleId"
                  style="margin: 0; font-size: 1.125em; font-weight: 600"
                >
                  {{ title() }}
                </h2>
              } @else {
                <span></span>
              }
              <button
                type="button"
                aria-label="Close"
                data-a2ui-input=""
                (click)="setOpen(false)"
                [style]="closeStyle"
              >
                <span aria-hidden="true">×</span>
              </button>
            </div>
            <ng-container *copilotGenerativeUIChildren="content()" />
          </div>
        </div>
      </div>
    </ng-template>
  `,
  host: {
    "data-a2ui-std": "",
    "data-a2ui-modal-trigger": "",
    "[attr.role]": "isPlainTrigger() ? 'button' : null",
    "[attr.tabindex]": "isPlainTrigger() ? 0 : null",
    "[attr.aria-haspopup]": "isPlainTrigger() ? 'dialog' : null",
    "[attr.aria-expanded]": "isPlainTrigger() ? isOpen() : null",
    "[style.display]": "'inline-flex'",
    "[style.flex-grow]": "weight()",
    "[style.cursor]": "isPlainTrigger() ? 'pointer' : null",
    "(keydown)": "onKeyDown($event)",
  },
})
export class CopilotGenerativeUIModal {
  readonly title = input<string>();
  readonly open = model<boolean>();
  readonly maxWidth = input<number | string>();
  readonly weight = input<number>();
  readonly trigger = input<GenerativeUIChildren>();
  readonly content = input<GenerativeUIChildren>();

  readonly #id = `a2ui-modal-${++modalIds}`;
  protected readonly titleId = `${this.#id}-title`;
  // The dialog is an overlay, outside the host the engine puts the
  // envelope on, so it takes the envelope itself.
  protected readonly aria = injectGenerativeUIAccessibility();
  protected readonly wrapper = computed(() => wrapperAria(this.aria()));
  protected readonly labelledBy = computed(() =>
    this.title() && this.aria()["aria-label"] === undefined
      ? this.titleId
      : null,
  );
  readonly #ownOpen = signal(false);
  protected readonly isOpen = computed(() => this.open() ?? this.#ownOpen());
  protected readonly isPlainTrigger = signal(false);

  readonly #element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  readonly #isBrowser = isPlatformBrowser(inject(PLATFORM_ID));
  readonly #overlay = inject(Overlay);
  readonly #viewContainer = inject(ViewContainerRef);
  readonly #injector = inject(Injector);
  readonly #runtime = inject(GENERATIVE_UI_RUNTIME, { optional: true });
  protected readonly dialogTemplate =
    viewChild.required<TemplateRef<unknown>>("dialog");
  #overlayRef: OverlayRef | undefined;

  // The overlay takes the theme variables and the surface style scope with it.
  protected readonly portalStyle = computed<StyleMap>(() => {
    const { mapStyle: _mapStyle, ...variables } = this.#runtime?.theme() ?? {};
    return { display: "contents", ...(variables as StyleMap) };
  });
  protected readonly backdropStyle: StyleMap = {
    position: "fixed",
    inset: 0,
    zIndex: 1000,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing(4),
    background: BACKDROP,
  };
  protected readonly gap3 = spacing(3);
  protected readonly dialogStyle = computed<StyleMap>(() => ({
    display: "flex",
    flexDirection: "column",
    gap: spacing(3),
    width: "100%",
    maxWidth: spacing(this.maxWidth() ?? 480),
    maxHeight: "90vh",
    overflow: "auto",
    padding: spacing(5),
    borderRadius: radius("xl"),
    background: backgroundColor("surface"),
    color: textColor("default"),
    boxShadow: SHADOW_MD,
  }));
  protected readonly closeStyle: StyleMap = {
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

  constructor() {
    injectFeedbackStyles();
    const destroyRef = inject(DestroyRef);
    // The capture phase sees the click before a Button inside handles it,
    // and lets it through: the Button still sends its own event, opens its
    // href or copies its text.
    const onClickCapture = (event: Event) => {
      // A disabled control inside the trigger (a Pressable, a Button) keeps
      // the dialog closed, also before its own click handler.
      const target = event.target as Element | null;
      const control = target?.closest(CONTROL);
      if (control && this.#element.contains(control)) {
        if (control.matches(DISABLED)) return;
      }
      this.setOpen(true);
    };
    this.#element.addEventListener("click", onClickCapture, true);
    destroyRef.onDestroy(() =>
      this.#element.removeEventListener("click", onClickCapture, true),
    );
    // The trigger component can stream in after the Modal. So the DOM of
    // the trigger is observed, and the classification follows what is
    // rendered in it. A disabled control is still a control.
    afterNextRender(() => {
      const classify = () =>
        this.isPlainTrigger.set(this.#element.querySelector(CONTROL) === null);
      classify();
      if (typeof MutationObserver === "undefined") return;
      const observer = new MutationObserver(classify);
      observer.observe(this.#element, { childList: true, subtree: true });
      destroyRef.onDestroy(() => observer.disconnect());
    });
    effect(() => {
      const open = this.isOpen();
      untracked(() => (open ? this.#attach() : this.#detach()));
    });
    destroyRef.onDestroy(() => this.#detach());
  }

  protected setOpen(value: boolean) {
    this.#ownOpen.set(value);
    this.open.set(value);
  }

  protected onKeyDown(event: KeyboardEvent) {
    if (!this.isPlainTrigger()) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      this.setOpen(true);
    }
  }

  #attach() {
    if (this.#overlayRef || !this.#isBrowser) return;
    const overlayRef = this.#overlay.create({
      hasBackdrop: false,
      positionStrategy: this.#overlay.position().global().top("0").left("0"),
      scrollStrategy: this.#overlay.scrollStrategies.block(),
    });
    this.#overlayRef = overlayRef;
    overlayRef.attach(
      new TemplatePortal(
        this.dialogTemplate(),
        this.#viewContainer,
        undefined,
        this.#injector,
      ),
    );
    // Escape reaches only the newest overlay: a lightbox inside the dialog
    // closes first, the dialog on the next Escape.
    overlayRef.keydownEvents().subscribe((event) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      this.setOpen(false);
    });
    // The focus trap captures the first focusable; a dialog without one
    // takes the focus itself.
    afterNextRender(
      () => {
        const dialog =
          overlayRef.overlayElement.querySelector<HTMLElement>(
            '[role="dialog"]',
          );
        if (dialog && !dialog.contains(document.activeElement)) {
          (dialog.querySelector<HTMLElement>(FOCUSABLE) ?? dialog).focus();
        }
      },
      { injector: this.#injector },
    );
  }

  #detach() {
    const overlayRef = this.#overlayRef;
    if (!overlayRef) return;
    this.#overlayRef = undefined;
    overlayRef.dispose();
    // The focus returns to the trigger.
    if (this.#isBrowser) {
      const focusable =
        this.#element.querySelector<HTMLElement>(FOCUSABLE) ?? this.#element;
      if (this.isPlainTrigger() || focusable !== this.#element) {
        focusable.focus();
      }
    }
  }
}
