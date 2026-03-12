import type { TicketModule, ResolvedTicket } from "./ticket-types";

const ticketModules = import.meta.glob<TicketModule>("../tickets/*/index.tsx", {
  eager: true,
});

function derivePathFromRef(url: string): string {
  const parsed = new URL(url);
  return parsed.host + parsed.pathname;
}

function deriveLabelFromRef(url: string): string {
  const parsed = new URL(url);
  const segments = parsed.pathname.split("/").filter(Boolean);
  return segments[segments.length - 1] || parsed.host;
}

export const tickets: ResolvedTicket[] = Object.values(ticketModules).map(
  (mod) => ({
    meta: mod.meta,
    Component: mod.default,
    derivedPath: derivePathFromRef(mod.meta.refs[0]),
    label: deriveLabelFromRef(mod.meta.refs[0]),
  })
);

export const ticketsByPath: Map<string, ResolvedTicket> = new Map(
  tickets.map((t) => [t.derivedPath, t])
);
