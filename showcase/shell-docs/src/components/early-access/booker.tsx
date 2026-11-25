"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode, RefObject } from "react";
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/cn";
import { withBasePath } from "@/lib/base-path";
import { trackEvent } from "@/lib/telemetry/analytics";
import type { ChannelDemoTimes } from "@/lib/early-access/booking";
import { earlyAccessChannel } from "@/lib/early-access/channels";
import type { EarlyAccessChannelId } from "@/lib/early-access/channels";
import { EARLY_ACCESS_CHANNEL_COPY } from "@/lib/early-access/copy";
import {
  SLOT_LEAD_MS,
  groupSlotDays,
  pageTimes,
} from "@/lib/early-access/slot-days";
import type { OpenTime, SlotDay } from "@/lib/early-access/slot-days";
import { initialTimeZone, storeTimeZone } from "@/lib/early-access/time-zones";
import { BookingDialog, EMPTY_DETAILS } from "./booking-dialog";
import type { BookingDetails } from "./booking-dialog";
import { TimeZoneMenu } from "./time-zone-menu";
import { BOOKER_TEXT as TEXT } from "./text";

/** The booker's anchor: "Get early access" scrolls here and focuses it. */
export const BOOKER_ID = "book";

const TIMES_ENDPOINT = "/api/channel-demo/slots";
/** The proxy gives the website 12 seconds; this covers it and the trip. */
const CLIENT_TIMEOUT_MS = 15_000;
/** Back on the tab after this long, the times are read again. */
const STALE_MS = 60_000;
/** How often the clock that retires past times moves while the tab is seen. */
const TICK_MS = 60_000;
const SKELETON_DAYS = 5;
/** Two rows of times: four across from Tailwind's `sm`, three on a phone. */
const WIDE_QUERY = "(min-width: 40rem)";

type LiveTimes = Extract<ChannelDemoTimes, { status: "live" }>;

type TimesState =
  | { phase: "loading" }
  /** No times: the event has none (`none`), or they didn't load (`error`). */
  | { phase: "unavailable"; reason: "none" | "error" }
  /** `at`: when they loaded. */
  | { phase: "ready"; times: LiveTimes; at: number };

/** What a read of the times found. */
type TimesRead =
  | { kind: "live"; times: LiveTimes }
  | { kind: "none" }
  | { kind: "error" };

const isStartList = (value: unknown): value is { startTime: string }[] =>
  Array.isArray(value) &&
  value.every(
    (item) =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as { startTime?: unknown }).startTime === "string",
  );

/** The proxy's answer: open times, none at all, or a read that failed. */
function readTimes(body: unknown): TimesRead {
  if (typeof body !== "object" || body === null) return { kind: "error" };
  const answer = body as {
    status?: unknown;
    reason?: unknown;
    slots?: unknown;
    unavailable?: unknown;
  };
  if (answer.status === "unavailable") {
    return answer.reason === "none" ? { kind: "none" } : { kind: "error" };
  }
  if (answer.status !== "live" || !isStartList(answer.slots)) {
    return { kind: "error" };
  }
  if (!answer.slots.length) return { kind: "none" };
  return {
    kind: "live",
    times: {
      status: "live",
      slots: answer.slots,
      unavailable: isStartList(answer.unavailable) ? answer.unavailable : [],
    },
  };
}

/**
 * The channel event's open times, through the docs' proxy. A refresh is
 * silent: the times on screen stay until fresh ones arrive. A refresh that
 * fails keeps them; one that finds no open times replaces them. Back on the
 * tab, the times are read again when they are a minute old or the last read
 * failed.
 */
