"use client";
import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { Skin } from "./skin-contract";

const SkinContext = createContext<{ skin: Skin; data: unknown } | null>(null);

export function SkinProvider({
  skin,
  children,
}: {
  skin: Skin;
  children: ReactNode;
}) {
  // Each skin MAY own a data hook; run it here so the skin's components can read
  // it via useSkinData() without every skin re-implementing a provider. `useData`
  // is optional — a skin with no shell-managed data (e.g. banking, which reads
  // REST + auth directly) omits it, and `data` stays undefined. The skin is fixed
  // for this provider's lifetime (SkinLayout remounts on skin change via
  // key={skin.id}), so the optional hook call is order-stable across renders.
  const data = skin.useData?.();
  return (
    <SkinContext.Provider value={{ skin, data }}>
      {children}
    </SkinContext.Provider>
  );
}

export function useSkin(): Skin {
  const ctx = useContext(SkinContext);
  if (!ctx) throw new Error("useSkin must be used within a SkinProvider");
  return ctx.skin;
}

export function useSkinData<T>(): T {
  const ctx = useContext(SkinContext);
  if (!ctx) throw new Error("useSkinData must be used within a SkinProvider");
  return ctx.data as T;
}
