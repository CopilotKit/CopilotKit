"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
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
import { groupSlotDays, pageTimes } from "@/lib/early-access/slot-days";
import type { OpenTime } from "@/lib/early-access/slot-days";
import { initialTimeZone, storeTimeZone } from "@/lib/early-access/time-zones";
import { BookingDialog, EMPTY_DETAILS } from "./booking-dialog";
import type { BookingDetails, CloseReason } from "./booking-dialog";
import { TimeZoneMenu } from "./time-zone-menu";
import { BOOKER_TEXT as TEXT } from "./text";

/** The booker's anchor: "Get early access" scrolls here and focuses it. */
export const BOOKER_ID = "book";

const TIMES_ENDPOINT = "/api/channel-demo/slots";
/** The proxy gives the website five seconds; this covers it and the trip. */
const CLIENT_TIMEOUT_MS = 8_000;
/** Back on the tab after this long, the times are read again. */
const STALE_MS = 60_000;
const SKELETON_DAYS = 5;
/** Two rows of times: four across, three on a phone. */
const WIDE_QUERY = "(min-width: 640px)";

type TimesState =
  | { phase: "loading" }
  | { phase: "unavailable" }
  /** `at`: when they loaded; times sooner than that plus the lead are gone. */
  | { phase: "ready"; times: ChannelDemoTimes; at: number };

const isStartList = (value: unknown): value is { startTime: string }[] =>
  Array.isArray(value) &&
  value.every(
    (item) =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as { startTime?: unknown }).startTime === "string",
  );

/** The proxy's answer when it has open times; null for anything else. */
function readTimes(body: unknown): ChannelDemoTimes | null {
  if (typeof body !== "object" || body === null) return null;
  const times = body as Partial<ChannelDemoTimes>;
  if (times.status !== "live" || !isStartList(times.slots)) return null;
  if (!times.slots.length) return null;
  return {
    status: "live",
    slots: times.slots,
    unavailable: isStartList(times.unavailable) ? times.unavailable : [],
  };
}

/**
 * The channel event's open times, through the docs' proxy. A refresh is
 * silent: the times on screen stay until fresh ones arrive, and a failed
 * refresh keeps them.
 */
