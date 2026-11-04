import type { ElementRef, Signal } from "@angular/core";
import { ɵbindDialogFocus, ɵbindPopupDismiss } from "@copilotkit/core";
import { explicitEffect } from "../../explicit-effect";

/** What {@link bindModalDialog} reads from the popup or overlay sidebar. */
export interface ModalDialogBinding {
  /** The dialog element. Undefined while it is closed. */
  dialog: Signal<ElementRef<HTMLElement> | undefined>;
  /** Where focus goes when the dialog opens: the close button. */
  initialFocus: Signal<ElementRef<HTMLElement> | undefined>;
  /** The toggle button. Focus goes back to it when the dialog closes. */
  launcher: Signal<ElementRef<HTMLElement>>;
  clickOutsideToClose: Signal<boolean>;
  close: () => void;
}

/**
 * While the dialog is in the DOM: keep keyboard focus inside it with core's
 * `ɵbindDialogFocus`, and close it on Escape and (when asked) on a pointer
 * down outside with core's `ɵbindPopupDismiss`.
 *
 * Call it in an injection context, such as a constructor.
 */
export function bindModalDialog(binding: ModalDialogBinding): void {
  explicitEffect(
    () => binding.dialog()?.nativeElement,
    (dialog, onCleanup) => {
      if (!dialog) return;
      onCleanup(
        ɵbindDialogFocus(dialog, {
          initialFocus: binding.initialFocus()?.nativeElement,
          returnFocusTo: binding.launcher().nativeElement,
        }),
      );
    },
  );

  explicitEffect(
    () => ({
      dialog: binding.dialog()?.nativeElement,
      clickOutsideToClose: binding.clickOutsideToClose(),
    }),
    ({ dialog, clickOutsideToClose }, onCleanup) => {
      if (!dialog) return;
      onCleanup(
        ɵbindPopupDismiss({
          getContainer: () => dialog,
          onDismiss: binding.close,
          clickOutsideToClose,
        }),
      );
    },
  );
}
