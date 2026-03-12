# Tickets Page Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "Tickets" section to the app where developers can track and reproduce customer issues, with a sidebar listing all tickets and a search across reference URLs.

**Architecture:** Splat route (`routes/tickets/$.tsx`) catches all `/tickets/*` URLs. Ticket files live outside the routes directory (`src/tickets/`) to avoid TanStack Router auto-registration. `import.meta.glob` discovers all ticket modules at build time and builds a lookup map keyed by a path derived from each ticket's first reference URL.

**Tech Stack:** React, TanStack Router (file-based routing, splat routes), Tailwind CSS, Vite `import.meta.glob`

---

### Task 1: Create the TicketMeta type

**Files:**
- Create: `app/client/src/lib/ticket-types.ts` (append to existing file)

**Step 1: Add the TicketMeta type to the existing types file**

Add to the bottom of `app/client/src/lib/canvas-types.ts`... actually, create a dedicated file since tickets are a separate concern:

```ts
// app/client/src/lib/ticket-types.ts
export type TicketMeta = {
  title: string;
  refs: string[];
  notes?: string;
};

export type TicketModule = {
  meta: TicketMeta;
  default: React.ComponentType;
};

export type ResolvedTicket = {
  meta: TicketMeta;
  Component: React.ComponentType;
  derivedPath: string;
  label: string;
};
```

**Step 2: Commit**

```bash
git add app/client/src/lib/ticket-types.ts
git commit -m "feat: add TicketMeta types for ticket tracking system"
```

---

### Task 2: Create the first example ticket

**Files:**
- Create: `app/client/src/tickets/tkt-869.tsx`

**Important:** This goes in `src/tickets/`, NOT inside `src/routes/`. This prevents TanStack Router from treating ticket files as route files.

**Step 1: Create the ticket file**

```tsx
// app/client/src/tickets/tkt-869.tsx
import type { TicketMeta } from "../lib/ticket-types";

export const meta: TicketMeta = {
  title: "Calendar widget doesn't load for enterprise accounts",
  refs: [
    "https://app.getorca.ai/tickets/TKT-869?status=open&account=68386015b3522d6393dca6d0",
    "https://discord.com/channels/xxx/yyy/zzz",
  ],
  notes: "Happens only when the account has >50 team members. Related to pagination bug.",
};

export default function TKT869() {
  return (
    <div className="p-4">
      <p className="text-gray-500 italic">Reproduction sandbox — implement the issue reproduction here.</p>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add app/client/src/tickets/tkt-869.tsx
git commit -m "feat: add example ticket TKT-869"
```

---

### Task 3: Create the ticket discovery utility

**Files:**
- Create: `app/client/src/lib/ticket-registry.ts`

This module uses `import.meta.glob` to discover all ticket files and builds the lookup structures the sidebar and splat route need.

**Step 1: Create the registry module**

```ts
// app/client/src/lib/ticket-registry.ts
import type { TicketModule, ResolvedTicket } from "./ticket-types";

const ticketModules = import.meta.glob<TicketModule>("../tickets/*.tsx", {
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
```

**Step 2: Commit**

```bash
git add app/client/src/lib/ticket-registry.ts
git commit -m "feat: add ticket discovery registry using import.meta.glob"
```

---

### Task 4: Create the tickets splat route with sidebar layout

**Files:**
- Create: `app/client/src/routes/tickets/$.tsx`

This is the main file — it renders the two-pane layout with sidebar and content area.

**Step 1: Create the splat route**

