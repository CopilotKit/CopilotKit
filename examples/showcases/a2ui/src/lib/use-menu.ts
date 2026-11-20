import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

const STEPS: Record<string, number> = {
  ArrowDown: 1,
  ArrowRight: 1,
  ArrowUp: -1,
  ArrowLeft: -1,
};

/**
 * What a small menu button needs: the menu closes on a click outside it, on
 * Escape (focus goes back to the button) and on Tab; the arrows, Home and
 * End move focus between its `count` items, wrapping at the ends.
 */
export function useMenu(count: number) {
  const [open, setOpen] = useState(false);
  const [focusIndex, setFocusIndex] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  useEffect(() => {
    if (open) items.current[focusIndex]?.focus();
  }, [open, focusIndex]);

  /** Opens the menu with focus on item `index`. */
  const openAt = (index = 0) => {
    setFocusIndex(index);
    setOpen(true);
  };

  /** Closes the menu and puts focus back on its button. */
  const close = () => {
    setOpen(false);
    button.current?.focus();
  };

  const onMenuKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      close();
    } else if (event.key in STEPS) {
      event.preventDefault();
      setFocusIndex((index) => (index + STEPS[event.key] + count) % count);
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setFocusIndex(event.key === "Home" ? 0 : count - 1);
    } else if (event.key === "Tab") {
      setOpen(false);
    }
  };

  /** A ref callback that registers item `index`. */
  const itemRef = (index: number) => (element: HTMLButtonElement | null) => {
    items.current[index] = element;
  };

  return {
    open,
    openAt,
    close,
    toggle: () => (open ? setOpen(false) : openAt()),
    focusIndex,
    root,
    button,
    itemRef,
    onMenuKeyDown,
  };
}
