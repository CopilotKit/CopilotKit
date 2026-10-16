import React, { useEffect, useRef, useState } from "react";
import type {
  CatalogRenderers,
  RendererProps,
} from "../../../../create-catalog";
import type {
  compositeDefinitions,
  CardAction,
  FollowUpItem,
  GridImage,
} from "../definitions/composites";
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
} from "../tokens";
import { ACCENT, useStandardStyles } from "../styles";
import { safeHref } from "../inline-markdown";
import { Lightbox, hostOf, LucideIcon } from "./media";

const str = (v: unknown) => (v === undefined || v === null ? "" : String(v));

/** Open a URL in a new tab the way the Link component does. */
export function openUrl(href: string | undefined): void {
  const safe = safeHref(href);
  if (!safe || typeof window === "undefined") return;
  window.open(safe, "_blank", "noopener,noreferrer");
}

function FaviconImg({ host, size = 16 }: { host: string; size?: number }) {
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

// ─── LinkCard ─────────────────────────────────────────────────────────

function LinkCard({ props }: RendererProps<any>) {
  useStandardStyles();
  const href = safeHref(str(props.href));
  const host = href ? hostOf(href) : undefined;
  const domain = str(props.domain) || host || "";
  const image = str(props.image);
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
              <FaviconImg host={host} />
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
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {str(props.title)}
        </span>
        {props.description ? (
          <span
            style={{
              ...textFont("sm"),
              color: textColor("secondary"),
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {str(props.description)}
          </span>
        ) : null}
      </span>
      {image ? (
        <img
          src={image}
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
  const style: React.CSSProperties = {
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
  if (typeof props.action === "function") {
    return (
      <button
        type="button"
        data-a2ui-link-card=""
        onClick={(e) => {
          e.stopPropagation();
          props.action();
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

// ─── Citation ─────────────────────────────────────────────────────────

function Citation({ props }: RendererProps<any>) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);
  const url = safeHref(str(props.url));
  const host = url ? hostOf(url) : undefined;
  const source = str(props.source) || host || "";
  const marker = str(props.label) || String(props.index ?? 1);
  return (
    <span
      ref={rootRef}
      data-a2ui-citation=""
      style={{
        position: "relative",
        display: "inline-flex",
        verticalAlign: "baseline",
      }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-label={`Source ${marker}`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(!open);
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
      {open ? (
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
            verticalAlign: "baseline",
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
              {host ? <FaviconImg host={host} /> : null}
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
              {str(props.title)}
            </span>
          ) : null}
          {props.snippet ? (
            <span style={{ ...textFont("sm"), color: textColor("secondary") }}>
              {str(props.snippet)}
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

// ─── FollowUp ─────────────────────────────────────────────────────────

function FollowUp({ props, dispatch }: RendererProps<any>) {
  const items: FollowUpItem[] = Array.isArray(props.items) ? props.items : [];
  if (items.length === 0) return null;
  return (
    <div
      data-a2ui-follow-up=""
      style={{ display: "flex", flexDirection: "column", gap: spacing(2) }}
    >
      {props.title ? (
        <span style={{ ...textFont("sm"), color: textColor("secondary") }}>
          {str(props.title)}
        </span>
      ) : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: spacing(2) }}>
        {items.map((item, i) => {
          const entry = typeof item === "string" ? { label: item } : item;
          const message = entry.message ?? entry.label;
          return (
            <button
              key={`${entry.label}-${i}`}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                dispatch?.({
                  event: { name: "follow_up", context: { message } },
                });
              }}
              style={{
                font: "inherit",
                ...textFont("sm"),
                fontWeight: FONT_WEIGHT.medium,
                padding: "6px 12px",
                borderRadius: 9999,
                border: `1px solid ${borderColor("default")}`,
                background: backgroundColor("surface"),
                color: textColor("default"),
                cursor: "pointer",
                textAlign: "start",
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

// ─── EntityCard ───────────────────────────────────────────────────────

function Stars({ value, count }: { value: number; count?: number }) {
  const v = Math.max(0, Math.min(5, value));
  return (
    <span
      aria-label={`${v} out of 5`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        ...textFont("sm"),
        color: textColor("secondary"),
      }}
    >
      <span
        aria-hidden
        style={{ color: "var(--a2ui-color-rating, #f5a524)", letterSpacing: 1 }}
      >
        {"★".repeat(Math.round(v))}
        <span style={{ color: borderColor("strong") }}>
          {"★".repeat(5 - Math.round(v))}
        </span>
      </span>
      <span>{v.toFixed(1)}</span>
      {count != null ? <span>({count})</span> : null}
    </span>
  );
}

function CardButton({
  item,
  dispatch,
}: {
  item: CardAction;
  dispatch?: (a: unknown) => void;
}) {
  const variant =
    item.variant ?? (item.href || item.action ? "outline" : "ghost");
  const solid = variant === "solid";
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        if (item.href) openUrl(item.href);
        // The binder may hand nested actions over as ready-made dispatchers.
        else if (typeof item.action === "function")
          (item.action as () => void)();
        else if (item.action) dispatch?.(item.action);
      }}
      style={{
        font: "inherit",
        ...textFont("sm"),
        fontWeight: FONT_WEIGHT.medium,
        padding: "6px 12px",
        borderRadius: 9999,
        border:
          variant === "outline"
            ? `1px solid ${borderColor("default")}`
            : "1px solid transparent",
        background: solid
          ? ACCENT
          : variant === "soft"
            ? backgroundColor("surface-secondary")
            : "transparent",
        color: solid ? ON_ACCENT : textColor("default"),
        cursor: "pointer",
      }}
    >
      {item.label}
    </button>
  );
}

function EntityCard({ props, dispatch }: RendererProps<any>) {
  useStandardStyles();
  const horizontal = props.layout === "horizontal";
  const image = str(props.image);
  const href = safeHref(str(props.href));
  const clickable = !!href || typeof props.action === "function";
  const onClick = clickable
    ? (e: React.MouseEvent) => {
        e.stopPropagation();
        if (typeof props.action === "function") props.action();
        else openUrl(href);
      }
    : undefined;
  const actions: CardAction[] = Array.isArray(props.actions)
    ? props.actions.slice(0, 3)
    : [];
  return (
    <div
      data-a2ui-entity-card=""
      role={clickable ? "link" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        clickable
          ? (e) => {
              if (
                e.target === e.currentTarget &&
                (e.key === "Enter" || e.key === " ")
              ) {
                e.preventDefault();
                onClick?.(e as unknown as React.MouseEvent);
              }
            }
          : undefined
      }
      style={{
        display: "flex",
        flexDirection: horizontal ? "row" : "column",
        gap: horizontal ? spacing(3) : 0,
        width: spacing(props.width) ?? "100%",
        maxWidth: "100%",
        minWidth: 0,
        boxSizing: "border-box",
        border: `1px solid ${borderColor("default")}`,
        borderRadius: radius("xl"),
        background: backgroundColor("surface"),
        overflow: "hidden",
        cursor: clickable ? "pointer" : undefined,
      }}
    >
      {image ? (
        <img
          src={image}
          alt={str(props.title)}
          loading="lazy"
          style={{
            display: "block",
            objectFit: "cover",
            width: horizontal ? 120 : "100%",
            aspectRatio: horizontal
              ? "1 / 1"
              : (props.imageAspectRatio ?? "4 / 3"),
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
        {props.badge?.label || props.subtitle ? (
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
                {str(props.subtitle)}
              </span>
            ) : null}
            {props.badge?.label ? (
              <span
                style={{
                  ...textFont("xs"),
                  fontWeight: FONT_WEIGHT.medium,
                  padding: "1px 8px",
                  borderRadius: 9999,
                  background: backgroundColor(
                    props.badge.color ?? "surface-secondary",
                  ),
                  color: textColor(
                    props.badge.color ? props.badge.color : "default",
                  ),
                  flex: "none",
                }}
              >
                {props.badge.label}
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
          {str(props.title)}
        </span>
        {props.rating != null ? (
          <Stars
            value={Number(props.rating)}
            count={
              props.ratingCount != null ? Number(props.ratingCount) : undefined
            }
          />
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
            {str(props.description)}
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
            {str(props.meta)}
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
            {actions.map((a, i) => (
              <CardButton
                key={`${a.label}-${i}`}
                item={a}
                dispatch={dispatch}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ─── ImageGrid ────────────────────────────────────────────────────────

function ImageGrid({ props }: RendererProps<any>) {
  const images: GridImage[] = Array.isArray(props.images) ? props.images : [];
  const [open, setOpen] = useState<number | null>(null);
  if (images.length === 0) return null;
  const columns = Math.max(1, Math.floor(props.columns ?? 3));
  const bento = props.layout === "bento" && images.length > 1;
  const current = open === null ? null : images[open];
  return (
    <>
      {current ? (
        <Lightbox
          src={current.src}
          alt={current.alt ?? ""}
          onClose={() => setOpen(null)}
        />
      ) : null}
      <div
        data-a2ui-image-grid=""
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          gridAutoFlow: bento ? "dense" : undefined,
          gap: spacing(props.gap ?? 2),
          width: "100%",
        }}
      >
        {images.map((img, i) => (
          <figure
            key={`${img.src}-${i}`}
            style={{
              margin: 0,
              minWidth: 0,
              gridColumn:
                bento && i === 0 ? `span ${Math.min(2, columns)}` : undefined,
              gridRow: bento && i === 0 ? "span 2" : undefined,
              display: "flex",
              flexDirection: "column",
              gap: 4,
            }}
          >
            <img
              src={img.src}
              alt={img.alt ?? ""}
              loading="lazy"
              onClick={() => (img.href ? openUrl(img.href) : setOpen(i))}
              style={{
                display: "block",
                width: "100%",
                height: "100%",
                aspectRatio:
                  bento && i === 0 ? undefined : (props.aspectRatio ?? "1 / 1"),
                objectFit: "cover",
                borderRadius: radius("md"),
                cursor: img.href ? "pointer" : "zoom-in",
              }}
            />
            {img.caption ? (
              <figcaption
                style={{ ...textFont("xs"), color: textColor("secondary") }}
              >
                {img.caption}
              </figcaption>
            ) : null}
          </figure>
        ))}
      </div>
    </>
  );
}

// Re-exported so Button/Pressable can show a copy confirmation icon.
export { LucideIcon };

export const compositeRenderers = {
  LinkCard,
  Citation,
  FollowUp,
  EntityCard,
  ImageGrid,
} satisfies CatalogRenderers<typeof compositeDefinitions>;
