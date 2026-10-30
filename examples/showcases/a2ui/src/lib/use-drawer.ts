import { useEffect, useRef, useState } from "react";
import { useMediaQuery } from "./use-media-query";
import { isBoolean, useStoredState } from "./use-stored-state";

const PINNED_KEY = "research-desk:drawer";

/**
 * The thread drawer's open state. Wide screens pin it beside the chat and
 * remember the choice; narrow screens open it over the chat on demand, and
 * Escape closes it. Focus follows the drawer (into it when it opens, back to
 * its toggle when it closes) so keyboard users never land on <body>.
 */
export function useDrawer() {
  const narrow = useMediaQuery("(max-width: 760px)");
  const [pinned, setPinned] = useStoredState(PINNED_KEY, true, isBoolean);
  const [overlay, setOverlay] = useState(false);
  const open = narrow ? overlay : pinned;

  // Focus targets: the drawer's New question button and the stage's toggle.
  const newQuestionRef = useRef<HTMLButtonElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const focusNext = useRef<"drawer" | "toggle" | null>(null);
  const setOpen = (next: boolean) => {
    focusNext.current = next ? "drawer" : "toggle";
    if (narrow) setOverlay(next);
    else setPinned(next);
  };

  useEffect(() => {
    const target = focusNext.current;
    focusNext.current = null;
    if (target === "drawer") newQuestionRef.current?.focus();
    if (target === "toggle") toggleRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!narrow || !overlay) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      focusNext.current = "toggle";
      setOverlay(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [narrow, overlay]);

  return { narrow, open, setOpen, newQuestionRef, toggleRef };
}
