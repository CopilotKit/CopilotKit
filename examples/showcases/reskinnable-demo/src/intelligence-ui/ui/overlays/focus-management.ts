import { type RefObject, useEffect, useLayoutEffect } from 'react';

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const useModalInertnessEffect =
  typeof window === 'undefined' ? useEffect : useLayoutEffect;

const modalInertnessRecords = new WeakMap<
  Element,
  { ariaHidden: string | null; count: number; inert: boolean }
>();

/**
 * Returns visible focusable elements inside a container.
 *
 * @param container Element that owns the focus scope.
 * @returns Focusable descendants in DOM order.
 */
export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(focusableSelector))
    .filter((element) => !element.hasAttribute('disabled'))
    .filter(
      (element) => !element.closest('[hidden], [inert], [aria-hidden="true"]'),
    );
}

/**
 * Moves focus through a modal scope when Tab or Shift+Tab is pressed.
 *
 * @param event Keyboard event from the focus scope.
 * @param container Element that owns the focus scope.
 */
export function cycleFocus(
  event: React.KeyboardEvent,
  container: HTMLElement,
): void {
  if (event.key !== 'Tab') {
    return;
  }

  const focusableElements = getFocusableElements(container);

  if (focusableElements.length === 0) {
    event.preventDefault();
    container.focus();
    return;
  }

  event.preventDefault();

  const activeElement = document.activeElement;
  const activeIndex = focusableElements.findIndex(
    (element) => element === activeElement,
  );
  const currentIndex = activeIndex >= 0 ? activeIndex : 0;
  const direction = event.shiftKey ? -1 : 1;
  const nextIndex =
    (currentIndex + direction + focusableElements.length) %
    focusableElements.length;

  focusableElements[nextIndex]?.focus();
}

/**
 * Saves the current focused element while an overlay is open and restores it when closed.
 *
 * @param isOpen Whether the overlay is open.
 * @param fallbackRef Fallback element to focus when the opener is unavailable.
 */
export function useRestoreFocus(
  isOpen: boolean,
  fallbackRef?: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const opener =
      document.activeElement instanceof HTMLElement &&
      document.activeElement !== document.body
        ? document.activeElement
        : null;

    const fallback = fallbackRef?.current;

    return () => {
      const target = opener?.isConnected ? opener : fallback;
      target?.focus();
    };
  }, [fallbackRef, isOpen]);
}

/**
 * Makes non-dialog body siblings inert while a modal is open.
 *
 * @param isOpen Whether modal inertness should be applied.
 * @param rootRef Ref to the modal root element.
 */
export function useModalInertness(
  isOpen: boolean,
  rootRef: RefObject<HTMLElement | null>,
): void {
  useModalInertnessEffect(() => {
    if (!isOpen || !rootRef.current) {
      return undefined;
    }

    const modalRoot = rootRef.current;
    const siblings = Array.from(document.body.children).filter(
      (element) => element !== modalRoot,
    );

    siblings.forEach((element) => {
      const record = modalInertnessRecords.get(element);
      if (record) {
        record.count += 1;
      } else {
        modalInertnessRecords.set(element, {
          ariaHidden: element.getAttribute('aria-hidden'),
          count: 1,
          inert:
            element instanceof HTMLElement
              ? element.inert
              : element.hasAttribute('inert'),
        });
      }
      element.setAttribute('aria-hidden', 'true');
      if (element instanceof HTMLElement) {
        element.inert = true;
      } else {
        element.setAttribute('inert', '');
      }
    });

    return () => {
      siblings.forEach((element) => {
        const record = modalInertnessRecords.get(element);
        if (!record) {
          return;
        }

        if (record.count > 1) {
          record.count -= 1;
          return;
        }

        modalInertnessRecords.delete(element);
        if (record.ariaHidden === null) {
          element.removeAttribute('aria-hidden');
        } else {
          element.setAttribute('aria-hidden', record.ariaHidden);
        }
        if (element instanceof HTMLElement) {
          element.inert = record.inert;
        } else {
          element.toggleAttribute('inert', record.inert);
        }
      });
    };
  }, [isOpen, rootRef]);
}