function useChannelTimes(channel: EarlyAccessChannelId) {
  const [state, setState] = useState<TimesState>({ phase: "loading" });
  const current = useRef<AbortController | null>(null);
  /** When the last read that answered was made. */
  const readAt = useRef<number | null>(null);
  const lastReadFailed = useRef(false);

  const load = useCallback(
    (silent: boolean) => {
      current.current?.abort();
      const controller = new AbortController();
      current.current = controller;
      const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
      const settle = (read: TimesRead) => {
        if (current.current !== controller) return;
        lastReadFailed.current = read.kind === "error";
        if (read.kind === "error") {
          if (!silent) setState({ phase: "unavailable", reason: "error" });
          return;
        }
        readAt.current = Date.now();
        setState(
          read.kind === "live"
            ? { phase: "ready", times: read.times, at: readAt.current }
            : { phase: "unavailable", reason: "none" },
        );
      };
      fetch(withBasePath(`${TIMES_ENDPOINT}?channel=${channel}`), {
        signal: controller.signal,
        headers: { Accept: "application/json" },
        cache: "no-store",
      })
        .then((response) => response.json())
        .then((body: unknown) => settle(readTimes(body)))
        .catch(() => settle({ kind: "error" }))
        .finally(() => clearTimeout(timer));
    },
    [channel],
  );

  useEffect(() => {
    load(false);
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const stale =
        readAt.current !== null && Date.now() - readAt.current > STALE_MS;
      if (lastReadFailed.current || stale) load(true);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      current.current?.abort();
      current.current = null;
    };
  }, [load]);

  return { state, refresh: useCallback(() => load(true), [load]) };
}

/**
 * The time, moved on every minute while the tab is seen, so a time stops
 * being offered once it is inside the lead. Null until mounted.
 */
function useNow() {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const sync = () => {
      clearInterval(timer);
      timer = undefined;
      if (document.visibilityState !== "visible") return;
      setNow(Date.now());
      timer = setInterval(() => setNow(Date.now()), TICK_MS);
    };
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);
  return now;
}

