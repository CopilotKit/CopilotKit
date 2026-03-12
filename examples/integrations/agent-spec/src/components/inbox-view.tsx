"use client";

import { useState } from "react";

export interface Email {
  id: string;
  from: string;
  subject: string;
  preview: string;
  body: string;
  date: string;
  isRead: boolean;
}

interface InboxViewProps {
  emails: Email[];
}

const AVATAR_COLORS = [
  "bg-blue-500",
  "bg-emerald-500",
  "bg-violet-500",
  "bg-amber-500",
  "bg-rose-500",
  "bg-cyan-500",
  "bg-pink-500",
  "bg-teal-500",
];

function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getInitial(from: string): string {
  const name = from.split("@")[0].split(".")[0];
  return (name[0] || "?").toUpperCase();
}

function getSenderName(from: string): string {
  const local = from.split("@")[0];
  return local
    .split(".")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function InboxView({ emails }: InboxViewProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replySent, setReplySent] = useState<string | null>(null);
  const selectedEmail = emails.find((e) => e.id === selected);

  return (
    <div className="max-w-2xl w-full rounded-xl bg-[var(--surface-primary)] border border-[var(--border-card)] overflow-hidden my-3" style={{ boxShadow: 'var(--shadow-card)' }}>
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-[var(--border-default)] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-[var(--text-secondary)]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
          </svg>
          <h2 className="text-base font-semibold text-[var(--text-primary)]">Inbox</h2>
        </div>
        <span className="text-xs font-medium text-[var(--text-tertiary)] bg-[var(--surface-quaternary)] px-2 py-0.5 rounded-full">
          {emails.length} message{emails.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Split layout: list + detail panel */}
      <div className="flex min-h-[320px]">
        {/* Email list */}
        <div className={`divide-y divide-[var(--border-subtle)] overflow-y-auto ${selectedEmail ? "w-1/2 border-r border-[var(--border-default)]" : "w-full"}`}>
          {emails.map((email) => {
            const isActive = selected === email.id;

            return (
              <div
                key={email.id}
                className={`flex items-start gap-3 px-4 py-3 hover:bg-[var(--surface-tertiary)] transition-colors cursor-pointer relative ${
                  isActive ? "bg-blue-500/10" : ""
                }`}
                onClick={() => setSelected(isActive ? null : email.id)}
              >
                {/* Unread indicator */}
                {!email.isRead && (
                  <div className="absolute left-1 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-blue-500" />
                )}

                {/* Avatar */}
                <div
                  className={`w-8 h-8 rounded-full ${getAvatarColor(email.from)} flex items-center justify-center text-white text-xs font-semibold shrink-0 mt-0.5`}
                >
                  {getInitial(email.from)}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className={`text-sm truncate ${email.isRead ? "text-[var(--text-secondary)]" : "text-[var(--text-primary)] font-semibold"}`}>
                      {getSenderName(email.from)}
                    </p>
                    <span className="text-[11px] text-[var(--text-tertiary)] shrink-0">{email.date}</span>
                  </div>
                  <p className={`text-sm truncate ${email.isRead ? "text-[var(--text-tertiary)]" : "text-[var(--text-primary)] font-medium"}`}>
                    {email.subject}
                  </p>
                  <p className="text-xs text-[var(--text-tertiary)] truncate mt-0.5">{email.preview}</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Detail panel */}
        {selectedEmail && (
          <div className="w-1/2 p-5 overflow-y-auto flex flex-col">
            <div className="flex items-start gap-3 mb-4">
              <div
                className={`w-10 h-10 rounded-full ${getAvatarColor(selectedEmail.from)} flex items-center justify-center text-white text-sm font-semibold shrink-0`}
              >
                {getInitial(selectedEmail.from)}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[var(--text-primary)]">{getSenderName(selectedEmail.from)}</p>
                <p className="text-xs text-[var(--text-tertiary)]">{selectedEmail.from}</p>
              </div>
              <span className="text-xs text-[var(--text-tertiary)] ml-auto shrink-0">{selectedEmail.date}</span>
            </div>
            <h3 className="text-base font-semibold text-[var(--text-primary)] mb-3">{selectedEmail.subject}</h3>
            <p className="text-sm text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap flex-1">{selectedEmail.body}</p>

            {/* Reply compose or buttons */}
            {replySent === selectedEmail.id ? (
              <div className="mt-4 pt-3 border-t border-[var(--border-default)] flex items-center gap-2 text-sm text-emerald-600">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Reply sent
              </div>
            ) : replyingTo === selectedEmail.id ? (
              <div className="mt-4 pt-3 border-t border-[var(--border-default)]">
                <div className="border border-[var(--border-default)] rounded-lg overflow-hidden">
                  <div className="px-3 py-2 border-b border-[var(--border-default)] bg-[var(--surface-tertiary)]">
                    <div className="flex items-center gap-2 text-xs text-[var(--text-tertiary)]">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
                      </svg>
                      <span>{selectedEmail.from}</span>
                    </div>
                  </div>
                  <textarea
                    className="w-full px-3 py-2 text-sm text-[var(--text-secondary)] placeholder-[var(--text-tertiary)] bg-[var(--surface-primary)] resize-none focus:outline-none"
                    rows={3}
                    placeholder="Write your reply..."
                    autoFocus
                  />
                  <div className="px-3 py-2 border-t border-[var(--border-default)] flex items-center gap-2">
                    <button
                      onClick={() => {
                        setReplySent(selectedEmail.id);
                        setReplyingTo(null);
                      }}
                      className="flex items-center gap-1.5 px-3 py-1 text-xs text-white bg-blue-500 rounded-full hover:bg-blue-600 transition-colors"
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                      </svg>
                      Send
                    </button>
                    <button
                      onClick={() => setReplyingTo(null)}
                      className="px-3 py-1 text-xs text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
                    >
                      Discard
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 mt-4 pt-3 border-t border-[var(--border-default)]">
                <button
                  onClick={() => setReplyingTo(selectedEmail.id)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-[var(--text-secondary)] bg-[var(--surface-primary)] border border-[var(--border-default)] rounded-full hover:bg-[var(--surface-tertiary)] transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
                  </svg>
                  Reply
                </button>
                <button className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-[var(--text-secondary)] bg-[var(--surface-primary)] border border-[var(--border-default)] rounded-full hover:bg-[var(--surface-tertiary)] transition-colors">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 15l6-6m0 0l-6-6m6 6H9a6 6 0 000 12h3" />
                  </svg>
                  Forward
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function InboxLoadingState() {
  return (
    <div className="max-w-2xl w-full rounded-xl bg-[var(--surface-primary)] border border-[var(--border-card)] overflow-hidden my-3 animate-pulse" style={{ boxShadow: 'var(--shadow-card)' }}>
      <div className="px-5 py-3.5 border-b border-[var(--border-default)] flex items-center gap-2">
        <div className="w-5 h-5 bg-[var(--surface-quaternary)] rounded" />
        <div className="h-4 w-16 bg-[var(--surface-quaternary)] rounded" />
      </div>
      <div className="divide-y divide-[var(--border-subtle)]">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex items-start gap-3 px-5 py-3">
            <div className="w-9 h-9 rounded-full bg-[var(--surface-quaternary)] shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-24 bg-[var(--surface-quaternary)] rounded" />
              <div className="h-3 w-48 bg-[var(--surface-quaternary)] rounded" />
              <div className="h-2.5 w-36 bg-[var(--surface-quaternary)] rounded" />
            </div>
          </div>
        ))}
      </div>
      <div className="px-5 pb-3 text-xs text-[var(--text-tertiary)]">Checking inbox...</div>
    </div>
  );
}
