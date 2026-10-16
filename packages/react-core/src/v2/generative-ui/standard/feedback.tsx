import React, {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type { CSSProperties, KeyboardEvent, ReactNode, RefObject } from "react";
import { z } from "zod";
import { CHILDREN_SLOT, sizeValue } from "./layout";
import { useStandardStyles } from "./styles";
import {
  backgroundColor,
  borderColor,
  radius,
  spacing,
  textColor,
  textFont,
  SHADOW_MD,
  SHIMMER_HIGHLIGHT,
} from "./tokens";

// ---- Styles ----

export const FEEDBACK_STYLE_ID = "a2ui-standard-feedback";

/**
 * The keyframes of the feedback components, and the rules that stop their
 * motion when the user asks for reduced motion. An element that moves has
 * `data-a2ui-motion`. The confetti layer has `data-a2ui-celebration`, and
 * it is hidden, because still confetti has no meaning.
 */
export const FEEDBACK_CSS = [
  "@keyframes a2ui-spin{to{transform:rotate(360deg)}}",
  "@keyframes a2ui-pulse{0%{transform:scale(1);opacity:.6}100%{transform:scale(2.4);opacity:0}}",
  "@keyframes a2ui-block-shimmer{0%{background-position:100% 0}100%{background-position:-100% 0}}",
  "@keyframes a2ui-confetti{0%{transform:translate(0,0) rotate(0);opacity:1}100%{transform:translate(var(--a2ui-dx),var(--a2ui-dy)) rotate(var(--a2ui-rot));opacity:0}}",
  "[data-a2ui-feedback-button]:focus-visible{outline:2px solid var(--a2ui-color-focus, #0285ff);outline-offset:2px}",
  "@media (prefers-reduced-motion: reduce){[data-a2ui-motion]{animation:none !important}[data-a2ui-celebration]{display:none}}",
].join("\n");

// There is no document on the server, so nothing is added there.
const noEffect: typeof React.useInsertionEffect = () => {};
const useInjectEffect =
  typeof document === "undefined" ? noEffect : React.useInsertionEffect;

/** Adds the standard stylesheet and the feedback stylesheet, once each. */
function useFeedbackStyles() {
  useStandardStyles();
  useInjectEffect(() => {
    if (document.getElementById(FEEDBACK_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = FEEDBACK_STYLE_ID;
    style.textContent = FEEDBACK_CSS;
    document.head.appendChild(style);
  }, []);
}

/** Text that only screen readers read. */
const VISUALLY_HIDDEN: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0 0 0 0)",
  whiteSpace: "nowrap",
  border: 0,
};

/** A native button without the browser look. */
const BUTTON_RESET: CSSProperties = {
  margin: 0,
  padding: 0,
  border: 0,
  background: "none",
  font: "inherit",
  color: "inherit",
  textAlign: "inherit",
  cursor: "pointer",
};

// ---- Schemas ----

const SPINNER_SIZES = ["sm", "md", "lg"] as const;

const loadingSchema = z.object({
  label: z.string().optional().describe('Default "Loading"'),
  size: z.enum(SPINNER_SIZES).optional().describe('Default "md"'),
});
const loadingIndicatorSchema = z.object({
  label: z
    .string()
    .optional()
    .describe('What is loading, for screen readers. Default "Loading"'),
  color: z.string().optional().describe('Text color token. Default "prose"'),
  size: z.enum(SPINNER_SIZES).optional().describe('Default "md"'),
});
const loadingBlockSchema = z.object({
  label: z.string().optional(),
  background: z
    .string()
    .optional()
    .describe('Background token. Default "surface-tertiary"'),
  duration: z.number().optional().describe("Milliseconds. Default 1500"),
});
const pulseIndicatorSchema = z.object({
  label: z
    .string()
    .optional()
    .describe(
      "What the dot means, for screen readers. Leave it unset when text next to the dot says the same",
    ),
  color: z.string().optional().describe('Text color token. Default "success"'),
  size: z.number().optional().describe("Pixels. Default 12"),
  pulseColor: z.string().optional(),
  duration: z.number().optional().describe("Milliseconds. Default 1500"),
});
const celebrationSchema = z.object({
  trigger: z
    .string()
    .optional()
    .describe("Each new value plays the confetti again"),
});
const flashcardSchema = z.object({
  front: z.string().optional().describe("The text on the front"),
  back: z.string().optional().describe("The text on the back"),
  hint: z
    .string()
    .optional()
    .describe('A small line under the front, for example "Click to flip"'),
});
const popoverSchema = z.object({
  open: z.boolean().optional().describe("Default false"),
  showOnHover: z.boolean().optional(),
});
const popoverContentSchema = z.object({
  side: z
    .enum(["top", "bottom", "left", "right"])
    .optional()
    .describe('Default "bottom"'),
  align: z
    .enum(["start", "center", "end"])
    .optional()
    .describe('Default "center"'),
  width: sizeValue.optional().describe("4px steps when a number"),
});

type SpinnerSize = (typeof SPINNER_SIZES)[number];
type WithChildren<Props> = Props & { children?: ReactNode };
type LoadingProps = z.output<typeof loadingSchema>;
type LoadingIndicatorProps = z.output<typeof loadingIndicatorSchema>;
type LoadingBlockProps = z.output<typeof loadingBlockSchema>;
type PulseIndicatorProps = z.output<typeof pulseIndicatorSchema>;
type CelebrationProps = WithChildren<z.output<typeof celebrationSchema>>;
type FlashcardProps = z.output<typeof flashcardSchema>;
type PopoverProps = WithChildren<
  z.output<typeof popoverSchema> & { setOpen: (value: boolean) => void }
>;
type PopoverContentProps = WithChildren<z.output<typeof popoverContentSchema>>;

// ---- Loading ----

const SPINNER_PX: Record<SpinnerSize, number> = { sm: 14, md: 20, lg: 28 };

/** A spinning ring. It is decoration: the caller names the status. */
function Spinner({ size, color }: { size?: SpinnerSize; color?: string }) {
  const px = SPINNER_PX[size ?? "md"];
  return (
    <span
      aria-hidden="true"
      data-a2ui-motion=""
      style={{
        display: "inline-block",
        flex: "none",
        width: px,
        height: px,
        boxSizing: "border-box",
        borderRadius: "9999px",
        border: `2px solid ${borderColor("default")}`,
        borderTopColor: textColor(color ?? "prose"),
        animation: "a2ui-spin 0.8s linear infinite",
      }}
    />
  );
}

function Loading(props: LoadingProps) {
  useFeedbackStyles();
  return (
    <div
      role="status"
      data-a2ui-std=""
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: spacing(2),
        ...textFont(props.size === "lg" ? "md" : "sm"),
        color: textColor("secondary"),
      }}
    >
      <Spinner size={props.size} />
      <span>{props.label ?? "Loading"}</span>
    </div>
  );
}