function useChannelTimes(channel: EarlyAccessChannelId) {
  const [state, setState] = useState<TimesState>({ phase: "loading" });
  const current = useRef<AbortController | null>(null);
  const loadedAt = useRef<number | null>(null);

  const load = useCallback(
    (silent: boolean) => {
      current.current?.abort();
      const controller = new AbortController();
      current.current = controller;
      const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
      const settle = (times: ChannelDemoTimes | null) => {
        if (current.current !== controller) return;
        if (times) {
          loadedAt.current = Date.now();
          setState({ phase: "ready", times, at: loadedAt.current });
        } else if (!silent) {
          setState({ phase: "unavailable" });
        }
      };
      fetch(withBasePath(`${TIMES_ENDPOINT}?channel=${channel}`), {
        signal: controller.signal,
        headers: { Accept: "application/json" },
        cache: "no-store",
      })
        .then((response) => response.json())
        .then((body: unknown) => settle(readTimes(body)))
        .catch(() => settle(null))
        .finally(() => clearTimeout(timer));
    },
    [channel],
  );

  useEffect(() => {
    load(false);
    const onVisible = () => {
      if (document.visibilityState !== "visible" || !loadedAt.current) return;
      if (Date.now() - loadedAt.current > STALE_MS) load(true);
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

/** The browser's zone, or the reader's saved one; unknown on the server. */
const subscribeNever = () => () => {};
const serverTimeZone = () => null;

/** A chosen time, its place among the times offered, and its dialog. */
interface Chosen {
  time: OpenTime;
  dayIndex: number;
  slotIndex: number;
  /** One dialog per opening, so each starts clean. */
  session: number;
}

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
  // The zone the times show and book in: known once hydrated, then the
  // reader's pick.
  const startZone = useSyncExternalStore(
    subscribeNever,
    initialTimeZone,
    serverTimeZone,
  );
  const [pickedZone, setPickedZone] = useState<string | null>(null);
  const timeZone = pickedZone ?? startZone;
  const [taken, setTaken] = useState<ReadonlySet<number>>(() => new Set());
  const [dayKey, setDayKey] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [chosen, setChosen] = useState<Chosen | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [details, setDetails] = useState<BookingDetails>(EMPTY_DETAILS);
  const closeReason = useRef<CloseReason>("dismissed");
  const opener = useRef<HTMLElement | null>(null);
  const rootRef = useRef<HTMLElement>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);
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
        ? groupSlotDays(state.times, timeZone, state.at, taken)
        : [],
    [state, timeZone, taken],
  );
  const phase =
    state.phase === "ready" && timeZone && days.length === 0
      ? "unavailable"
      : state.phase === "ready" && !timeZone
        ? "loading"
        : state.phase;
  // The chosen day by its date, so a refresh that drops a time (or a whole
  // day) keeps the reader where they were.
  const dayIndex = Math.max(
    0,
    days.findIndex((day) => day.key === dayKey),
  );
  const day = days[dayIndex];
  const pages = useMemo(
    () => pageTimes(day?.times ?? [], pageSize),
    [day, pageSize],
  );
  const pageIndex = Math.min(page, Math.max(0, pages.length - 1));
  const shown = pages[pageIndex] ?? [];
  const shownOpen = shown.filter((entry) => entry.chip.available);
  const openCount = pages.flat().filter((entry) => entry.chip.available).length;

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

  const openTime = (time: OpenTime, slotIndex: number, from: HTMLElement) => {
    setNotice(null);
    opener.current = from;
    closeReason.current = "dismissed";
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

  const markTaken = (time: OpenTime) =>
    setTaken((current) => new Set(current).add(time.startMs));

  /** Where focus goes as the dialog closes. */
  const finalFocus = () => {
    if (closeReason.current === "slot_taken" && noticeRef.current) {
      return noticeRef.current;
    }
    const time = opener.current;
    // A time that was booked or taken is gone from the grid.
    return time?.isConnected ? time : rootRef.current;
  };

  const fallbackLink = (placement: "unavailable" | "times", label: string) => (
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
        <div className="min-h-11">
          {timeZone ? (
            <TimeZoneMenu
              value={timeZone}
              onChange={(zone) => {
                setPickedZone(zone);
                storeTimeZone(zone);
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
                className="h-[3.25rem] rounded-[18px] bg-background/70 dark:bg-white/5"
              />
            ))}
          </div>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {Array.from({ length: pageSize }, (_, index) => (
              <Skeleton key={index} className="h-11 rounded-full" />
            ))}
          </div>
          <Skeleton className="h-4 w-32" />
        </div>
      ) : null}
      {phase === "loading" ? (
        <span className="sr-only" role="status">
          {TEXT.loading}
        </span>
      ) : null}

      {phase === "unavailable" ? (
        <div className="flex flex-col items-start gap-1 rounded-2xl border border-dashed p-5">
          <p className="font-medium">{TEXT.unavailable.title}</p>
          <p className="text-sm text-muted-foreground">
            {TEXT.unavailable.body}
          </p>
          {fallbackLink("unavailable", TEXT.unavailable.link)}
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
                aria-label={d.label}
                className="flex h-[3.25rem] min-w-0 flex-col gap-0 rounded-[18px] px-1 text-foreground/70 hover:text-foreground data-active:bg-background data-active:text-foreground data-active:shadow-sm data-active:ring-1 data-active:ring-brand-lilac-mid dark:data-active:bg-[#23232f] dark:data-active:ring-brand-lilac"
              >
                <span className="text-xs font-normal">{d.weekday}</span>
                <span className="text-sm font-semibold">{d.date}</span>
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
            markTaken(time);
            refresh();
          }}
          onSlotTaken={(time) => {
            markTaken(time);
            setNotice(TEXT.slotTaken);
            refresh();
            closeReason.current = "slot_taken";
            setDialogOpen(false);
          }}
          onClose={(reason) => {
            closeReason.current = reason;
            setDialogOpen(false);
          }}
          onClosed={() => {
            setChosen(null);
            // The notice renders with the close; make sure it has focus.
            if (closeReason.current === "slot_taken") {
              requestAnimationFrame(() => noticeRef.current?.focus());
            }
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
