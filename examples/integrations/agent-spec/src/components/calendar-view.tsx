"use client";

import { useState } from "react";

interface Guest {
  email: string;
  status: "accepted" | "declined" | "maybe" | "pending";
}

export interface CalendarEvent {
  startTime: string;
  endTime: string;
  title: string;
  isAvailable: boolean;
  guests?: Guest[];
}

interface CalendarViewProps {
  date: string;
  dayName: string;
  events: CalendarEvent[];
}

function formatTime(t: string): string {
  const [h, m] = t.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const display = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return m ? `${display}:${String(m).padStart(2, "0")} ${suffix}` : `${display} ${suffix}`;
}

function formatTimeShort(t: string): string {
  const [h] = t.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const display = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${display} ${suffix}`;
}

function getDuration(start: string, end: string): string {
  if (!end) return "";
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const mins = (eh * 60 + (em || 0)) - (sh * 60 + (sm || 0));
  if (mins >= 60) return `${mins / 60}h`;
  return `${mins}m`;
}

function formatDateBadge(date: string, dayName: string): string {
  try {
    const d = new Date(date + "T00:00:00");
    const month = d.toLocaleDateString("en-US", { month: "short" });
    const day = d.getDate();
    return `${dayName.slice(0, 3)}, ${month} ${day}`;
  } catch {
    return date;
  }
}

function getGuestInitial(email: string): string {
  const name = email.split("@")[0].split(".")[0];
  return (name[0] || "?").toUpperCase();
}

function getGuestName(email: string): string {
  const local = email.split("@")[0];
  return local
    .split(".")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

const STATUS_ICONS: Record<string, { color: string; icon: string }> = {
  accepted: { color: "text-emerald-500", icon: "M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
  declined: { color: "text-red-500", icon: "M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
  maybe: { color: "text-amber-500", icon: "M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" },
  pending: { color: "text-gray-400", icon: "M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" },
};

const GUEST_AVATAR_COLORS = [
  "bg-blue-500", "bg-emerald-500", "bg-violet-500", "bg-amber-500",
  "bg-rose-500", "bg-cyan-500", "bg-pink-500", "bg-teal-500",
];

function getGuestAvatarColor(email: string): string {
  let hash = 0;
  for (let i = 0; i < email.length; i++) {
    hash = email.charCodeAt(i) + ((hash << 5) - hash);
  }
  return GUEST_AVATAR_COLORS[Math.abs(hash) % GUEST_AVATAR_COLORS.length];
}

export function CalendarView({ date, dayName, events }: CalendarViewProps) {
  const [selected, setSelected] = useState<number | null>(null);
  const [rsvp, setRsvp] = useState<string | null>(null);
  const bookedCount = events.filter((e) => !e.isAvailable).length;
  const selectedEvent = selected !== null ? events[selected] : null;

  const guests = selectedEvent?.guests || [];
  const acceptedCount = guests.filter((g) => g.status === "accepted").length;
  const declinedCount = guests.filter((g) => g.status === "declined").length;
  const pendingCount = guests.filter((g) => g.status === "pending" || g.status === "maybe").length;

  return (
    <div className="max-w-2xl w-full rounded-xl bg-[var(--surface-primary)] border border-[var(--border-card)] overflow-hidden my-3" style={{ boxShadow: 'var(--shadow-card)' }}>
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-[var(--border-default)] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-[var(--text-secondary)]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
          </svg>
          <h2 className="text-base font-semibold text-[var(--text-primary)]">Schedule</h2>
        </div>
        <span className="text-xs font-medium text-[var(--text-tertiary)] bg-[var(--surface-quaternary)] px-2 py-0.5 rounded-full">
          {formatDateBadge(date, dayName)} · {bookedCount} event{bookedCount !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Split layout: list + detail panel */}
      <div className="flex min-h-[320px]">
        {/* Event list */}
        <div className={`divide-y divide-[var(--border-subtle)] overflow-y-auto ${selectedEvent ? "w-1/2 border-r border-[var(--border-default)]" : "w-full"}`}>
          {events.map((event, i) => {
            const isActive = selected === i;
            const isBooked = !event.isAvailable;

            return (
              <div
                key={i}
                className={`flex items-center gap-3 px-4 py-3 transition-colors ${
                  isBooked ? "hover:bg-[var(--surface-tertiary)] cursor-pointer" : ""
                } ${isActive ? "bg-indigo-500/10" : ""}`}
                onClick={() => {
                  if (isBooked) {
                    setSelected(isActive ? null : i);
                    setRsvp(null);
                  }
                }}
              >
                {/* Dot */}
                <div
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    isBooked ? "bg-indigo-500" : "bg-[var(--surface-quaternary)]"
                  }`}
                />

                {/* Time */}
                <div className="w-20 shrink-0 text-xs text-[var(--text-tertiary)]">
                  {formatTimeShort(event.startTime)}
                  {event.endTime && (
                    <>
                      <span className="mx-0.5">-</span>
                      {formatTimeShort(event.endTime)}
                    </>
                  )}
                </div>

                {/* Title */}
                <p
                  className={`flex-1 text-sm truncate ${
                    isBooked ? "text-[var(--text-primary)] font-medium" : "text-[var(--text-tertiary)]"
                  }`}
                >
                  {event.title}
                </p>

                {/* Duration badge */}
                {isBooked && event.endTime && (
                  <span className="text-xs text-[var(--text-tertiary)] bg-[var(--surface-quaternary)] px-1.5 py-0.5 rounded shrink-0">
                    {getDuration(event.startTime, event.endTime)}
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* Detail panel */}
        {selectedEvent && !selectedEvent.isAvailable && (
          <div className="w-1/2 p-5 overflow-y-auto flex flex-col">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-3 h-3 rounded-full bg-indigo-500 shrink-0" />
              <span className="text-xs font-medium text-indigo-600 uppercase tracking-wide">Event</span>
            </div>
            <h3 className="text-base font-semibold text-[var(--text-primary)] mb-3">{selectedEvent.title}</h3>

            {/* Time & date info */}
            <div className="space-y-2 mb-4">
              <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                <svg className="w-4 h-4 text-[var(--text-tertiary)] shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>
                  {formatTime(selectedEvent.startTime)}
                  {selectedEvent.endTime && ` - ${formatTime(selectedEvent.endTime)}`}
                </span>
              </div>
              <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                <svg className="w-4 h-4 text-[var(--text-tertiary)] shrink-0" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
                </svg>
                <span>{formatDateBadge(date, dayName)}</span>
              </div>
            </div>

            {/* Guests */}
            {guests.length > 0 && (
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <svg className="w-4 h-4 text-[var(--text-tertiary)]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-1.053M18 10.5a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
                  </svg>
                  <span className="text-sm font-medium text-[var(--text-secondary)]">{guests.length} guest{guests.length !== 1 ? "s" : ""}</span>
                  <span className="text-xs text-[var(--text-tertiary)]">
                    {acceptedCount} yes{declinedCount > 0 ? `, ${declinedCount} no` : ""}{pendingCount > 0 ? `, ${pendingCount} awaiting` : ""}
                  </span>
                </div>
                <div className="space-y-1.5">
                  {guests.map((guest, gi) => {
                    const statusInfo = STATUS_ICONS[guest.status] || STATUS_ICONS.pending;
                    return (
                      <div key={gi} className="flex items-center gap-2">
                        <div className={`w-6 h-6 rounded-full ${getGuestAvatarColor(guest.email)} flex items-center justify-center text-white text-[10px] font-semibold shrink-0`}>
                          {getGuestInitial(guest.email)}
                        </div>
                        <span className="text-xs text-[var(--text-secondary)] flex-1 truncate">{getGuestName(guest.email)}</span>
                        <svg className={`w-3.5 h-3.5 shrink-0 ${statusInfo.color}`} fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" d={statusInfo.icon} />
                        </svg>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* RSVP buttons */}
            <div className="mt-auto pt-3 border-t border-[var(--border-default)]">
              <p className="text-xs text-[var(--text-tertiary)] mb-2">Going?</p>
              <div className="flex items-center gap-2">
                {(["Yes", "No", "Maybe"] as const).map((label) => {
                  const isActive = rsvp === label;
                  return (
                    <button
                      key={label}
                      onClick={(e) => { e.stopPropagation(); setRsvp(isActive ? null : label); }}
                      className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                        isActive
                          ? label === "Yes"
                            ? "bg-indigo-500 text-white border-indigo-500"
                            : label === "No"
                              ? "bg-gray-700 text-white border-gray-700"
                              : "bg-amber-500 text-white border-amber-500"
                          : "bg-[var(--surface-primary)] text-[var(--text-secondary)] border-[var(--border-default)] hover:bg-[var(--surface-tertiary)]"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function CalendarLoadingState() {
  return (
    <div className="max-w-2xl w-full rounded-xl bg-[var(--surface-primary)] border border-[var(--border-card)] overflow-hidden my-3 animate-pulse" style={{ boxShadow: 'var(--shadow-card)' }}>
      <div className="px-5 py-3.5 border-b border-[var(--border-default)] flex items-center gap-2">
        <div className="w-5 h-5 bg-[var(--surface-quaternary)] rounded" />
        <div className="h-4 w-20 bg-[var(--surface-quaternary)] rounded" />
      </div>
      <div className="divide-y divide-[var(--border-subtle)]">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex items-center gap-3 px-5 py-3">
            <div className="w-20 h-3 bg-[var(--surface-quaternary)] rounded shrink-0" />
            <div className="w-2 h-2 rounded-full bg-[var(--surface-quaternary)] shrink-0" />
            <div className="flex-1 h-3 bg-[var(--surface-quaternary)] rounded" />
          </div>
        ))}
      </div>
      <div className="px-5 pb-3 text-xs text-[var(--text-tertiary)]">Loading schedule...</div>
    </div>
  );
}
