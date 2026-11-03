import {
  ChangeDetectionStrategy,
  Component,
  ComponentRef,
  DestroyRef,
  DOCUMENT,
  ElementRef,
  TemplateRef,
  ViewContainerRef,
  ViewEncapsulation,
  inject,
  input,
  output,
  afterNextRender,
  signal,
  viewChild,
} from "@angular/core";
import { NgTemplateOutlet } from "@angular/common";
import { A11yModule } from "@angular/cdk/a11y";
import { Overlay, OverlayRef } from "@angular/cdk/overlay";
import { ComponentPortal } from "@angular/cdk/portal";
import { CopilotIcon, X } from "../icons/copilot-icon";
import { injectChatLabels } from "../../chat-config";

/**
 * A full-screen preview, like React's `<Lightbox>`. It closes on Escape, a
 * click on the backdrop, or its close button, which is named by
 * `labels.attachmentPreviewCloseButtonLabel`. It is a modal dialog: focus
 * moves to the close button, stays inside, and returns to the opener.
 */
@Component({
  selector: "copilot-chat-lightbox",
  imports: [A11yModule, CopilotIcon, NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <div
      class="cpk-attachment-lightbox"
      role="dialog"
      aria-modal="true"
      [attr.aria-label]="label() || null"
      cdkTrapFocus
      (click)="closed.emit()"
    >
      <button
        #closeButton
        type="button"
        class="cpk-attachment-lightbox-close-button"
        [attr.aria-label]="labels.attachmentPreviewCloseButtonLabel"
        (click)="closed.emit()"
      >
        <copilot-icon
          [img]="XIcon"
          iconClass="cpk-attachment-lightbox-close-icon"
        ></copilot-icon>
      </button>
      <div (click)="$event.stopPropagation()">
        <ng-container [ngTemplateOutlet]="content()"></ng-container>
      </div>
    </div>
  `,
})
export class CopilotChatLightbox {
  readonly content = input.required<TemplateRef<unknown>>();
  /** The dialog's accessible name. */
  readonly label = input<string>();
  readonly closed = output<void>();
  readonly labels = injectChatLabels();
  readonly XIcon = X;
  private readonly closeButton =
    viewChild.required<ElementRef<HTMLButtonElement>>("closeButton");

  constructor() {
    afterNextRender(() => this.closeButton().nativeElement.focus());
  }
}

type DocWithVT = Document & {
  startViewTransition?: (cb: () => void) => { finished: Promise<void> };
};

let nextTransitionName = 0;

/**
 * Opens a template in a `CopilotChatLightbox` on `document.body`, like
 * React's `useLightbox()`. Where the browser supports view transitions, the
 * thumbnail morphs into the preview: `view-transition-name` sits on the
 * thumbnail before the change and on the preview (`transitionName`) after it.
 * Call it in an injection context.
 */
export function injectLightbox() {
  const overlay = inject(Overlay);
  const viewContainerRef = inject(ViewContainerRef);
  const document = inject(DOCUMENT) as DocWithVT;
  const transitionName = `cpk-lightbox-${nextTransitionName++}`;
  const isOpen = signal(false);
  let overlayRef: OverlayRef | undefined;
  let thumbnail: HTMLElement | undefined;
  let focusedBefore: HTMLElement | undefined;

  const attach = (content: TemplateRef<unknown>, label: string) => {
    focusedBefore = document.activeElement as HTMLElement | undefined;
    overlayRef = overlay.create();
    const ref: ComponentRef<CopilotChatLightbox> = overlayRef.attach(
      new ComponentPortal(CopilotChatLightbox, viewContainerRef),
    );
    ref.setInput("content", content);
    ref.setInput("label", label);
    ref.instance.closed.subscribe(() => close());
    overlayRef.keydownEvents().subscribe((event) => {
      if (event.key === "Escape") close();
    });
    // Render now, so a view transition sees the new state.
    ref.changeDetectorRef.detectChanges();
    isOpen.set(true);
  };

  const detach = () => {
    const ref = overlayRef;
    overlayRef = undefined;
    ref?.dispose();
    isOpen.set(false);
    // Return focus to the control that opened the preview.
    if (ref && focusedBefore?.isConnected) focusedBefore.focus();
    focusedBefore = undefined;
  };

  /** Opens `content`. `opener` is the thumbnail it morphs from. */
  function open(
    content: TemplateRef<unknown>,
    label: string,
    opener?: HTMLElement,
  ): void {
    if (overlayRef) return;
    thumbnail = opener;
    if (document.startViewTransition && opener) {
      opener.style.viewTransitionName = transitionName;
      document.startViewTransition(() => {
        opener.style.viewTransitionName = "";
        attach(content, label);
      });
    } else {
      attach(content, label);
    }
  }

  function close(): void {
    if (!overlayRef) return;
    const opener = thumbnail;
    if (document.startViewTransition && opener) {
      const transition = document.startViewTransition(() => {
        detach();
        opener.style.viewTransitionName = transitionName;
      });
      const clear = () => (opener.style.viewTransitionName = "");
      transition.finished.then(clear, clear);
    } else {
      detach();
    }
  }

  inject(DestroyRef).onDestroy(detach);

  return { isOpen: isOpen.asReadonly(), transitionName, open, close };
}

export type CopilotChatLightboxRef = ReturnType<typeof injectLightbox>;
