import React, { createContext, useContext, useMemo } from "react";

/**
 * The host-supplied controlled open state for a prebuilt modal surface
 * (`<CopilotSidebar>`, `<CopilotPopup>`).
 */
export interface ModalOpenControl {
  /** Controlled open state. `undefined` leaves the surface uncontrolled. */
  open?: boolean;
  /** Called with the requested state when the surface asks to open or close. */
  onOpenChange?: (open: boolean) => void;
}

const ModalOpenControlContext = createContext<ModalOpenControl>({});

export interface ModalOpenControlProviderProps extends ModalOpenControl {
  children: React.ReactNode;
}

/**
 * Carries `open` / `onOpenChange` from a prebuilt surface down to the view that
 * owns the modal state.
 *
 * A context is required rather than plain props because `<CopilotSidebar>`
 * hands its view to `<CopilotChat>` as a `chatView` **component**. Threading a
 * value that changes (like `open`) through that component's identity would mint
 * a new element type on every toggle, and React unmounts and remounts the whole
 * chat subtree when the element type changes. That is the remount class of bug
 * already fixed for `<CopilotPopup>` on resize. Context keeps the override
 * identity stable while still re-rendering the view when `open` changes.
 */
export function ModalOpenControlProvider({
  open,
  onOpenChange,
  children,
}: ModalOpenControlProviderProps) {
  const value = useMemo<ModalOpenControl>(
    () => ({ open, onOpenChange }),
    [open, onOpenChange],
  );

  return (
    <ModalOpenControlContext.Provider value={value}>
      {children}
    </ModalOpenControlContext.Provider>
  );
}

/**
 * Reads the controlled open state supplied by the surrounding prebuilt
 * surface. Returns an empty control (uncontrolled) when there is none.
 *
 * @returns The host's `open` / `onOpenChange` pair.
 */
export function useModalOpenControl(): ModalOpenControl {
  return useContext(ModalOpenControlContext);
}