function LoadingIndicator(props: LoadingIndicatorProps) {
  useFeedbackStyles();
  return (
    <span role="status" data-a2ui-std="" style={{ display: "inline-flex" }}>
      <Spinner size={props.size} color={props.color} />
      <span style={VISUALLY_HIDDEN}>{props.label ?? "Loading"}</span>
    </span>
  );
}

function LoadingBlock(props: LoadingBlockProps) {
  useFeedbackStyles();
  return (
    <div
      role="status"
      aria-busy="true"
      data-a2ui-std=""
      data-a2ui-motion=""
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: 64,
        width: "100%",
        borderRadius: radius("lg"),
        backgroundColor: backgroundColor(
          props.background ?? "surface-tertiary",
        ),
        backgroundImage: `linear-gradient(90deg, transparent 0%, ${SHIMMER_HIGHLIGHT} 50%, transparent 100%)`,
        backgroundSize: "200% 100%",
        animation: `a2ui-block-shimmer ${props.duration ?? 1500}ms linear infinite`,
        ...textFont("sm"),
        color: textColor("secondary"),
      }}
    >
      {props.label ?? <span style={VISUALLY_HIDDEN}>Loading</span>}
    </div>
  );
}

function PulseIndicator(props: PulseIndicatorProps) {
  useFeedbackStyles();
  const size = props.size ?? 12;
  const color = textColor(props.color ?? "success");
  const hasLabel = props.label !== undefined;
  return (
    <span
      role={hasLabel ? "img" : undefined}
      aria-label={props.label}
      aria-hidden={hasLabel ? undefined : "true"}
      data-a2ui-std=""
      style={{
        position: "relative",
        display: "inline-block",
        width: size,
        height: size,
        flex: "none",
      }}
    >
      <span
        data-a2ui-motion=""
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "9999px",
          background: textColor(props.pulseColor) ?? color,
          animation: `a2ui-pulse ${props.duration ?? 1500}ms ease-out infinite`,
        }}
      />
      <span
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "9999px",
          background: color,
        }}
      />
    </span>
  );
}

