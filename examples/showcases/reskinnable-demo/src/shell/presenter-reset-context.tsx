"use client";

import { createContext, useContext } from "react";
import type { ReactNode } from "react";

/**
 * The presenter/booth demo-reset gate, read SERVER-side in the root layout
 * (`presenterResetEnabled()` — a deliberately non-NEXT_PUBLIC_ env) and threaded
 * to the client through this tiny context. A skin's chrome consumes it via
 * `usePresenterReset()` to decide whether to show a "reset demo state" control.
 *
 * Generic shell chrome (a boolean flag), so it carries no skin coupling; skins
 * that have no reset control simply never call the hook.
 */
const PresenterResetContext = createContext<boolean>(false);

export function PresenterResetProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  return (
    <PresenterResetContext.Provider value={enabled}>
      {children}
    </PresenterResetContext.Provider>
  );
}

export function usePresenterReset(): boolean {
  return useContext(PresenterResetContext);
}
