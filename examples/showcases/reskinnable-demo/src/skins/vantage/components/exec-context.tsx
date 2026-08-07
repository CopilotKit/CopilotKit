"use client";

import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";

export interface Exec {
  id: string;
  name: string;
  role: string;
  initials: string;
}

/**
 * Phase 1 ships ONE exec. Phase 2 adds the CRO and COO plus a switcher, which
 * is what turns beat 4 into a controlled experiment (same pill, two personas,
 * two different boards, because memory is scoped per user). The array shape and
 * setExecId exist now so that addition is purely additive — but no switcher is
 * rendered yet, because a one-option dropdown that changes nothing is a dead
 * control.
 */
export const EXECS: Exec[] = [
  { id: "exec-cfo", name: "Dana Reyes", role: "CFO", initials: "DR" },
];

interface ExecContextValue {
  currentExec: Exec;
  execs: Exec[];
  setExecId: (id: string) => void;
}

const ExecContext = createContext<ExecContextValue | null>(null);

export function ExecContextProvider({ children }: { children: ReactNode }) {
  const [execId, setExecId] = useState(EXECS[0].id);
  const value = useMemo<ExecContextValue>(
    () => ({
      currentExec: EXECS.find((e) => e.id === execId) ?? EXECS[0],
      execs: EXECS,
      setExecId,
    }),
    [execId],
  );
  return <ExecContext.Provider value={value}>{children}</ExecContext.Provider>;
}

export function useExecContext(): ExecContextValue {
  const value = useContext(ExecContext);
  if (!value) {
    throw new Error("useExecContext must be used inside ExecContextProvider");
  }
  return value;
}
