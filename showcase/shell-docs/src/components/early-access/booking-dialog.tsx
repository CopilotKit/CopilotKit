"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ReactNode, RefObject } from "react";
import { CircleCheck, XIcon } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/cn";
import { trackEvent } from "@/lib/telemetry/analytics";
import {
  ANSWER_LIMIT,
  BOOK_LIMITS,
  EMAIL_PATTERN,
} from "@/lib/early-access/booking";
import type { ChannelDemoBooking } from "@/lib/early-access/booking";
import { earlyAccessChannel } from "@/lib/early-access/channels";
import type { EarlyAccessChannelId } from "@/lib/early-access/channels";
import { EARLY_ACCESS_CHANNEL_COPY } from "@/lib/early-access/copy";
import { postBooking } from "@/lib/early-access/post-booking";
import { formatBookedTime, tooSoon } from "@/lib/early-access/slot-days";
import type { OpenTime } from "@/lib/early-access/slot-days";
import { BOOKER_TEXT as TEXT } from "./text";

const PRIVACY_POLICY = "https://www.copilotkit.ai/privacy-policy";

/** What the reader types, kept by the booker so a new time keeps it. */
export interface BookingDetails {
  name: string;
  email: string;
  company: string;
  building: string;
  /** The honeypot: hidden from people, so only a bot fills it. */
  kt_hp: string;
}

export const EMPTY_DETAILS: BookingDetails = {
  name: "",
  email: "",
  company: "",
  building: "",
  kt_hp: "",
};

type FormField = "name" | "email" | "company" | "building";

/** The failures said in the notice, not under a field. */
type NoticeCode =
  | "invalid"
  | "time_zone"
  | "rate_limited"
  | "unavailable"
  | "unconfirmed";

const NOTICE: Record<NoticeCode, string> = {
  invalid: TEXT.errors.invalid,
  time_zone: TEXT.errors.timeZone,
  rate_limited: TEXT.errors.rateLimited,
  unavailable: TEXT.errors.unavailable,
  unconfirmed: TEXT.errors.unconfirmed,
};

const FIELD_ERRORS: Record<FormField, string> = {
  name: TEXT.errors.name,
  email: TEXT.errors.email,
  company: TEXT.errors.company,
  building: TEXT.errors.building,
};

/** One of the form's own fields: an error can be shown under it. */
const isFormField = (value: unknown): value is FormField =>
  typeof value === "string" && Object.hasOwn(FIELD_ERRORS, value);

/** How the dialog was opened: by touch, focus stays off the fields. */
export type OpenedBy = "touch" | "mouse" | "pen" | "keyboard";

/**
 * The chosen time, booked in place: a form for the reader's details, then
 * the confirmation. While a booking is in flight the dialog stays open, since
 * its answer must be seen. The booker mounts one per opening (its `key`), so
 * every opening starts clean, with the details already typed.
 */
