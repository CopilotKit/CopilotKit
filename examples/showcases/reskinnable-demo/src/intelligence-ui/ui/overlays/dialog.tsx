/* eslint-disable react-hooks/set-state-in-effect, react-hooks/refs, react-hooks/immutability -- copied verbatim from the Intelligence web app, whose lint config does not enable the React Compiler rules. */
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { motion } from "motion/react";

import { useScrollEdges } from "../layout/scroll-area";
import { useMotionPreference } from "../motion-preference";
import { getFocusableElements } from "./focus-management";
import { OverlayPortalContainer } from "./portal-container";
import styles from "./dialog.module.css";

export type DialogProps = {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Called after the closing Motion transition releases the Radix portal. */
  readonly onExited?: () => void;
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly children: ReactNode;
  /** Scope product-specific presentation without replacing modal behavior. */
  readonly className?: string;
  readonly footer?: ReactNode;
  readonly closeLabel?: string;
  readonly dismissible?: boolean;
  readonly initialFocusRef?: RefObject<HTMLElement | null>;
  /** Use a persistent target when the action removes the original opener. */
  readonly returnFocusRef?: RefObject<HTMLElement | null>;
  readonly size?: "md" | "lg";
};

/** Radix modal with the existing app-facing Dialog contract and Motion exit. */
export function Dialog({
  open,
  onOpenChange,
  onExited,
  title,
  description,
  children,
  className,
  footer,
  closeLabel = "Close dialog",
  dismissible = true,
  initialFocusRef,
  returnFocusRef,
  size = "md",
}: DialogProps): React.JSX.Element {
  const [present, setPresent] = useState(open);
  const reducedMotion = useMotionPreference();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(
    null,
  );
  const openerRef = useRef<HTMLElement | null>(null);
  const exitFinishedRef = useRef(false);
  const assignDialogRef = useCallback((node: HTMLDivElement | null): void => {
    dialogRef.current = node;
    setPortalContainer(node);
  }, []);

  const finishExit = useCallback((): void => {
    if (exitFinishedRef.current) return;
    exitFinishedRef.current = true;
    setPresent(false);
    onExited?.();
  }, [onExited]);

  useEffect(() => {
    if (open) {
      exitFinishedRef.current = false;
      setPresent(true);
    } else if (reducedMotion && present) {
      finishExit();
    }
  }, [finishExit, open, present, reducedMotion]);

  // Radix closes (and releases its focus trap) as soon as `open` turns false;
  // the content stays mounted only for the exit animation. Focus returns at
  // close, not when the animation ends, so the opener is focused immediately.
  const wasOpenRef = useRef(open);
  const returnFocusTargetRef = useRef(returnFocusRef);
  returnFocusTargetRef.current = returnFocusRef;
  useEffect(() => {
    if (wasOpenRef.current && !open) restoreFocus();
    wasOpenRef.current = open;
  }, [open]);
  // A dialog unmounted while open (rendered only while it is shown) returns
  // focus the same way.
  useEffect(
    () => () => {
      if (wasOpenRef.current) restoreFocus();
    },
    [],
  );

  /** Focuses the caller's return target, else the element that opened it. */
  function restoreFocus(): void {
    const target = returnFocusTargetRef.current?.current ?? openerRef.current;
    if (target?.isConnected) target.focus();
  }

  return (
    <DialogPrimitive.Root
      onOpenChange={(next) => {
        if (next || dismissible) onOpenChange(next);
      }}
      open={open}
    >
      {present ? (
        <DialogPrimitive.Portal forceMount>
          <DialogPrimitive.Overlay asChild forceMount>
            <motion.div
              animate={{ opacity: open ? 1 : 0 }}
              className={styles.backdrop}
              data-cpki-dialog-root="true"
              initial={{ opacity: 0 }}
              transition={{ duration: reducedMotion ? 0 : 0.16 }}
            />
          </DialogPrimitive.Overlay>
          <div className={styles.positioner}>
            <DialogPrimitive.Content
              {...(description === undefined
                ? { "aria-describedby": undefined }
                : {})}
              aria-modal="true"
              asChild
              forceMount
              // Focus already returned when the dialog closed (see above).
              onCloseAutoFocus={(event) => event.preventDefault()}
              onEscapeKeyDown={(event) => {
                if (!dismissible || !open) event.preventDefault();
              }}
              onOpenAutoFocus={(event) => {
                const active = document.activeElement;
                openerRef.current =
                  active instanceof HTMLElement && active !== document.body
                    ? active
                    : null;
                event.preventDefault();
                const target =
                  initialFocusRef?.current ??
                  (dialogRef.current
                    ? getFocusableElements(dialogRef.current).find(
                        (element) =>
                          !element.hasAttribute("data-cpki-dialog-close"),
                      )
                    : undefined) ??
                  dialogRef.current;
                target?.focus();
              }}
              onPointerDownOutside={(event) => {
                if (!dismissible || !open) event.preventDefault();
              }}
            >
              <motion.div
                animate={{
                  opacity: open ? 1 : 0,
                  y: open || reducedMotion ? 0 : 4,
                }}
                className={[styles.dialog, className].filter(Boolean).join(" ")}
                data-size={size}
                initial={{ opacity: 0, y: reducedMotion ? 0 : 4 }}
                onAnimationComplete={() => {
                  if (!open && !reducedMotion) finishExit();
                }}
                ref={assignDialogRef}
                transition={{
                  duration: reducedMotion ? 0 : 0.18,
                  ease: "easeOut",
                }}
              >
                <OverlayPortalContainer.Provider value={portalContainer}>
                  <div className={styles.header} data-cpki-dialog-header>
                    <div>
                      <DialogPrimitive.Title className={styles.title}>
                        {title}
                      </DialogPrimitive.Title>
                      {description !== undefined ? (
                        <DialogPrimitive.Description
                          className={styles.description}
                        >
                          {description}
                        </DialogPrimitive.Description>
                      ) : null}
                    </div>
                    {dismissible ? (
                      <DialogPrimitive.Close
                        aria-label={closeLabel}
                        className={styles.closeButton}
                        data-cpki-dialog-close="true"
                      >
                        <svg
                          aria-hidden="true"
                          width="18"
                          height="18"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                        >
                          <path d="m6 6 12 12M18 6 6 18" />
                        </svg>
                      </DialogPrimitive.Close>
                    ) : null}
                  </div>
                  <DialogBody>{children}</DialogBody>
                  {footer ? (
                    <div className={styles.footer}>{footer}</div>
                  ) : null}
                </OverlayPortalContainer.Provider>
              </motion.div>
            </DialogPrimitive.Content>
          </div>
        </DialogPrimitive.Portal>
      ) : null}
    </DialogPrimitive.Root>
  );
}

/** Scrolling dialog body; marks hidden edges so header and footer can lift. */
function DialogBody({
  children,
}: {
  readonly children: ReactNode;
}): React.JSX.Element {
  const bodyRef = useRef<HTMLDivElement>(null);
  useScrollEdges(bodyRef);
  return (
    <div
      className={styles.body}
      data-cpki-dialog-body
      data-slot="dialog-body"
      ref={bodyRef}
    >
      {children}
    </div>
  );
}
