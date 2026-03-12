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
    ? tickets.filter((t) => {
        const q = search.toLowerCase();
        return (
          t.meta.title.toLowerCase().includes(q) ||
          t.meta.notes?.toLowerCase().includes(q) ||
          t.label.toLowerCase().includes(q) ||
          t.meta.refs.some((ref) => ref.toLowerCase().includes(q))
        );
      })
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
          placeholder="Search tickets..."
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
