"use client";

import type { ReactNode } from "react";

/**
 * The pointer-events boundary that EVERY interactive in-chat surface roots
 * itself in.
 *
 * CopilotKit paints each `useComponent` / `useHumanInTheLoop` render with
 * `pointer-events: none` on the assistant message (banking documents this at
 * src/skins/banking/tools.tsx ~line 652). Any interactive descendant of such a
 * render — a `<Link>`, `<a>`, `<button>`, `<input>`, anything with `onClick` —
 * is therefore DEAD in chat unless something on its subtree re-enables pointer
 * events with `pointer-events-auto`.
 *
 * That rule was previously applied by hand on each card root, and it was applied
 * INCONSISTENTLY: playbook-card and the `showRun` wrapper both forgot it, which
 * silently killed their policy-citation links — the one interaction that proves
 * the agent's answers are grounded. `ChatSurface` turns the discipline into
 * construction: it carries `pointer-events-auto` structurally, so a card that
 * renders through it CANNOT forget. Author every new in-chat card root as a
 * `ChatSurface` (pass the card's own styling via `className`); never re-invent
 * the raw `pointer-events-auto` string at a call site.
 */
export function ChatSurface({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={`pointer-events-auto${className ? ` ${className}` : ""}`}>
      {children}
    </div>
  );
}
