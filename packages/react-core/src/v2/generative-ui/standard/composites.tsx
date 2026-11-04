import React, { useContext, useEffect, useRef, useState } from "react";
import type { CSSProperties, KeyboardEvent, MouseEvent } from "react";
import { z } from "zod";
import type { GenerativeUIInvokeResult } from "../errors";
import {
  GenerativeUINodeContext,
  useGenerativeUIRuntime,
} from "../runtime-context";
import { sizeValue } from "./layout";
import { Lightbox, openUrl } from "./lightbox";
import { safeHref } from "./markdown";
import { LucideIcon, hostOf } from "./media";
import { ACCENT, useStandardStyles } from "./styles";
import {
  FONT_WEIGHT,
  ON_ACCENT,
  SHADOW_MD,
  backgroundColor,
  borderColor,
  radius,
  spacing,
  textColor,
  textFont,
} from "./tokens";

/**
 * The composite components: the prebuilt widgets that sit next to
 * its primitives (LinkCard, Citation, FollowUp pills, entity cards, image
 * grids). Each one is a single component, so the model places it with one
 * object instead of eight primitives.
 */

// ---- Schemas ----

const NO_ARGS = z.object({});
type EventProp<Args = z.input<typeof NO_ARGS>> = (
  args: Args,
) => Promise<GenerativeUIInvokeResult>;

const text = (description: string) =>
  z.string().optional().describe(description);

const linkCardSchema = z.object({
  href: z.string().describe("The URL (http, https)"),
  title: z.string().describe("The page title"),
  description: text("One or two lines"),
  image: text("A thumbnail URL"),
  domain: text("Shown next to the favicon. Default: the host of href"),
  favicon: z.boolean().optional().describe("Default true"),
});
const citationSchema = z.object({
  index: z.number().optional().describe("The marker number. Default 1"),
  label: text("Marker text instead of the number, for example a domain"),
  title: text("The source title"),
  url: text("The source URL (http, https)"),
  snippet: text("The quoted passage, one or two lines"),
  source: text("The publisher or domain. Default: the host of url"),
});
export const followUpItem = z.union([
  z.string(),
  z.object({
    label: z.string(),
    message: text("The text sent when the user clicks. Default: label"),
  }),
]);
const followUpSchema = z.object({
  items: z.array(followUpItem).optional(),
  title: text("A caption above the pills"),
});
const followUpArgs = z.object({
  message: z.string().describe("The message of the clicked pill"),
});
const BADGE_COLORS = [
  "secondary",
  "success",
  "danger",
  "warning",
  "info",
  "discovery",
] as const;
export const cardAction = z.object({
  label: z.string(),
  href: text("Opens this URL in a new tab"),
  variant: z.enum(["solid", "soft", "outline", "ghost"]).optional(),
});
const entityCardSchema = z.object({
  title: z.string().describe("The name"),
  subtitle: text("A second line, for example the brand or category"),
  description: text("Up to three lines"),
  image: text("An image URL"),
  imageAspectRatio: z.string().optional().describe('Default "4 / 3"'),
  meta: text(
    'A short fact line, for example "$29 / month" or "Open until 22:00"',
  ),
  badge: z
    .object({ label: z.string(), color: z.enum(BADGE_COLORS).optional() })
    .optional(),
  rating: z.number().optional().describe("0 to 5, shown as stars"),
  ratingCount: z.number().optional().describe("The number of ratings"),
  href: text("Opens this URL in a new tab when the user clicks the card"),
  actions: z
    .array(cardAction)
    .max(3)
    .optional()
    .describe(
      "Up to three buttons. A button without href sends onAction with its label",
    ),
  layout: z
    .enum(["vertical", "horizontal"])
    .optional()
    .describe('Default "vertical". "horizontal" puts the image on the left'),
  width: sizeValue.optional(),
});
const entityActionArgs = z.object({
  label: z.string().describe("The label of the clicked button"),
});
export const gridImage = z.object({
  url: z.string(),
  description: z.string().optional().describe("What the image shows"),
  caption: z.string().optional(),
  href: text("Opens this URL instead of the full-screen view"),
});
const imageGridSchema = z.object({
  images: z.array(gridImage).optional(),
  columns: z.number().optional().describe("Default 3"),
  aspectRatio: z.string().optional().describe('Default "1 / 1"'),
  gap: sizeValue.optional().describe("Default 2"),
  layout: z
    .enum(["grid", "bento"])
    .optional()
    .describe('Default "grid". "bento" makes the first image twice as large'),
});