function usePageSize() {
  const [size, setSize] = useState(8);
  useEffect(() => {
    const query = window.matchMedia(WIDE_QUERY);
    const sync = () => setSize(query.matches ? 8 : 6);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  return size;
}

/**
 * The day to show: the chosen one; once it has gone, the next later one,
 * else the last (keys are YYYY-MM-DD, so they compare as strings).
 */
function selectedDayIndex(days: readonly SlotDay[], key: string | null) {
  if (!days.length) return -1;
  if (key === null) return 0;
  const chosen = days.findIndex((day) => day.key === key);
  if (chosen !== -1) return chosen;
  const later = days.findIndex((day) => day.key > key);
  return later !== -1 ? later : days.length - 1;
}

/** Whether a time is too soon to book by now (inside the lead). */
const tooSoon = (time: OpenTime) => time.startMs - Date.now() <= SLOT_LEAD_MS;

/** A chosen time, its place among the times offered, and its dialog. */
interface Chosen {
  time: OpenTime;
  dayIndex: number;
  slotIndex: number;
  /** One dialog per opening, so each starts clean. */
  session: number;
}

/** How the dialog's last opening ended, which says where focus goes. */
type Outcome = "open" | "booked" | "slot_taken" | "unconfirmed";

/**
 * The channel page's demo booker: the next days with open times on the
 * channel's own Calendly event, in the reader's time zone, each time booked
 * in place in a dialog. A skeleton holds its shape while the times load; with
 * none to show, a link books on copilotkit.ai instead. Its telemetry carries
 * the channel, never the reader's details.
 */
export function ChannelDemoBooker({
  channel,
}: {
  channel: EarlyAccessChannelId;
}) {
  const copy = EARLY_ACCESS_CHANNEL_COPY[channel];
  const fallbackUrl = earlyAccessChannel(channel)?.fallbackUrl ?? "";
  const { state, refresh } = useChannelTimes(channel);
  const now = useNow();
  // The zone the times show and book in. The reader's stored choice and the
  // browser's zone exist only in the browser, so they are read once, after
  // hydration; from then on only the reader's own pick changes it.
  const [timeZone, setTimeZone] = useState<string | null>(null);
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- reads browser-only storage once, after hydration
    setTimeZone(initialTimeZone());
  }, []);
  const [taken, setTaken] = useState<ReadonlySet<number>>(() => new Set());
  const [dayKey, setDayKey] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  /** A booking that may have gone through: nothing more is booked here. */
  const [locked, setLocked] = useState(false);
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [details, setDetails] = useState<BookingDetails>(EMPTY_DETAILS);
  const outcome = useRef<Outcome>("open");
  const opener = useRef<HTMLElement | null>(null);
  const rootRef = useRef<HTMLElement>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
  const lockedRef = useRef<HTMLDivElement>(null);
  const earlierRef = useRef<HTMLButtonElement>(null);
  const laterRef = useRef<HTMLButtonElement>(null);
  const viewed = useRef(false);
  const pageSize = usePageSize();
  const id = useId();
  const headingId = `${id}-heading`;

  useEffect(() => {
    if (viewed.current) return;
    viewed.current = true;
    trackEvent("docs.channel_demo_viewed", { channel });
  }, [channel]);

  const days = useMemo(
    () =>
      state.phase === "ready" && timeZone
        ? groupSlotDays(
            state.times,
            timeZone,
            Math.max(now ?? 0, state.at),
            taken,
          )
        : [],
    [state, timeZone, now, taken],
  );
  const phase = locked
    ? "locked"
    : state.phase !== "ready"
      ? state.phase
      : !timeZone
        ? "loading"
        : days.length
          ? "ready"
          : "unavailable";
  const dayIndex = selectedDayIndex(days, dayKey);
  const day: SlotDay | undefined = days[dayIndex];
  // The chosen day has gone (its times passed or were taken): the day shown
  // instead becomes the choice.
  if (day && dayKey !== null && day.key !== dayKey) {
    setDayKey(day.key);
    setPage(0);
  }
  const pages = useMemo(
    () => pageTimes(day?.times ?? [], pageSize),
    [day, pageSize],
  );
  const pageIndex = Math.min(page, Math.max(0, pages.length - 1));
  const shown = pages[pageIndex] ?? [];
  const shownOpen = shown.filter((entry) => entry.chip.available);
  const openCount = pages.flat().filter((entry) => entry.chip.available).length;

  /** Focus, once the change that renders the target has. */
  const focusSoon = (target: () => HTMLElement | null) =>
    requestAnimationFrame(() => (target() ?? rootRef.current)?.focus());

  const selectDay = (key: string) => {
    if (key === day?.key) return;
    setNotice(null);
    setPage(0);
    setDayKey(key);
  };

  const turnPage = (step: 1 | -1) => {
    const next = pageIndex + step;
    if (!pages[next]) return;
    setNotice(null);
    setPage(next);
    // At either end the arrow pressed is disabled: focus moves to the other.
    if (!pages[next + step])
      (step > 0 ? earlierRef : laterRef).current?.focus();
  };

  const markTaken = (time: OpenTime) =>
    setTaken((current) => new Set(current).add(time.startMs));

  const openTime = (time: OpenTime, slotIndex: number, from: HTMLElement) => {
    if (locked) return;
    if (tooSoon(time)) {
      // Too soon to book by now: the time goes, the times are read again,
      // and the reader is told why.
      markTaken(time);
      setNotice(TEXT.tooSoon);
      refresh();
      focusSoon(() => noticeRef.current);
      return;
    }
    setNotice(null);
    opener.current = from;
    outcome.current = "open";
    trackEvent("docs.channel_demo_slot_selected", {
      channel,
      day_index: dayIndex,
      slot_index: slotIndex,
    });
    setChosen({
      time,
      dayIndex,
      slotIndex,
      session: (chosen?.session ?? 0) + 1,
    });
    setDialogOpen(true);
  };

  /**
   * Where focus goes as the dialog closes: back to the time when it is still
   * there. Otherwise nowhere yet: `onClosed` moves it once the dialog has
   * gone, since base-ui would pick the booker's first control instead.
   */
  const finalFocus = () => {
    const time = opener.current;
    return outcome.current === "open" && time?.isConnected ? time : false;
  };

  const focusAfterClose = () => {
    const ended = outcome.current;
    if (ended === "open" && opener.current?.isConnected) return;
    focusSoon(() =>
      ended === "slot_taken"
        ? noticeRef.current
        : ended === "unconfirmed"
          ? lockedRef.current
          : rootRef.current,
    );
  };

  const fallbackLink = (
    placement: "unavailable" | "times" | "unconfirmed",
    label: string,
  ) => (
    <a
      href={fallbackUrl}
      target="_blank"
      rel="noreferrer noopener"
      onClick={() =>
        trackEvent("docs.channel_demo_fallback_clicked", {
          channel,
          placement,
        })
      }
      className="inline-flex min-h-11 items-center gap-1.5 rounded-sm text-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {label}
      <ArrowRight className="size-3.5" aria-hidden="true" />
      <span className="sr-only"> {TEXT.newTab}</span>
    </a>
  );

  const showsZone = phase === "loading" || phase === "ready";

  return (
    <section
      ref={rootRef}
      id={BOOKER_ID}
      aria-labelledby={headingId}
      aria-busy={phase === "loading" ? true : undefined}
      tabIndex={-1}
      className="flex scroll-mt-24 flex-col gap-4 rounded-[24px] border bg-card p-5 shadow-card outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:p-6 dark:bg-[#13131b]"
    >
      <header className="flex flex-col gap-1">
        <h2
          id={headingId}
          className="text-xl leading-snug font-semibold tracking-[-0.02em]"
        >
          {copy.booking.heading}
        </h2>
        <p className="text-sm leading-normal text-muted-foreground">
          {copy.booking.note}
        </p>
        {/* Holds its place while the times load; with none, it says nothing. */}
        <div className={cn("min-h-11", !showsZone && "hidden")}>
          {timeZone && showsZone ? (
            <TimeZoneMenu
              value={timeZone}
              at={day?.times[0]?.startMs}
              onChange={(zone) => {
                setTimeZone(zone);
                storeTimeZone(zone);
                setPage(0);
              }}
            />
          ) : null}
        </div>
      </header>

      {phase === "loading" ? (
        <div className="flex flex-col gap-4" aria-hidden="true">
          <div className="grid grid-cols-5 gap-1 rounded-[22px] bg-muted p-1">
            {Array.from({ length: SKELETON_DAYS }, (_, index) => (
              <Skeleton
                key={index}
                className="h-[3.25rem] rounded-[18px] bg-background/70 motion-reduce:animate-none dark:bg-white/5"
              />
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {Array.from({ length: pageSize }, (_, index) => (
              <Skeleton
                key={index}
                className="h-11 rounded-full motion-reduce:animate-none"
              />
            ))}
          </div>
          <Skeleton className="h-4 w-32 motion-reduce:animate-none" />
        </div>
      ) : null}
      {phase === "loading" ? (
        <span className="sr-only" role="status">
          {TEXT.loading}
        </span>
      ) : null}

      {phase === "unavailable" ? (
        <div className="flex flex-col items-start gap-1 rounded-2xl border border-dashed p-5">
          <p className="font-medium">
            {state.phase === "unavailable" && state.reason === "error"
              ? TEXT.unavailable.error
              : TEXT.unavailable.none}
          </p>
          <p className="text-sm text-muted-foreground">
            {TEXT.unavailable.body}
          </p>
          {fallbackLink("unavailable", TEXT.unavailable.link)}
        </div>
      ) : null}

      {phase === "locked" ? (
        <div
          ref={lockedRef}
          tabIndex={-1}
          className="flex flex-col items-start gap-1 rounded-2xl border border-dashed p-5 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <p className="font-medium">{TEXT.unconfirmed.title}</p>
          <p className="text-sm text-muted-foreground">
            {TEXT.unconfirmed.body}
          </p>
          {fallbackLink("unconfirmed", TEXT.unconfirmed.link)}
        </div>
      ) : null}

      {phase === "ready" && day ? (
        <Tabs
          value={day.key}
          onValueChange={(value) => {
            if (typeof value === "string") selectDay(value);
          }}
          className="gap-4"
        >
          <TabsList
            aria-label={TEXT.days}
            activateOnFocus
            className="grid h-auto w-full auto-cols-fr grid-flow-col gap-1 rounded-[22px] bg-muted p-1 group-data-horizontal/tabs:h-auto"
          >
            {days.map((d) => (
              <TabsTrigger
                key={d.key}
                value={d.key}
                className="flex h-[3.25rem] min-w-0 flex-col gap-0 rounded-[18px] px-1 text-foreground/70 hover:text-foreground data-active:bg-background data-active:text-foreground data-active:shadow-sm data-active:ring-1 data-active:ring-brand-lilac-mid dark:data-active:bg-[#23232f] dark:data-active:ring-brand-lilac"
              >
                <span className="text-xs font-normal">{d.weekday}</span>
                <span className="text-sm font-semibold">{d.date}</span>
                <span className="sr-only">, {d.label}</span>
              </TabsTrigger>
            ))}
          </TabsList>
          {/* Not a tab stop of its own: Tab goes from the day to its times. */}
          <TabsContent
            value={day.key}
            tabIndex={-1}
            className="flex flex-col gap-3"
          >
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {shown.map(({ chip, slotIndex }) =>
                chip.available ? (
                  <li key={chip.startMs}>
                    <button
                      type="button"
                      aria-label={chip.label}
                      aria-haspopup="dialog"
                      onClick={(event) =>
                        openTime(chip, slotIndex, event.currentTarget)
                      }
                      className="h-11 w-full rounded-full border bg-background text-sm font-medium tabular-nums transition-colors outline-none hover:border-edge-action hover:bg-accent focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 motion-reduce:transition-none dark:bg-transparent"
                    >
                      {chip.time}
                    </button>
                  </li>
                ) : (
                  // Shown, never offered. Its own key makes a time that turns
                  // unavailable a new element, so focus never returns to it.
                  <li key={`unavailable-${chip.startMs}`}>
                    <button
                      type="button"
                      disabled
                      aria-label={chip.label}
                      title={TEXT.unavailableTimeHint}
                      className="h-11 w-full cursor-not-allowed rounded-full text-sm text-muted-foreground tabular-nums line-through decoration-muted-foreground/60"
                    >
                      {chip.time}
                    </button>
                  </li>
                ),
              )}
            </ul>
            <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-2">
              {notice ? (
                <p
                  ref={noticeRef}
                  role="status"
                  tabIndex={-1}
                  className="rounded-sm text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  {notice}
                </p>
              ) : (
                fallbackLink("times", TEXT.anotherTime)
              )}
              {pages.length > 1 ? (
                <div className="ms-auto flex items-center gap-2">
                  <span className="sr-only" aria-live="polite">
                    {shownOpen.length
                      ? TEXT.showing(
                          shownOpen[0].slotIndex + 1,
                          shownOpen[shownOpen.length - 1].slotIndex + 1,
                          openCount,
                        )
                      : ""}
                  </span>
                  <PagerButton
                    buttonRef={earlierRef}
                    label={TEXT.earlier}
                    disabled={pageIndex === 0}
                    onClick={() => turnPage(-1)}
                  >
                    <ChevronLeft aria-hidden="true" />
                  </PagerButton>
                  <PagerButton
                    buttonRef={laterRef}
                    label={TEXT.later}
                    disabled={pageIndex === pages.length - 1}
                    onClick={() => turnPage(1)}
                  >
                    <ChevronRight aria-hidden="true" />
                  </PagerButton>
                </div>
              ) : null}
            </div>
          </TabsContent>
        </Tabs>
      ) : null}

      {chosen && timeZone ? (
        <BookingDialog
          key={chosen.session}
          channel={channel}
          time={chosen.time}
          open={dialogOpen}
          timeZone={timeZone}
          details={details}
          onDetailsChange={setDetails}
          onBooked={(time) => {
            outcome.current = "booked";
            markTaken(time);
            refresh();
          }}
          onSlotTaken={(time) => {
            outcome.current = "slot_taken";
            markTaken(time);
            setNotice(TEXT.slotTaken);
            refresh();
            setDialogOpen(false);
          }}
          onUnconfirmed={(time) => {
            // It may have booked: the time goes, and nothing more is booked
            // here, so it can't be booked twice.
            outcome.current = "unconfirmed";
            markTaken(time);
            setLocked(true);
            refresh();
          }}
          onClose={() => setDialogOpen(false)}
          onClosed={() => {
            setChosen(null);
            focusAfterClose();
          }}
          finalFocus={finalFocus}
        />
      ) : null}
    </section>
  );
}

function PagerButton({
  label,
  disabled,
  onClick,
  buttonRef,
  children,
}: {
  label: string;
  disabled: boolean;
  onClick: () => void;
  buttonRef: RefObject<HTMLButtonElement | null>;
  children: ReactNode;
}) {
  return (
    <Button
      ref={buttonRef}
      variant="outline"
      size="icon"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      // 36px across; an invisible ::after makes the hit area 44px.
      className={cn(
        "relative size-9 rounded-full after:absolute after:-inset-1 after:content-['']",
      )}
    >
      {children}
    </Button>
  );
}
