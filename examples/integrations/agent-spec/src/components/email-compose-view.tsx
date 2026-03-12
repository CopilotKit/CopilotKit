"use client";

import { useState } from "react";

export interface EmailComposeData {
  to: string;
  subject: string;
  body: string;
  from?: string;
}

interface EmailComposeViewProps {
  email: EmailComposeData;
}

function getInitial(email: string): string {
  const name = email.split("@")[0].split(".")[0];
  return (name[0] || "?").toUpperCase();
}

export function EmailComposeView({ email }: EmailComposeViewProps) {
  const [sent, setSent] = useState(false);
  const [discarded, setDiscarded] = useState(false);

  if (discarded) {
    return (
      <div className="max-w-2xl w-full rounded-xl bg-[var(--surface-primary)] border border-[var(--border-card)] overflow-hidden my-3" style={{ boxShadow: 'var(--shadow-card)' }}>
        <div className="px-5 py-4 text-sm text-[var(--text-tertiary)] text-center">
          Draft discarded.
        </div>
      </div>
    );
  }

  if (sent) {
    return (
      <div className="max-w-2xl w-full rounded-xl bg-[var(--surface-primary)] border border-[var(--border-card)] overflow-hidden my-3" style={{ boxShadow: 'var(--shadow-card)' }}>
        <div className="px-5 py-4 flex items-center justify-center gap-2 text-sm text-emerald-600">
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Email sent.
        </div>
      </div>
    );
  }

  const isReply = email.subject.startsWith("Re:");

  return (
    <div className="max-w-2xl w-full rounded-xl bg-[var(--surface-primary)] border border-[var(--border-card)] overflow-hidden my-3" style={{ boxShadow: 'var(--shadow-card)' }}>
      {/* Header */}
      <div className="px-5 py-3.5 border-b border-[var(--border-default)] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-[var(--text-secondary)]" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            {isReply ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
            )}
          </svg>
          <h2 className="text-base font-semibold text-[var(--text-primary)]">
            {isReply ? "Reply" : "New Message"}
          </h2>
        </div>
      </div>

      <div className="p-5">
        {/* To / Subject rows */}
        <div className="space-y-2 mb-4">
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium text-[var(--text-tertiary)] w-12 shrink-0">To</span>
            <div className="flex items-center gap-2">
              <div className="w-5 h-5 rounded-full bg-blue-500 flex items-center justify-center text-white text-[9px] font-semibold shrink-0">
                {getInitial(email.to)}
              </div>
              <span className="text-sm text-[var(--text-secondary)]">{email.to}</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium text-[var(--text-tertiary)] w-12 shrink-0">Subject</span>
            <span className="text-sm text-[var(--text-secondary)]">{email.subject}</span>
          </div>
        </div>

        <div className="border-t border-[var(--border-default)] pt-4">
          {/* Email body */}
          <p className="text-sm text-[var(--text-secondary)] leading-relaxed whitespace-pre-wrap min-h-[80px]">
            {email.body}
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 mt-4 pt-3 border-t border-[var(--border-default)]">
          <button
            onClick={() => setSent(true)}
            className="flex items-center gap-1.5 px-4 py-1.5 text-sm text-white bg-blue-500 rounded-full hover:bg-blue-600 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
            </svg>
            Send
          </button>
          <button
            onClick={() => setDiscarded(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-[var(--text-secondary)] bg-[var(--surface-primary)] border border-[var(--border-default)] rounded-full hover:bg-[var(--surface-tertiary)] transition-colors"
          >
            Discard
          </button>
        </div>
      </div>
    </div>
  );
}

export function EmailComposeLoadingState() {
  return (
    <div className="max-w-2xl w-full rounded-xl bg-[var(--surface-primary)] border border-[var(--border-card)] overflow-hidden my-3 animate-pulse" style={{ boxShadow: 'var(--shadow-card)' }}>
      <div className="px-5 py-3.5 border-b border-[var(--border-default)] flex items-center gap-2">
        <div className="w-5 h-5 bg-[var(--surface-quaternary)] rounded" />
        <div className="h-4 w-24 bg-[var(--surface-quaternary)] rounded" />
      </div>
      <div className="p-5 space-y-3">
        <div className="h-3 w-48 bg-[var(--surface-quaternary)] rounded" />
        <div className="h-3 w-40 bg-[var(--surface-quaternary)] rounded" />
        <div className="border-t border-[var(--border-default)] pt-4 space-y-2">
          <div className="h-3 w-full bg-[var(--surface-quaternary)] rounded" />
          <div className="h-3 w-3/4 bg-[var(--surface-quaternary)] rounded" />
          <div className="h-3 w-1/2 bg-[var(--surface-quaternary)] rounded" />
        </div>
      </div>
      <div className="px-5 pb-3 text-xs text-[var(--text-tertiary)]">Drafting email...</div>
    </div>
  );
}
