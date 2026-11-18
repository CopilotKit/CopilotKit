"use client";

import { Eye, Send } from "lucide-react";
import { CARRIER_MESSAGE_LABELS, WATCH_REASON_LABELS } from "../data/handling";
import type { CarrierMessage, WatchReason } from "../data/handling";
import type { Shipment } from "../data/types";

/**
 * BEAT 5 — what the stored procedure's three writes LOOK like on screen.
 *
 * "Every mutation gets a visible affordance… if the audience can't see the
 * change, it didn't happen." All three writes land on the shipment record, so
 * both surfaces that paint a shipment paint them: the Control Tower board gets
 * `HandlingMarkers` (compact chips under the reference, so the row does not
 * grow a column) and the shipment card gets `HandlingDetail` (the full list,
 * including the note text with its forced 🚨).
 *
 * The labels come from `data/handling.ts` rather than being written twice, so a
 * template the store accepts and the UI cannot name is unrepresentable.
 */

/** A stored value is a plain string; only render copy for one we know. */
const watchLabel = (reason: string): string =>
  WATCH_REASON_LABELS[reason as WatchReason] ?? reason;

const messageLabel = (template: string): string =>
  CARRIER_MESSAGE_LABELS[template as CarrierMessage] ?? template;

/** Compact chips for a table row. Renders nothing when the shipment is clean. */
export function HandlingMarkers({ shipment }: { shipment: Shipment }) {
  const noticeCount = shipment.carrierNotices?.length ?? 0;
  const noteCount = shipment.notes?.length ?? 0;
  if (!shipment.watch && noticeCount === 0 && noteCount === 0) return null;

  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      {shipment.watch ? (
        <span
          title={watchLabel(shipment.watch.reason)}
          className="inline-flex items-center gap-1 rounded-md bg-negative-soft px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-negative"
        >
          <Eye className="h-3 w-3" />
          Watch
        </span>
      ) : null}
      {noticeCount > 0 ? (
        <span className="inline-flex items-center gap-1 rounded-md bg-brand-soft px-1.5 py-0.5 text-[11px] font-medium text-brand-indigo dark:text-brand-violet">
          <Send className="h-3 w-3" />
          Carrier notified
        </span>
      ) : null}
      {noteCount > 0 ? (
        // The marker itself is the chip — the same 🚨 the note carries, so the
        // row and the card read as one change rather than two.
        <span className="inline-flex items-center gap-1 rounded-md bg-surface-muted px-1.5 py-0.5 text-[11px] font-medium text-ink-muted">
          🚨 {noteCount}
        </span>
      ) : null}
    </div>
  );
}

/** The full handling trail for one shipment. Renders nothing when clean. */
export function HandlingDetail({ shipment }: { shipment: Shipment }) {
  const notices = shipment.carrierNotices ?? [];
  const notes = shipment.notes ?? [];
  if (!shipment.watch && notices.length === 0 && notes.length === 0)
    return null;

  return (
    <div className="mt-3 flex flex-col gap-2 rounded-md border border-hairline bg-surface-muted p-3 text-sm">
      {shipment.watch ? (
        <div className="flex items-center gap-2">
          <Eye className="h-4 w-4 shrink-0 text-negative" />
          <span className="font-medium text-negative">
            On watch — {watchLabel(shipment.watch.reason)}
          </span>
          <span className="text-xs text-ink-muted">
            raised by {shipment.watch.raisedBy}
          </span>
        </div>
      ) : null}
      {notices.map((notice) => (
        <div key={notice.id} className="flex items-center gap-2">
          <Send className="h-4 w-4 shrink-0 text-brand" />
          <span className="text-ink">
            {notice.carrier}: {messageLabel(notice.template)}
          </span>
          <span className="text-xs text-ink-muted">by {notice.sentBy}</span>
        </div>
      ))}
      {notes.map((note) => (
        <div key={note.id} className="text-ink">
          {note.text}{" "}
          <span className="text-xs text-ink-muted">— {note.author}</span>
        </div>
      ))}
    </div>
  );
}