export function BookingDialog({
  channel,
  time,
  openedBy,
  open,
  timeZone,
  details,
  onDetailsChange,
  onBooked,
  onSlotTaken,
  onTooSoon,
  onUnconfirmed,
  onClose,
  onClosed,
  finalFocus,
}: {
  channel: EarlyAccessChannelId;
  /** The time being booked; kept while the dialog animates out. */
  time: OpenTime;
  openedBy: OpenedBy;
  open: boolean;
  timeZone: string;
  details: BookingDetails;
  onDetailsChange: (details: BookingDetails) => void;
  onBooked: (time: OpenTime) => void;
  /** The time was just taken: the booker marks it and closes the dialog. */
  onSlotTaken: (time: OpenTime) => void;
  /**
   * The time is too soon to book by now, so nothing was sent: the booker
   * marks it and closes the dialog.
   */
  onTooSoon: (time: OpenTime) => void;
  /** It may have booked: the booker stops offering times. */
  onUnconfirmed: (time: OpenTime) => void;
  onClose: () => void;
  /** After the closing animation, once the dialog is gone. */
  onClosed: () => void;
  /** The element focus returns to, or false for none. */
  finalFocus: () => HTMLElement | false;
}) {
  const copy = EARLY_ACCESS_CHANNEL_COPY[channel];
  const fallbackUrl = earlyAccessChannel(channel)?.fallbackUrl ?? "";
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const [errors, setErrors] = useState<Partial<Record<FormField, string>>>({});
  const [notice, setNotice] = useState<NoticeCode | null>(null);
  /** After an unconfirmed answer a second submit could book twice. */
  const [locked, setLocked] = useState(false);
  const [booked, setBooked] = useState<{
    booking: ChannelDemoBooking;
    email: string;
  } | null>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const bookedRef = useRef<HTMLHeadingElement>(null);
  const [focusRequest, setFocusRequest] = useState<{
    target: "field" | "notice" | "booked";
    seq: number;
  } | null>(null);

  useEffect(() => {
    if (!focusRequest) return;
    const target =
      focusRequest.target === "field"
        ? formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]')
        : focusRequest.target === "notice"
          ? noticeRef.current
          : bookedRef.current;
    target?.focus();
  }, [focusRequest]);

  const requestFocus = (target: "field" | "notice" | "booked") =>
    setFocusRequest((current) => ({ target, seq: (current?.seq ?? 0) + 1 }));

  const update = (field: FormField, value: string) => {
    onDetailsChange({ ...details, [field]: value });
    if (errors[field]) setErrors((current) => ({ ...current, [field]: "" }));
  };

  const fail = (reason: string) =>
    trackEvent("docs.channel_demo_failed", { channel, reason });

  const submit = async () => {
    if (submittingRef.current || locked) return;
    // The lead passed while the dialog was open: nothing is sent, and the
    // booker says why. First, so no one fixes a field for a time that's gone.
    if (tooSoon(time)) {
      onTooSoon(time);
      return;
    }
    // The browser's own checks, said the docs' way under each field.
    const found: Partial<Record<FormField, string>> = {};
    if (!details.name.trim()) found.name = TEXT.errors.name;
    if (!EMAIL_PATTERN.test(details.email.trim()))
      found.email = TEXT.errors.email;
    if (!details.company.trim()) found.company = TEXT.errors.company;
    setErrors(found);
    setNotice(null);
    if (Object.keys(found).length) {
      requestFocus("field");
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    trackEvent("docs.channel_demo_submitted", { channel });
    const sentEmail = details.email.trim();
    const answer = await postBooking({
      channel,
      startTime: time.startTime,
      name: details.name,
      email: sentEmail,
      company: details.company,
      ...(details.building.trim() ? { building: details.building } : {}),
      timeZone,
      kt_hp: details.kt_hp,
    });
    submittingRef.current = false;
    setSubmitting(false);

    if (answer.ok) {
      trackEvent("docs.channel_demo_booked", { channel });
      setBooked({ booking: answer.booking, email: sentEmail });
      requestFocus("booked");
      onBooked(time);
      return;
    }
    switch (answer.code) {
      case "slot_taken":
        fail("slot_taken");
        onSlotTaken(time);
        return;
      case "invalid_input": {
        if (answer.reason === "work_email_required") {
          fail("work_email_required");
          setErrors({ email: TEXT.errors.workEmail });
          requestFocus("field");
          return;
        }
        fail("invalid_input");
        const field: unknown = answer.field;
        if (isFormField(field)) {
          setErrors({ [field]: FIELD_ERRORS[field] });
          requestFocus("field");
        } else {
          // The time zone isn't in the form, and any other field isn't
          // the form's: the notice says what to do.
          setNotice(field === "timeZone" ? "time_zone" : "invalid");
          requestFocus("notice");
        }
        return;
      }
      case "unconfirmed":
        fail("unconfirmed");
        setLocked(true);
        setNotice("unconfirmed");
        requestFocus("notice");
        onUnconfirmed(time);
        return;
      default:
        fail(answer.code);
        setNotice(answer.code);
        requestFocus("notice");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // The answer to a booking in flight must be seen.
        if (!next && !submittingRef.current) onClose();
      }}
      onOpenChangeComplete={(isOpen) => {
        if (!isOpen) onClosed();
      }}
    >
      <DialogContent
        ref={popupRef}
        // Opened by touch, the dialog itself takes focus, so the keyboard
        // doesn't open over it; otherwise Name does.
        initialFocus={() =>
          openedBy === "touch" ? popupRef.current : nameRef.current
        }
        finalFocus={finalFocus}
        showCloseButton={false}
        className="max-h-[calc(100dvh-2rem)] gap-5 overflow-y-auto rounded-[24px] p-6 shadow-[var(--menu-lift)] ring-frame-rim sm:max-w-[30rem] dark:bg-[#15151d]"
      >
        <DialogHeader className="gap-1.5 pe-8">
          <DialogTitle className="text-lg leading-snug font-semibold tracking-[-0.01em]">
            {copy.booking.heading}
          </DialogTitle>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <DialogDescription className="text-sm text-foreground">
              {time.heading}
            </DialogDescription>
            {booked ? null : (
              <button
                type="button"
                disabled={submitting}
                onClick={onClose}
                // 20px tall; an invisible ::after makes the hit area 44px.
                className="relative rounded-sm text-sm font-medium text-primary underline-offset-4 outline-none after:absolute after:-inset-x-2 after:-inset-y-3 after:content-[''] hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
              >
                {TEXT.form.changeTime}
              </button>
            )}
          </div>
        </DialogHeader>

        {booked ? (
          <BookedView
            booking={booked.booking}
            email={booked.email}
            timeZone={timeZone}
            chosenHeading={time.heading}
            headingRef={bookedRef}
          />
        ) : (
          <form
            ref={formRef}
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
            className="flex flex-col gap-4"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label={TEXT.form.name}
                name="name"
                autoComplete="name"
                maxLength={BOOK_LIMITS.name}
                value={details.name}
                error={errors.name}
                disabled={submitting || locked}
                inputRef={nameRef}
                onChange={(value) => update("name", value)}
              />
              <TextField
                label={TEXT.form.email}
                name="email"
                type="email"
                autoComplete="email"
                maxLength={BOOK_LIMITS.email}
                value={details.email}
                error={errors.email}
                disabled={submitting || locked}
                onChange={(value) => update("email", value)}
              />
            </div>
            <TextField
              label={TEXT.form.company}
              name="company"
              autoComplete="organization"
              maxLength={BOOK_LIMITS.company}
              value={details.company}
              error={errors.company}
              disabled={submitting || locked}
              onChange={(value) => update("company", value)}
            />
            <TextField
              label={copy.booking.buildingLabel}
              optional
              multiline
              name="building"
              placeholder={copy.booking.buildingPlaceholder}
              maxLength={ANSWER_LIMIT}
              value={details.building}
              error={errors.building}
              disabled={submitting || locked}
              onChange={(value) => update("building", value)}
            />
            {/* The honeypot: out of sight and out of the tab order. */}
            <div className="sr-only" aria-hidden="true">
              <label>
                {TEXT.form.honeypot}
                <input
                  name="kt_hp"
                  tabIndex={-1}
                  autoComplete="off"
                  value={details.kt_hp}
                  onChange={(event) =>
                    onDetailsChange({ ...details, kt_hp: event.target.value })
                  }
                />
              </label>
            </div>

            {/* Always there, so the status region exists before it speaks. */}
            <div
              ref={noticeRef}
              tabIndex={-1}
              role="status"
              className="rounded-lg text-sm outline-none empty:sr-only focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {notice ? (
                <p className="flex flex-col gap-1">
                  <span className="text-destructive">{NOTICE[notice]}</span>
                  <a
                    href={fallbackUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    onClick={() =>
                      trackEvent("docs.channel_demo_fallback_clicked", {
                        channel,
                        placement: "dialog",
                      })
                    }
                    className="inline-flex min-h-11 w-fit items-center font-medium text-primary underline-offset-4 hover:underline"
                  >
                    {TEXT.errors.fallback}
                    <span className="sr-only"> {TEXT.newTab}</span>
                  </a>
                </p>
              ) : null}
            </div>

            <Button
              type="submit"
              disabled={submitting || locked}
              className="h-11 w-full rounded-full bg-foreground text-base text-background hover:bg-foreground/85"
            >
              {submitting ? (
                <>
                  <Spinner aria-hidden="true" aria-label={undefined} />
                  {TEXT.form.submitting}
                </>
              ) : (
                TEXT.form.submit
              )}
            </Button>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {TEXT.form.consent}{" "}
              <a
                href={PRIVACY_POLICY}
                target="_blank"
                rel="noreferrer noopener"
                className="underline underline-offset-2 hover:text-foreground"
              >
                {TEXT.form.privacy}
                <span className="sr-only"> {TEXT.newTab}</span>
              </a>
              .
            </p>
          </form>
        )}
        {/* While a booking is in flight the dialog can't close, so neither can this. */}
        <DialogClose
          disabled={submitting}
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              // 28px across; an invisible ::after makes the hit area 44px (it
              // sits on the padding box, inside the 1px border).
              className="absolute top-2 right-2 after:absolute after:-inset-[9px] after:content-['']"
            />
          }
        >
          <XIcon />
          <span className="sr-only">{TEXT.form.close}</span>
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}

