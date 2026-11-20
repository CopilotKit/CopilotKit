import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent, Ref } from "react";
import { ThreadIcon } from "../lib/thread-icons";
import { useMediaQuery } from "../lib/use-media-query";

export interface StarterCard {
  title: string;
  view: string;
  icon: string;
  pick: () => void;
}

/** How long one move takes; the CSS transition reads it as --slide-duration. */
const SLIDE_MS = 460;
/** Wheel travel, in pixels, that steps one card. */
const WHEEL_STEP = 40;
/** Swipe travel, in pixels, that steps one card. */
const SWIPE_STEP = 36;

/**
 * The welcome's starters as an endless strip: a few at a time; the arrows,
 * the wheel and a swipe each move it one card along. The
 * track holds three copies of the list; after each move the position folds
 * back into the middle copy without animating, so it never runs out.
 */
export function StarterCarousel({
  starters,
  ref,
}: {
  starters: StarterCard[];
  ref?: Ref<HTMLDivElement>;
}) {
  const count = starters.length;
  const perView = useMediaQuery("(max-width: 640px)") ? 2 : 4;
  const [start, setStart] = useState(0);
  const [instant, setInstant] = useState(false);
  const moving = useRef(false);
  const viewport = useRef<HTMLDivElement>(null);
  const swipe = useRef<number | null>(null);

  const move = (by: number) => {
    if (moving.current || count <= perView) return;
    moving.current = true;
    setInstant(false);
    setStart((value) => value + by);
    window.setTimeout(() => {
      moving.current = false;
      setInstant(true);
      setStart((value) => ((value % count) + count) % count);
    }, SLIDE_MS);
  };

  // The wheel steps one card per notch, sideways or down; the page under
  // the welcome does not scroll while the pointer is on the strip.
  const moveRef = useRef(move);
  moveRef.current = move;
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    let travel = 0;
    const onWheel = (event: WheelEvent) => {
      const delta =
        Math.abs(event.deltaX) > Math.abs(event.deltaY)
          ? event.deltaX
          : event.deltaY;
      event.preventDefault();
      travel += delta;
      if (Math.abs(travel) >= WHEEL_STEP) {
        moveRef.current(travel > 0 ? 1 : -1);
        travel = 0;
      }
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, []);

  const onPointerDown = (event: PointerEvent) => {
    if (event.pointerType !== "mouse") swipe.current = event.clientX;
  };
  const onPointerUp = (event: PointerEvent) => {
    if (swipe.current === null) return;
    const travel = swipe.current - event.clientX;
    swipe.current = null;
    if (Math.abs(travel) >= SWIPE_STEP) move(travel > 0 ? 1 : -1);
  };

  if (count === 0) return null;
  const track = [...starters, ...starters, ...starters];
  const first = count + start;

  return (
    <div
      ref={ref}
      className="starters"
      role="group"
      aria-label="Starting questions"
    >
      <button
        type="button"
        className="starters__arrow"
        data-side="start"
        aria-label="Previous starters"
        onClick={() => move(-1)}
      >
        <ChevronLeft size={16} strokeWidth={2} aria-hidden />
      </button>
      <div
        ref={viewport}
        className="starters__viewport"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (swipe.current = null)}
      >
        <div
          className="starters__track"
          data-instant={instant || undefined}
          style={
            {
              "--index": first,
              "--per-view": perView,
              "--slide-duration": `${SLIDE_MS}ms`,
            } as CSSProperties
          }
        >
          {track.map((starter, index) => {
            const shown = index >= first && index < first + perView;
            return (
              <button
                key={`${starter.title}-${index}`}
                type="button"
                className="starter-slip"
                aria-hidden={!shown}
                tabIndex={shown ? 0 : -1}
                onClick={starter.pick}
              >
                <ThreadIcon name={starter.icon} size={18} />
                <span className="starter-slip__title">{starter.title}</span>
                <span className="starter-slip__view">{starter.view}</span>
              </button>
            );
          })}
        </div>
      </div>
      <button
        type="button"
        className="starters__arrow"
        data-side="end"
        aria-label="More starters"
        onClick={() => move(1)}
      >
        <ChevronRight size={16} strokeWidth={2} aria-hidden />
      </button>
    </div>
  );
}