```tsx
// app/client/src/routes/tickets/$.tsx
import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { tickets, ticketsByPath } from "../../lib/ticket-registry";
import type { ResolvedTicket } from "../../lib/ticket-types";

export const Route = createFileRoute("/tickets/$")({
  component: TicketsPage,
});

function TicketsPage() {
  const { _splat } = useParams({ from: "/tickets/$" });
  const [search, setSearch] = useState("");

  const activeTicket = _splat ? ticketsByPath.get(_splat) : undefined;

  const filteredTickets = search
    ? tickets.filter((t) =>
        t.meta.refs.some((ref) =>
          ref.toLowerCase().includes(search.toLowerCase())
        )
      )
    : tickets;

  return (
    <div className="flex h-full">
      <Sidebar
        tickets={filteredTickets}
        activeTicket={activeTicket}
        search={search}
        onSearchChange={setSearch}
      />
      <div className="flex-1 overflow-auto">
        {activeTicket ? (
          <TicketContent ticket={activeTicket} />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-400">
            Select a ticket from the sidebar
          </div>
        )}
      </div>
    </div>
  );
}

function Sidebar({
  tickets,
  activeTicket,
  search,
  onSearchChange,
}: {
  tickets: ResolvedTicket[];
  activeTicket: ResolvedTicket | undefined;
  search: string;
  onSearchChange: (value: string) => void;
}) {
  return (
    <div className="w-64 border-r border-gray-200 flex flex-col h-full bg-gray-50">
      <div className="p-3 border-b border-gray-200">
        <input
          type="text"
          placeholder="Search by URL..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
        />
      </div>
      <div className="flex-1 overflow-y-auto">
        {tickets.length === 0 ? (
          <div className="p-3 text-sm text-gray-400 italic">No tickets found</div>
        ) : (
          tickets.map((ticket) => (
            <SidebarItem
              key={ticket.derivedPath}
              ticket={ticket}
              isActive={activeTicket?.derivedPath === ticket.derivedPath}
              search={search}
            />
          ))
        )}
      </div>
    </div>
  );
}

function SidebarItem({
  ticket,
  isActive,
  search,
}: {
  ticket: ResolvedTicket;
  isActive: boolean;
  search: string;
}) {
  return (
    <Link
      to="/tickets/$"
      params={{ _splat: ticket.derivedPath }}
      className={`block p-3 border-b border-gray-100 hover:bg-gray-100 transition-colors ${
        isActive ? "bg-blue-50 border-l-2 border-l-blue-500" : ""
      }`}
    >
      <div className="text-sm font-medium text-gray-900">{ticket.label}</div>
      <div className="text-xs text-gray-500 truncate mt-0.5">{ticket.meta.title}</div>
      <div className="mt-1 space-y-0.5">
        {ticket.meta.refs.map((ref) => {
          const isMatch =
            search && ref.toLowerCase().includes(search.toLowerCase());
          return (
            <div
              key={ref}
              className={`text-xs truncate ${
                isMatch ? "text-blue-600 font-medium" : "text-gray-400"
              }`}
            >
              {ref.replace(/^https?:\/\//, "").split("?")[0]}
            </div>
          );
        })}
      </div>
    </Link>
  );
}

function TicketContent({ ticket }: { ticket: ResolvedTicket }) {
  const { Component } = ticket;
  return (
    <div className="h-full flex flex-col">
      <div className="p-6 border-b border-gray-200 bg-white">
        <h1 className="text-lg font-semibold text-gray-900">
          {ticket.meta.title}
        </h1>
        {ticket.meta.notes && (
          <p className="mt-1 text-sm text-gray-500">{ticket.meta.notes}</p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          {ticket.meta.refs.map((ref) => (
            <a
              key={ref}
              href={ref}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center px-2 py-1 text-xs bg-gray-100 text-blue-600 rounded hover:bg-gray-200 truncate max-w-xs"
            >
              {ref.replace(/^https?:\/\//, "").split("?")[0]}
            </a>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-auto">
        <Component />
      </div>
    </div>
  );
}
```

**Step 2: Run the dev server to verify TanStack Router generates the route**

Run: `cd app && bun run dev`

Expected: The route tree regenerates to include the `/tickets/$` splat route. Navigate to `http://localhost:3000/tickets` and see the sidebar with the example ticket.

**Step 3: Commit**

```bash
git add app/client/src/routes/tickets/\$.tsx
git commit -m "feat: add tickets splat route with sidebar layout and search"
```

---

### Task 5: Add "Tickets" link to the header nav

**Files:**
- Modify: `app/client/src/routes/__root.tsx:24-29`

**Step 1: Add the Tickets link after the Headless UI link**

In `__root.tsx`, inside the `<nav>` element, after the Headless UI link, add:

```tsx
<Link to="/tickets/$" params={{ _splat: "" }} className="text-sm font-medium text-gray-700 hover:text-gray-900">
  Tickets
</Link>
```

Note: We link to `/tickets/$` with an empty splat so it resolves to `/tickets` (the index/empty state). If TanStack Router doesn't support this cleanly, use a plain `<a href="/tickets">` or `useNavigate` instead — verify during implementation.

**Step 2: Run the dev server and verify**

Run: `cd app && bun run dev`

Expected: "Tickets" appears in the header nav. Clicking it navigates to `/tickets` showing the sidebar with the empty state on the right.

**Step 3: Commit**

```bash
git add app/client/src/routes/__root.tsx
git commit -m "feat: add Tickets link to header navigation"
```

---

### Task 6: Verify the full flow end-to-end

**Step 1: Start the app**

Run: `cd app && bun run dev`

**Step 2: Manual verification checklist**

1. Header shows "Tickets" link
2. Clicking "Tickets" shows sidebar with TKT-869 entry and empty state content area
3. TKT-869 sidebar item shows: label, title, both reference URLs
4. Clicking TKT-869 navigates to `/tickets/app.getorca.ai/tickets/TKT-869`
5. Content area shows the common header (title, notes, clickable ref links) and the sandbox component
6. Search input filters: typing "discord" shows TKT-869 (discord ref highlighted), typing "nonexistent" shows "No tickets found"
7. Clicking a ref link in the content header opens it in a new tab

**Step 3: Commit any fixes needed, then final commit**

```bash
git add -A
git commit -m "feat: tickets page - complete implementation"
```
