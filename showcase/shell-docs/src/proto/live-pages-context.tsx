"use client";

import { createContext, useContext } from "react";
import type { ReactNode } from "react";
import type { PageIndex } from "@/lib/live-pages";

/**
 * Where every live page lives (`src/lib/live-pages.ts`), for the stack picker:
 * switching frontend or framework keeps the reader on the same page when the
 * new stack has it, and opens the new stack's home when it doesn't.
 */
const LivePagesContext = createContext<PageIndex | null>(null);

export function LivePagesProvider({
  index,
  children,
}: {
  index: PageIndex | null;
  children: ReactNode;
}) {
  return <LivePagesContext value={index}>{children}</LivePagesContext>;
}

export function useLivePages() {
  return useContext(LivePagesContext);
}
