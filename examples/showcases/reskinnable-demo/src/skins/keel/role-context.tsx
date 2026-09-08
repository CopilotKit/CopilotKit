"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Persona } from "@/skins/keel/data/types";
import {
  KEEL_PERSONAS,
  DEFAULT_PERSONA_ID,
  getPersona,
} from "@/skins/keel/data/personas";

interface RoleContextValue {
  persona: Persona;
  personas: Persona[];
  setPersonaId: (id: string) => void;
}

const RoleContext = createContext<RoleContextValue | null>(null);

/**
 * Owns the active demo persona. The shell mounts this ABOVE CopilotKitProvider
 * (via the skin's `RuntimeProviders`), so `useRuntimeProperties` can read it and
 * the provider owns the identity from its first commit — no child racing an
 * imperative setProperties. Everything below the provider (SkinProvider, pages,
 * tools) can read it too.
 */
export function RoleProvider({ children }: { children: ReactNode }) {
  const [personaId, setPersonaId] = useState(DEFAULT_PERSONA_ID);

  const value = useMemo<RoleContextValue>(
    () => ({
      persona: getPersona(personaId),
      personas: KEEL_PERSONAS,
      setPersonaId,
    }),
    [personaId],
  );

  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}

/**
 * Read the active persona. Falls back to the default persona rather than
 * throwing when called outside the provider, so a component rendered in
 * isolation (a test, a storybook-style page) still works.
 */
export function useRole(): RoleContextValue {
  const ctx = useContext(RoleContext);
  if (ctx) return ctx;
  return {
    persona: getPersona(DEFAULT_PERSONA_ID),
    personas: KEEL_PERSONAS,
    setPersonaId: () => {},
  };
}