// ---- Celebration ----

const CONFETTI = ["🎉", "✨", "🎊", "⭐", "💫", "🥳"];
const PARTICLES = 24;
/** How long one confetti burst plays, in milliseconds. */
export const CELEBRATION_MS = 1200;

/** The CSS of one confetti particle, spread on a circle around the center. */
function particleStyle(index: number) {
  const angle = (index / PARTICLES) * Math.PI * 2;
  const distance = 60 + (index % 4) * 20;
  const style: CSSProperties & Record<`--a2ui-${string}`, string> = {
    position: "absolute",
    left: "50%",
    top: "50%",
    fontSize: 14,
    "--a2ui-dx": `${Math.round(Math.cos(angle) * distance)}px`,
    "--a2ui-dy": `${Math.round(Math.sin(angle) * distance)}px`,
    "--a2ui-rot": `${(index * 47) % 360}deg`,
    animation: `a2ui-confetti ${CELEBRATION_MS}ms ease-out forwards`,
  };
  return style;
}

function Celebration(props: CelebrationProps) {
  useFeedbackStyles();
  const [burst, setBurst] = useState(0);
  useEffect(() => {
    setBurst((count) => count + 1);
    const timer = setTimeout(() => setBurst(0), CELEBRATION_MS);
    return () => clearTimeout(timer);
  }, [props.trigger]);
  const particles = Array.from({ length: PARTICLES }, (_, index) => index);
  return (
    <div
      data-a2ui-std=""
      style={{ position: "relative", display: "flex", flexDirection: "column" }}
    >
      {props.children}
      {burst > 0 ? (
        <div
          key={burst}
          aria-hidden="true"
          data-a2ui-celebration=""
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            overflow: "visible",
          }}
        >
          {particles.map((index) => (
            <span key={index} data-a2ui-motion="" style={particleStyle(index)}>
              {CONFETTI[index % CONFETTI.length]}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// ---- FlashcardFlip ----

/**
 * A native toggle button. Click, Enter and Space flip it, and
 * `aria-pressed` tells a screen reader which side shows.
 */
function FlashcardFlip(props: FlashcardProps) {
  useFeedbackStyles();
  const [flipped, setFlipped] = useState(false);
  const showsHint = props.hint !== undefined && !flipped;
  return (
    <button
      type="button"
      aria-pressed={flipped}
      data-a2ui-std=""
      data-a2ui-feedback-button=""
      onClick={() => setFlipped((current) => !current)}
      style={{
        ...BUTTON_RESET,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: spacing(2),
        minHeight: 140,
        width: "100%",
        padding: spacing(5),
        boxSizing: "border-box",
        textAlign: "center",
        border: `1px solid ${borderColor("default")}`,
        borderRadius: radius("xl"),
        background: backgroundColor(flipped ? "surface-secondary" : "surface"),
        color: textColor("default"),
      }}
    >
      <span style={{ ...textFont("lg"), fontWeight: 600 }}>
        {flipped ? props.back : props.front}
      </span>
      {showsHint ? (
        <span style={{ ...textFont("sm"), color: textColor("tertiary") }}>
          {props.hint}
        </span>
      ) : null}
    </button>
  );
}

// ---- Popover ----

interface PopoverState {
  open: boolean;
  setOpen: (value: boolean) => void;
  triggerId: string;
  contentId: string;
  triggerRef: RefObject<HTMLButtonElement | null>;
}

const PopoverContext = createContext<PopoverState | null>(null);

/**
 * A non-modal overlay. It does not trap focus. Escape closes it and moves
 * focus back to the trigger. A pointer press outside of it closes it.
 * `open` is writable, so a `{ path }` binding keeps the open state in the
 * data model.
 */
function Popover(props: PopoverProps) {
  useFeedbackStyles();
  const { setOpen } = props;
  const open = props.open ?? false;
  const id = useId();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const root = rootRef.current;
      const isOutside =
        root !== null &&
        event.target instanceof Node &&
        !root.contains(event.target);
      if (isOutside) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, setOpen]);
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape" || !open) return;
    // Escape closes only the topmost overlay.
    event.stopPropagation();
    setOpen(false);
    triggerRef.current?.focus();
  };
  return (
    <PopoverContext.Provider
      value={{
        open,
        setOpen,
        triggerId: `${id}-trigger`,
        contentId: `${id}-content`,
        triggerRef,
      }}
    >
      <div
        ref={rootRef}
        data-a2ui-std=""
        onKeyDown={onKeyDown}
        onMouseEnter={props.showOnHover ? () => setOpen(true) : undefined}
        onMouseLeave={props.showOnHover ? () => setOpen(false) : undefined}
        style={{ position: "relative", display: "inline-flex" }}
      >
        {props.children}
      </div>
    </PopoverContext.Provider>
  );
}

function PopoverTrigger(props: { children?: ReactNode }) {
  useFeedbackStyles();
  const popover = useContext(PopoverContext);
  if (!popover) return <>{props.children}</>;
  return (
    <button
      ref={popover.triggerRef}
      type="button"
      id={popover.triggerId}
      aria-haspopup="dialog"
      aria-expanded={popover.open}
      aria-controls={popover.open ? popover.contentId : undefined}
      data-a2ui-std=""
      data-a2ui-feedback-button=""
      onClick={() => popover.setOpen(!popover.open)}
      style={{
        ...BUTTON_RESET,
        display: "inline-flex",
        alignItems: "center",
        minWidth: 24,
        minHeight: 24,
        borderRadius: radius("xs"),
      }}
    >
      {props.children}
    </button>
  );
}

type Side = NonNullable<PopoverContentProps["side"]>;
type Align = NonNullable<PopoverContentProps["align"]>;

const SIDE_STYLE: Record<Side, CSSProperties> = {
  bottom: { top: "100%", marginTop: 6 },
  top: { bottom: "100%", marginBottom: 6 },
  left: { right: "100%", marginRight: 6 },
  right: { left: "100%", marginLeft: 6 },
};

/** Where the content sits along the side of the trigger. */
function alignStyle(side: Side, align: Align) {
  const isVertical = side === "top" || side === "bottom";
  switch (align) {
    case "start":
      return isVertical ? { left: 0 } : { top: 0 };
    case "end":
      return isVertical ? { right: 0 } : { bottom: 0 };
    case "center":
      return isVertical
        ? { left: "50%", transform: "translateX(-50%)" }
        : { top: "50%", transform: "translateY(-50%)" };
  }
}

const PANEL_STYLE: CSSProperties = {
  zIndex: 50,
  minWidth: 160,
  boxSizing: "border-box",
  display: "flex",
  flexDirection: "column",
  gap: spacing(2),
  padding: spacing(3),
  background: backgroundColor("surface-elevated"),
  border: `1px solid ${borderColor("default")}`,
  borderRadius: radius("lg"),
  boxShadow: SHADOW_MD,
};

/**
 * The body of a Popover, shown only when the Popover is open. Outside of a
 * Popover, it is a plain panel that always shows.
 */
function PopoverContent(props: PopoverContentProps) {
  useFeedbackStyles();
  const popover = useContext(PopoverContext);
  if (!popover) {
    return (
      <div
        data-a2ui-std=""
        style={{
          ...PANEL_STYLE,
          position: "relative",
          width: spacing(props.width),
        }}
      >
        {props.children}
      </div>
    );
  }
  if (!popover.open) return null;
  const side = props.side ?? "bottom";
  return (
    <div
      role="dialog"
      id={popover.contentId}
      aria-labelledby={popover.triggerId}
      data-a2ui-std=""
      style={{
        ...PANEL_STYLE,
        position: "absolute",
        ...SIDE_STYLE[side],
        ...alignStyle(side, props.align ?? "center"),
        width: spacing(props.width),
      }}
    >
      {props.children}
    </div>
  );
}

/**
 * The standard feedback components: loading states, a pulse dot, a
 * confetti burst, a flashcard and a popover. Give them to
 * `createGenerativeUI({ components: { ...feedbackComponents } })`.
 *
 * Celebration, Popover, PopoverTrigger and PopoverContent have a
 * "multiple" `children` slot. Popover `open` is writable, so the component
 * gets a `setOpen` prop.
 */
export const feedbackComponents = {
  Loading: {
    component: Loading,
    description:
      'A spinner with a text label. Use it while a result is not ready. The default label is "Loading".',
    props: loadingSchema,
  },
  LoadingIndicator: {
    component: LoadingIndicator,
    description:
      "A small spinner without visible text. Use it inside a Row or a Button where a label is already present.",
    props: loadingIndicatorSchema,
  },
  LoadingBlock: {
    component: LoadingBlock,
    description:
      "A shimmering placeholder block. Use it where content will show after it loads.",
    props: loadingBlockSchema,
  },
  PulseIndicator: {
    component: PulseIndicator,
    description:
      'A small dot that pulses, for example next to the text "Live". Set label when no text next to the dot says what it means.',
    props: pulseIndicatorSchema,
  },
  Celebration: {
    component: Celebration,
    description:
      "Shows its children and plays a confetti burst over them when it appears. Set trigger to a new value to play the burst again.",
    props: celebrationSchema,
    slots: CHILDREN_SLOT,
  },
  FlashcardFlip: {
    component: FlashcardFlip,
    description:
      "A card that shows the front text. A click or the Enter key flips it to the back text, and again to the front.",
    props: flashcardSchema,
  },
  Popover: {
    component: Popover,
    description:
      "A small overlay next to a trigger. Put exactly two children in it: one PopoverTrigger, then one PopoverContent. A click on the trigger opens and closes the content. Escape or a click outside closes it.",
    props: popoverSchema,
    slots: CHILDREN_SLOT,
    writable: ["open"] as const,
  },
  PopoverTrigger: {
    component: PopoverTrigger,
    description:
      "The trigger of a Popover. Its children are the label of the trigger: a Text or an Icon. Do not put a Button in it, because the trigger is already a button.",
    props: z.object({}),
    slots: CHILDREN_SLOT,
  },
  PopoverContent: {
    component: PopoverContent,
    description:
      "The body of a Popover. It shows only when the Popover is open.",
    props: popoverContentSchema,
    slots: CHILDREN_SLOT,
  },
};
