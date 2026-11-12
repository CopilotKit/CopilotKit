/* eslint-disable react-hooks/set-state-in-effect -- copied verbatim from the Intelligence web app, whose lint config does not enable the React Compiler rules. */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { motion } from "motion/react";

import { useMotionPreference } from "../motion-preference";
import { OverlayPortalContainer } from "./portal-container";

import styles from "./registry-sheet.module.css";

export interface SheetProps {
  readonly children: ReactNode;
  readonly closeLabel?: string;
  readonly focusPanel?: boolean;
  readonly onExited?: () => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
  readonly side?: "left" | "right";
  readonly title: string;
}

/** Radix Sheet from the selected registry, with Motion-managed side entry. */
export function Sheet({
  children,
  closeLabel,
  focusPanel = false,
  onExited,
  onOpenChange,
  open,
  returnFocusRef,
  side = "left",
  title,
}: SheetProps): React.JSX.Element {
  const [present, setPresent] = useState(open);
  const reducedMotion = useMotionPreference();
  const offscreen = side === "right" ? "100%" : "-100%";
  const exitFinishedRef = useRef(false);
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(
    null,
  );
  const assignPortalContainer = useCallback(
    (node: HTMLElement | null): void => {
      setPortalContainer(node);
    },
    [],
  );

  /** Removes the portal once, after the panel reaches its closing position. */
  const finishExit = useCallback((): void => {
    if (exitFinishedRef.current) return;
    exitFinishedRef.current = true;
    setPresent(false);
    onExited?.();
    queueMicrotask(() => {
      if (returnFocusRef?.current?.isConnected) returnFocusRef.current.focus();
    });
  }, [onExited, returnFocusRef]);

  useEffect(() => {
    if (open) {
      exitFinishedRef.current = false;
      setPresent(true);
    } else if (reducedMotion && present) finishExit();
  }, [finishExit, open, present, reducedMotion]);

  return (
    <DialogPrimitive.Root open={present} onOpenChange={onOpenChange}>
      {present ? (
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay asChild>
            <motion.div
              animate={{ opacity: open ? 1 : 0 }}
              className={styles.overlay}
              initial={{ opacity: 0 }}
              transition={{ duration: reducedMotion ? 0 : 0.18 }}
            />
          </DialogPrimitive.Overlay>
          <DialogPrimitive.Content
            asChild
            onOpenAutoFocus={(event) => {
              if (focusPanel) {
                event.preventDefault();
                (event.currentTarget as HTMLElement).focus();
              }
            }}
            onCloseAutoFocus={(event) => {
              if (returnFocusRef?.current) {
                event.preventDefault();
                returnFocusRef.current.focus();
              }
            }}
          >
            <motion.div
              animate={{ x: open ? 0 : offscreen }}
              aria-modal="true"
              className={styles.content}
              data-side={side}
              initial={{ x: offscreen }}
              ref={assignPortalContainer}
              onAnimationComplete={() => {
                if (!open && !reducedMotion) finishExit();
              }}
              tabIndex={focusPanel ? -1 : undefined}
              transition={
                reducedMotion
                  ? { duration: 0 }
                  : { type: "spring", duration: 0.22, bounce: 0.18 }
              }
            >
              <OverlayPortalContainer.Provider value={portalContainer}>
                <DialogPrimitive.Title className={styles.title}>
                  {title}
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className={styles.title}>
                  Panel for {title}
                </DialogPrimitive.Description>
                {children}
                <DialogPrimitive.Close
                  aria-label={closeLabel ?? "Close navigation"}
                  className={styles.close}
                >
                  <X aria-hidden="true" size={18} />
                </DialogPrimitive.Close>
              </OverlayPortalContainer.Provider>
            </motion.div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      ) : null}
    </DialogPrimitive.Root>
  );
}