type LinkCardProps = z.output<typeof linkCardSchema> & { onClick?: EventProp };
type CitationProps = z.output<typeof citationSchema>;
type FollowUpProps = z.output<typeof followUpSchema> & {
  onFollowUp?: EventProp<z.input<typeof followUpArgs>>;
};
type CardActionItem = z.output<typeof cardAction>;
type EntityCardProps = z.output<typeof entityCardSchema> & {
  onClick?: EventProp;
  onAction?: EventProp<z.input<typeof entityActionArgs>>;
};
type GridImageItem = z.output<typeof gridImage>;
type ImageGridProps = z.output<typeof imageGridSchema>;

// ---- Helpers ----

function FaviconImage({ host, size = 16 }: { host: string; size?: number }) {
  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`}
      alt=""
      width={size}
      height={size}
      style={{ display: "block", borderRadius: 3, flex: "none" }}
    />
  );
}

const CLAMP_TWO: CSSProperties = {
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
};

const PILL_BUTTON: CSSProperties = {
  font: "inherit",
  ...textFont("sm"),
  fontWeight: FONT_WEIGHT.medium,
  padding: "6px 12px",
  borderRadius: 9999,
  cursor: "pointer",
  textAlign: "start",
};

// ---- LinkCard ----

function LinkCard(props: LinkCardProps) {
  useStandardStyles();
  const href = safeHref(props.href);
  const host = href ? hostOf(href) : undefined;
  const domain = props.domain || host || "";
  const body = (
    <>
      <span
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
          minWidth: 0,
          flex: 1,
        }}
      >
        {domain ? (
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              ...textFont("xs"),
              color: textColor("secondary"),
            }}
          >
            {props.favicon !== false && host ? (
              <FaviconImage host={host} />
            ) : null}
            <span
              style={{
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {domain}
            </span>
          </span>
        ) : null}
        <span
          style={{
            ...textFont("md"),
            fontWeight: FONT_WEIGHT.medium,
            color: textColor("default"),
            ...CLAMP_TWO,
          }}
        >
          {props.title}
        </span>
        {props.description ? (
          <span
            style={{
              ...textFont("sm"),
              color: textColor("secondary"),
              ...CLAMP_TWO,
            }}
          >
            {props.description}
          </span>
        ) : null}
      </span>
      {props.image ? (
        <img
          src={props.image}
          alt=""
          loading="lazy"
          style={{
            width: 96,
            height: 96,
            objectFit: "cover",
            borderRadius: radius("md"),
            flex: "none",
          }}
        />
      ) : null}
    </>
  );
  const style: CSSProperties = {
    display: "flex",
    gap: spacing(3),
    alignItems: "flex-start",
    padding: spacing(3),
    border: `1px solid ${borderColor("default")}`,
    borderRadius: radius("xl"),
    background: backgroundColor("surface"),
    color: "inherit",
    textDecoration: "none",
    width: "100%",
    boxSizing: "border-box",
    cursor: "pointer",
    textAlign: "start",
  };
  if (props.onClick) {
    return (
      <button
        type="button"
        data-a2ui-link-card=""
        data-a2ui-input=""
        onClick={(event) => {
          event.stopPropagation();
          void props.onClick?.({});
        }}
        style={{ ...style, font: "inherit" }}
      >
        {body}
      </button>
    );
  }
  return (
    <a
      data-a2ui-link-card=""
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={style}
    >
      {body}
    </a>
  );
}

// ---- Citation ----

function Citation(props: CitationProps) {
  useStandardStyles();
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!isOpen || typeof document === "undefined") return;
    const onDown = (event: globalThis.MouseEvent) => {
      const root = rootRef.current;
      if (root && !root.contains(event.target as Node)) setIsOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [isOpen]);
  const url = props.url ? safeHref(props.url) : undefined;
  const host = url ? hostOf(url) : undefined;
  const source = props.source || host || "";
  const marker = props.label || String(props.index ?? 1);
  return (
    <span
      ref={rootRef}
      data-a2ui-citation=""
      style={{
        position: "relative",
        display: "inline-flex",
        verticalAlign: "baseline",
      }}
      onMouseEnter={() => setIsOpen(true)}
      onMouseLeave={() => setIsOpen(false)}
    >
      <button
        type="button"
        aria-expanded={isOpen}
        aria-label={`Source ${marker}`}
        data-a2ui-input=""
        onClick={(event) => {
          event.stopPropagation();
          setIsOpen(!isOpen);
        }}
        style={{
          font: "inherit",
          fontSize: ".75em",
          lineHeight: 1,
          fontWeight: FONT_WEIGHT.medium,
          padding: "2px 6px",
          margin: "0 2px",
          borderRadius: 9999,
          border: "none",
          background: backgroundColor("surface-secondary"),
          color: textColor("secondary"),
          cursor: "pointer",
          verticalAlign: "super",
        }}
      >
        {marker}
      </button>
      {isOpen ? (
        <span
          role="dialog"
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            zIndex: 50,
            marginTop: 6,
            width: 280,
            display: "flex",
            flexDirection: "column",
            gap: 4,
            padding: spacing(3),
            background: backgroundColor("surface-elevated"),
            border: `1px solid ${borderColor("default")}`,
            borderRadius: radius("lg"),
            boxShadow: SHADOW_MD,
            textAlign: "start",
          }}
        >
          {source ? (
            <span
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                ...textFont("xs"),
                color: textColor("secondary"),
              }}
            >
              {host ? <FaviconImage host={host} /> : null}
              {source}
            </span>
          ) : null}
          {props.title ? (
            <span
              style={{
                ...textFont("sm"),
                fontWeight: FONT_WEIGHT.medium,
                color: textColor("default"),
              }}
            >
              {props.title}
            </span>
          ) : null}
          {props.snippet ? (
            <span style={{ ...textFont("sm"), color: textColor("secondary") }}>
              {props.snippet}
            </span>
          ) : null}
          {url ? (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ ...textFont("xs"), color: textColor("info") }}
            >
              Open source
            </a>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}

// ---- FollowUp ----

/** The event a FollowUp pill sends when the model bound no onFollowUp. */
const FOLLOW_UP_EVENT = "follow_up";

/**
 * A FollowUp always sends. When the model bound `onFollowUp`, that binding
 * runs. Else the pill forwards a `follow_up` event with its message, which
 * the engine turns into a visible user message with that text.
 */
function useFollowUpSend(onFollowUp: FollowUpProps["onFollowUp"]) {
  const runtime = useGenerativeUIRuntime();
  const node = useContext(GenerativeUINodeContext);
  return (message: string) => {
    if (onFollowUp) {
      void onFollowUp({ message });
      return;
    }
    if (!runtime || !node) return;
    const surface = runtime.manager.getSurfaceByKey(node.surfaceKey);
    void runtime.forwardEvent(
      {
        name: FOLLOW_UP_EVENT,
        surfaceId: node.surfaceId,
        componentId: node.componentId,
        userMessage: message,
        context: { message },
      },
      surface?.agentId,
    );
  };
}

function FollowUp(props: FollowUpProps) {
  useStandardStyles();
  const send = useFollowUpSend(props.onFollowUp);
  const items = props.items ?? [];
  if (items.length === 0) return null;
  return (
    <div
      data-a2ui-follow-up=""
      data-a2ui-std=""
      style={{ display: "flex", flexDirection: "column", gap: spacing(2) }}
    >
      {props.title ? (
        <span style={{ ...textFont("sm"), color: textColor("secondary") }}>
          {props.title}
        </span>
      ) : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: spacing(2) }}>
        {items.map((item, index) => {
          const entry = typeof item === "string" ? { label: item } : item;
          const message = entry.message ?? entry.label;
          return (
            <button
              key={`${entry.label}-${index}`}
              type="button"
              data-a2ui-input=""
              onClick={(event) => {
                event.stopPropagation();
                send(message);
              }}
              style={{
                ...PILL_BUTTON,
                border: `1px solid ${borderColor("default")}`,
                background: backgroundColor("surface"),
                color: textColor("default"),
              }}
            >
              {entry.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ---- EntityCard ----

function Stars({ value, count }: { value: number; count?: number }) {
  const clamped = Math.max(0, Math.min(5, value));
  const filled = Math.round(clamped);
  return (
    <span
      aria-label={`${clamped} out of 5`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        ...textFont("sm"),
        color: textColor("secondary"),
      }}
    >
      <span
        aria-hidden="true"
        style={{ color: "var(--a2ui-color-rating, #f5a524)", letterSpacing: 1 }}
      >
        {"★".repeat(filled)}
        <span style={{ color: borderColor("strong") }}>
          {"★".repeat(5 - filled)}
        </span>
      </span>
      <span>{clamped.toFixed(1)}</span>
      {count !== undefined ? <span>({count})</span> : null}
    </span>
  );
}

function CardButton({
  item,
  onAction,
}: {
  item: CardActionItem;
  onAction: EntityCardProps["onAction"];
}) {
  const variant = item.variant ?? (item.href || onAction ? "outline" : "ghost");
  const isSolid = variant === "solid";
  return (
    <button
      type="button"
      data-a2ui-input=""
      onClick={(event) => {
        event.stopPropagation();
        if (item.href) openUrl(item.href);
        else void onAction?.({ label: item.label });
      }}
      style={{
        ...PILL_BUTTON,
        border:
          variant === "outline"
            ? `1px solid ${borderColor("default")}`
            : "1px solid transparent",
        background: isSolid
          ? ACCENT
          : variant === "soft"
            ? backgroundColor("surface-secondary")
            : "transparent",
        color: isSolid ? ON_ACCENT : textColor("default"),
      }}
    >
      {item.label}
    </button>
  );
}

function EntityCard(props: EntityCardProps) {
  useStandardStyles();
  const isHorizontal = props.layout === "horizontal";
  const href = props.href ? safeHref(props.href) : undefined;
  const isClickable = href !== undefined || props.onClick !== undefined;
  const onClick = isClickable
    ? (event: MouseEvent | KeyboardEvent) => {
        event.stopPropagation();
        if (props.onClick) void props.onClick({});
        else openUrl(href);
      }
    : undefined;
  const actions = (props.actions ?? []).slice(0, 3);
  const badge = props.badge;
  return (
    <div
      data-a2ui-entity-card=""
      data-a2ui-std=""
      role={isClickable ? "link" : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        onClick
          ? (event) => {
              const isOwnKey = event.target === event.currentTarget;
              if (isOwnKey && (event.key === "Enter" || event.key === " ")) {
                event.preventDefault();
                onClick(event);
              }
            }
          : undefined
      }
      style={{
        display: "flex",
        flexDirection: isHorizontal ? "row" : "column",
        gap: isHorizontal ? spacing(3) : 0,
        width: spacing(props.width) ?? "100%",
        maxWidth: "100%",
        minWidth: 0,
        boxSizing: "border-box",
        border: `1px solid ${borderColor("default")}`,
        borderRadius: radius("xl"),
        background: backgroundColor("surface"),
        overflow: "hidden",
        // A horizontal card keeps its content height inside a stretched grid
        // row. The vertical card may fill the row.
        alignSelf: isHorizontal ? "start" : undefined,
        cursor: isClickable ? "pointer" : undefined,
      }}
    >
      {props.image ? (
        <img
          src={props.image}
          alt={props.title}
          loading="lazy"
          style={{
            display: "block",
            objectFit: "cover",
            width: isHorizontal ? 120 : "100%",
            aspectRatio: isHorizontal
              ? "1 / 1"
              : (props.imageAspectRatio ?? "4 / 3"),
            alignSelf: isHorizontal ? "start" : undefined,
            flex: "none",
          }}
        />
      ) : null}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
          padding: spacing(3),
          minWidth: 0,
          flex: 1,
        }}
      >
        {badge?.label || props.subtitle ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              minWidth: 0,
            }}
          >
            {props.subtitle ? (
              <span
                style={{
                  ...textFont("xs"),
                  color: textColor("secondary"),
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {props.subtitle}
              </span>
            ) : null}
            {badge?.label ? (
              <span
                style={{
                  ...textFont("xs"),
                  fontWeight: FONT_WEIGHT.medium,
                  padding: "1px 8px",
                  borderRadius: 9999,
                  background: backgroundColor(
                    badge.color ?? "surface-secondary",
                  ),
                  color: textColor(badge.color ?? "default"),
                  flex: "none",
                }}
              >
                {badge.label}
              </span>
            ) : null}
          </div>
        ) : null}
        <span
          style={{
            ...textFont("md"),
            fontWeight: FONT_WEIGHT.medium,
            color: textColor("default"),
          }}
        >
          {props.title}
        </span>
        {props.rating !== undefined ? (
          <Stars value={props.rating} count={props.ratingCount} />
        ) : null}
        {props.description ? (
          <span
            style={{
              ...textFont("sm"),
              color: textColor("secondary"),
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {props.description}
          </span>
        ) : null}
        {props.meta ? (
          <span
            style={{
              ...textFont("sm"),
              fontWeight: FONT_WEIGHT.medium,
              color: textColor("default"),
              marginTop: 2,
            }}
          >
            {props.meta}
          </span>
        ) : null}
        {actions.length > 0 ? (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: spacing(2),
              marginTop: spacing(2),
            }}
          >
            {actions.map((action, index) => (
              <CardButton
                key={`${action.label}-${index}`}
                item={action}
                onAction={props.onAction}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ---- ImageGrid ----

function ImageGrid(props: ImageGridProps) {
  useStandardStyles();
  const images: GridImageItem[] = props.images ?? [];
  const [open, setOpen] = useState<number | null>(null);
  if (images.length === 0) return null;
  const columns = Math.max(1, Math.floor(props.columns ?? 3));
  const isBento = props.layout === "bento" && images.length > 1;
  return (
    <>
      {open !== null ? (
        <Lightbox
          images={images.map((image) => ({
            src: image.url,
            alt: image.description,
          }))}
          index={open}
          onClose={() => setOpen(null)}
        />
      ) : null}
      <div
        data-a2ui-image-grid=""
        data-a2ui-std=""
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          gridAutoFlow: isBento ? "dense" : undefined,
          gap: spacing(props.gap ?? 2),
          width: "100%",
        }}
      >
        {images.map((image, index) => {
          const isLead = isBento && index === 0;
          return (
            <figure
              key={`${image.url}-${index}`}
              style={{
                margin: 0,
                minWidth: 0,
                gridColumn: isLead ? `span ${Math.min(2, columns)}` : undefined,
                gridRow: isLead ? "span 2" : undefined,
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              <img
                src={image.url}
                alt={image.description ?? ""}
                loading="lazy"
                onClick={() =>
                  image.href ? openUrl(image.href) : setOpen(index)
                }
                style={{
                  display: "block",
                  width: "100%",
                  height: "100%",
                  aspectRatio: isLead
                    ? undefined
                    : (props.aspectRatio ?? "1 / 1"),
                  objectFit: "cover",
                  borderRadius: radius("md"),
                  cursor: image.href ? "pointer" : "zoom-in",
                }}
              />
              {image.caption ? (
                <figcaption
                  style={{ ...textFont("xs"), color: textColor("secondary") }}
                >
                  {image.caption}
                </figcaption>
              ) : null}
            </figure>
          );
        })}
      </div>
    </>
  );
}

/**
 * The standard composite components. Give them to
 * `createGenerativeUI({ components: { ...compositeComponents } })`.
 *
 * - LinkCard and EntityCard open `href`, or send `onClick` when it is bound.
 * - FollowUp sends `onFollowUp` with the message of the pill. Unbound, the
 *   engine turns it into a visible user message with that text.
 * - EntityCard buttons without href send `onAction` with their label.
 */
export const compositeComponents = {
  LinkCard: {
    component: LinkCard,
    description:
      "A preview of a URL: favicon and domain, title, description, thumbnail. A click opens it in a new tab, or sends onClick when bound. For sources, articles and products with a page.",
    props: linkCardSchema,
    events: {
      onClick: {
        description: "Sent when the user clicks the card, instead of the link.",
        parameters: NO_ARGS,
      },
    },
  },
  Citation: {
    component: Citation,
    description:
      "An inline source marker ([1]) showing title, snippet and link on hover or click. Put it right after the sentence it supports, as a child of a Text or in a Row.",
    props: citationSchema,
  },
  FollowUp: {
    component: FollowUp,
    description:
      "Suggested next prompts as pills; a click sends the pill's message as the user's next turn, no event needed. At the end of a surface, two to four short items.",
    props: followUpSchema,
    events: {
      onFollowUp: {
        description:
          "Sent when the user clicks a pill. The args carry the message of the pill.",
        parameters: followUpArgs,
      },
    },
  },
  EntityCard: {
    component: EntityCard,
    description:
      "A card for one product, place, person or listing: image, title, subtitle, description, a price or meta line, badge, rating and up to three buttons. href opens a page; onClick is sent when bound. Use a Grid of them for several things.",
    props: entityCardSchema,
    events: {
      onClick: {
        description: "Sent when the user clicks the card and it has no href.",
        parameters: NO_ARGS,
      },
      onAction: {
        description:
          "Sent when the user clicks a button without href. The args carry the label of the button.",
        parameters: entityActionArgs,
      },
    },
  },
  ImageGrid: {
    component: ImageGrid,
    description:
      'A gallery of images in a grid. A click opens the image full-screen, with arrows to the other images. layout "bento" makes the first image twice as large.',
    props: imageGridSchema,
  },
};
