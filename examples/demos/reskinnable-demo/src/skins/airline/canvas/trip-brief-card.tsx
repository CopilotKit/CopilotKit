"use client";

import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  HelpCircle,
} from "lucide-react";
import type { TripBrief } from "../data/trip-types";

/**
 * BEAT 3d — the durable Trip Brief, drawn full-region on the shared canvas.
 *
 * ⚠️ THE TWO-COLUMN SPLIT IS THE ARGUMENT, not decoration. The beat's claim is
 * that the artifact states something NEITHER source alone knows, so the screen
 * says which side every fact came from: the left column is what only a reader of
 * the attachment could know, the right is what only Aeronova holds. The headline
 * on top is the collision of the two. A single flat list of fields would render
 * exactly the same facts and prove nothing — a room looking at it could not tell
 * the file had been opened.
 *
 * Nothing here is model-authored at render time: every value is read back off
 * `GET /api/airline/v1/briefs`, i.e. the record the server settled and stored.
 */

/** `2026-07-14T22:05:00-05:00` → `22:05`, without going through `Date`. */
function clockOf(iso: string | null): string | null {
  if (!iso) return null;
  const match = /^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2})/.exec(iso.trim());
  return match ? match[1] : null;
}

const usd = (n: number) => `$${n.toFixed(2)}`;

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-hairline py-2 last:border-b-0">
      <span className="text-xs uppercase tracking-wider text-ink-muted">
        {label}
      </span>
      {/* An absent ledger fact is printed as an absence, never as a blank cell:
          `bookingRef === null` means the document matched no booking, which is
          an ANSWER the server reached, not a field it forgot to fill. */}
      <span
        className={
          value === null
            ? "text-sm italic text-ink-muted"
            : "text-sm font-medium text-ink"
        }
      >
        {value ?? "not on file"}
      </span>
    </div>
  );
}

function Provenance({
  title,
  caption,
  children,
}: {
  title: string;
  caption: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-hairline bg-surface p-5 shadow-soft">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      <p className="mt-0.5 text-xs text-ink-muted">{caption}</p>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/**
 * The headline banner.
 *
 * Three states, and the third is why `arrivesAfterLastCheckIn` is tri-state in
 * the first place: an unmatched document renders as UNKNOWN — muted, with a
 * question mark — never as the reassuring green one. A `false`-looking banner
 * over a check nobody was able to make is the failure the whole field was shaped
 * to prevent.
 */
function Headline({ brief }: { brief: TripBrief }) {
  const collides = brief.arrivesAfterLastCheckIn;
  const tone =
    collides === true
      ? {
          box: "border-negative/30 bg-negative-soft",
          icon: "text-negative",
          Icon: AlertTriangle,
          label: "Needs action",
        }
      : collides === false
        ? {
            box: "border-positive/30 bg-positive-soft",
            icon: "text-positive",
            Icon: CheckCircle2,
            label: "Clear",
          }
        : {
            box: "border-hairline bg-surface-muted",
            icon: "text-ink-muted",
            Icon: HelpCircle,
            label: "Unchecked",
          };
  const { Icon } = tone;

  return (
    <div
      className={`flex items-start gap-3 rounded-2xl border p-5 ${tone.box}`}
      data-testid="trip-brief-headline"
      data-collides={collides === null ? "unknown" : String(collides)}
    >
      <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${tone.icon}`} />
      <div>
        <div
          className={`text-xs font-semibold uppercase tracking-wider ${tone.icon}`}
        >
          {tone.label}
        </div>
        <p className="mt-1 text-base font-medium leading-snug text-ink">
          {brief.headline}
        </p>
      </div>
    </div>
  );
}

export function TripBriefCard({ brief }: { brief: TripBrief }) {
  const scheduled = clockOf(brief.arrivalLocal);

  return (
    <article className="mx-auto flex w-full max-w-3xl flex-col gap-5">
      <header className="flex items-start gap-3">
        <span className="text-brand">
          <FileText className="h-6 w-6" />
        </span>
        <div>
          <div className="text-xs uppercase tracking-wider text-ink-muted">
            Trip brief
          </div>
          <h2 className="text-lg font-semibold text-ink">{brief.hotelName}</h2>
          <p className="mt-0.5 text-sm text-ink-muted">
            Filed on the trip record — it outlives this conversation.
          </p>
        </div>
      </header>

      <Headline brief={brief} />

      <div className="grid gap-4 md:grid-cols-2">
        <Provenance
          title="From the confirmation"
          caption="Read off the attached PDF. Aeronova holds none of it."
        >
          <Field label="Hotel" value={brief.hotelName} />
          <Field label="Confirmation" value={brief.confirmationNumber} />
          <Field label="Address" value={brief.address || null} />
          <Field label="Last check-in" value={brief.lastCheckInLocal} />
          <Field
            label="Free cancellation until"
            value={brief.cancellationDeadlineLocal || null}
          />
          <Field label="Per night" value={usd(brief.nightlyRateUsd)} />
        </Provenance>

        <Provenance
          title="From your Aeronova record"
          caption="Settled server-side from the ledger, never from the document."
        >
          <Field label="Booking" value={brief.bookingRef} />
          <Field label="Traveler" value={brief.travelerName} />
          <Field label="Arrives into" value={brief.arrivalStation} />
          <Field label="Scheduled arrival" value={scheduled} />
        </Provenance>
      </div>

      <footer className="text-xs text-ink-muted">
        Brief {brief.id} · filed {brief.createdAt}
      </footer>
    </article>
  );
}

export default TripBriefCard;