function TextField({
  label,
  name,
  value,
  error,
  onChange,
  disabled,
  maxLength,
  type = "text",
  autoComplete,
  placeholder,
  optional = false,
  multiline = false,
  inputRef,
}: {
  label: ReactNode;
  name: FormField;
  value: string;
  error?: string;
  onChange: (value: string) => void;
  disabled: boolean;
  maxLength: number;
  type?: "text" | "email";
  autoComplete?: string;
  placeholder?: string;
  optional?: boolean;
  multiline?: boolean;
  inputRef?: RefObject<HTMLInputElement | null>;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  const shared = {
    id,
    name,
    value,
    disabled,
    maxLength,
    placeholder,
    required: !optional,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": error ? errorId : undefined,
  };
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm leading-snug font-medium">
        {label}
        {optional ? (
          <span className="font-normal text-muted-foreground">
            {" "}
            {TEXT.form.optional}
          </span>
        ) : null}
      </label>
      {multiline ? (
        <Textarea
          {...shared}
          rows={3}
          onChange={(event) => onChange(event.target.value)}
          className="min-h-20 rounded-xl px-3 py-2.5 text-base md:text-sm"
        />
      ) : (
        <Input
          {...shared}
          ref={inputRef}
          type={type}
          autoComplete={autoComplete}
          onChange={(event) => onChange(event.target.value)}
          className="h-11 rounded-xl px-3 text-base md:text-sm"
        />
      )}
      {error ? (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** The confirmation: when and where, who it's with, and what to do next. */
function BookedView({
  booking,
  email,
  timeZone,
  chosenHeading,
  headingRef,
}: {
  booking: ChannelDemoBooking;
  email: string;
  timeZone: string;
  /** The chosen time's heading, if the booked time doesn't read as a time. */
  chosenHeading: string;
  headingRef: RefObject<HTMLHeadingElement | null>;
}) {
  const hosts = new Intl.ListFormat("en-US", {
    style: "long",
    type: "conjunction",
  }).format(booking.hosts);
  const rows: { label: string; value: string; note?: string }[] = [
    {
      label: TEXT.booked.when,
      value: formatBookedTime(booking.startTime, timeZone) || chosenHeading,
      note: TEXT.booked.length,
    },
    {
      label: TEXT.booked.where,
      value: TEXT.booked.place,
      note: TEXT.booked.placeNote,
    },
    ...(booking.hosts.length
      ? [{ label: TEXT.booked.with, value: hosts }]
      : []),
  ];
  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2.5">
        <CircleCheck
          aria-hidden="true"
          className="size-6 shrink-0 text-brand-mint-deep dark:text-brand-mint"
        />
        <h3
          ref={headingRef}
          tabIndex={-1}
          className="text-xl leading-snug font-semibold tracking-[-0.01em] outline-none"
        >
          {TEXT.booked.title}
        </h3>
      </div>
      <dl className="grid gap-3 rounded-xl border p-4 text-sm">
        {rows.map((row) => (
          <div key={row.label} className="grid grid-cols-[4.5rem_1fr] gap-3">
            <dt className="text-muted-foreground">{row.label}</dt>
            <dd className="flex flex-col gap-0.5">
              <span className="font-medium">{row.value}</span>
              {row.note ? (
                <span className="text-muted-foreground">{row.note}</span>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-sm">
        {TEXT.booked.inviteSent}{" "}
        <span className="font-medium break-all">{email}</span>.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {/* Links that look like buttons: each opens Calendly in a new tab. */}
        <a
          href={booking.rescheduleUrl}
          target="_blank"
          rel="noreferrer"
          className={cn(
            buttonVariants({ variant: "outline" }),
            "h-11 rounded-full px-4",
          )}
        >
          {TEXT.booked.reschedule}
          <span className="sr-only"> {TEXT.newTab}</span>
        </a>
        <a
          href={booking.cancelUrl}
          target="_blank"
          rel="noreferrer"
          className={cn(
            buttonVariants({ variant: "ghost" }),
            "h-11 rounded-full px-4 text-muted-foreground",
          )}
        >
          {TEXT.booked.cancel}
          <span className="sr-only"> {TEXT.newTab}</span>
        </a>
        <DialogClose
          render={
            <Button className="ms-auto h-11 rounded-full bg-foreground px-5 text-background hover:bg-foreground/85" />
          }
        >
          {TEXT.booked.done}
        </DialogClose>
      </div>
    </div>
  );
}
