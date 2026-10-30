"use client";

import type { CSSProperties, ReactNode } from "react";
import {
  Badge as KumoBadge,
  Button as KumoButton,
  Grid as KumoGrid,
  LayerCard,
  Link as KumoLink,
  LinkButton,
  Popover as KumoPopover,
  Text as KumoText,
} from "@cloudflare/kumo";
import { useGenerativeUIAccessibility } from "@copilotkit/react-core/v2/generative-ui";
import { usePhosphorIcon } from "./icons";
import { VISUALLY_HIDDEN, safeHref } from "./inline-markdown";
import { gapOf } from "./layout";
import { defined, sizeOf } from "./style";
import { badgeVariantOf } from "./text";
import { standardComponent } from "./types";
import type { StandardProps } from "./types";

/** The host of a URL without "www.", or `undefined`. */
function hostOf(url: string | undefined) {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

/** The favicon of a host, from the service the standard LinkCard uses. */
function FaviconImage({ host }: { host: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a 16px favicon
    <img
      src={`https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`}
      alt=""
      width={16}
      height={16}
      style={{ display: "block", borderRadius: 3, flex: "none" }}
    />
  );
}

const CLAMP = (lines: number): CSSProperties => ({
  display: "-webkit-box",
  WebkitLineClamp: lines,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
});

const StandardImage = standardComponent("Image");
const StandardFollowUp = standardComponent("FollowUp");

// ---- LinkCard ----

/**
 * LinkCard: a Kumo LayerCard with the favicon, domain, title, description
 * and thumbnail. A click opens the link in a new tab, or sends onClick
 * when it is bound.
 */
export function LinkCard(props: StandardProps<"LinkCard">) {
  const aria = useGenerativeUIAccessibility();
  const href = safeHref(props.href);
  const host = props.domain ?? hostOf(props.href);
  const body = (
    <LayerCard
      style={{
        display: "flex",
        gap: "12px",
        alignItems: "center",
        padding: "12px",
        width: "100%",
        textAlign: "start",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "4px",
          flex: 1,
          minWidth: 0,
        }}
      >
        {host ? (
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            {props.favicon !== false ? <FaviconImage host={host} /> : null}
            <KumoText variant="secondary" size="xs" as="span">
              {host}
            </KumoText>
          </div>
        ) : null}
        <KumoText bold as="span" DANGEROUS_style={CLAMP(2)}>
          {props.title}
        </KumoText>
        {props.description ? (
          <KumoText
            variant="secondary"
            size="sm"
            as="span"
            DANGEROUS_style={CLAMP(2)}
          >
            {props.description}
          </KumoText>
        ) : null}
      </div>
      {props.image ? (
        <div style={{ width: "72px", flex: "none" }}>
          <StandardImage
            url={props.image}
            description=""
            aspectRatio="1 / 1"
            radius="md"
          />
        </div>
      ) : null}
    </LayerCard>
  );
  const resetStyle: CSSProperties = {
    display: "block",
    width: "100%",
    padding: 0,
    border: 0,
    background: "none",
    color: "inherit",
    textDecoration: "none",
    cursor: "pointer",
    font: "inherit",
  };
  if (props.onClick) {
    return (
      <button
        {...aria}
        type="button"
        style={resetStyle}
        onClick={(event) => {
          event.stopPropagation();
          void props.onClick?.({});
        }}
      >
        {body}
      </button>
    );
  }
  if (!href) return <div {...aria}>{body}</div>;
  return (
    <a
      {...aria}
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      style={resetStyle}
    >
      {body}
      <span style={VISUALLY_HIDDEN}> (opens in a new tab)</span>
    </a>
  );
}

// ---- Citation ----

/**
 * Citation: a Kumo Badge marker that opens a Kumo Popover with the source
 * title, the quoted passage and a Kumo link.
 */
export function Citation(props: StandardProps<"Citation">) {
  const href = props.url ? safeHref(props.url) : undefined;
  const source = props.source ?? hostOf(props.url);
  const marker = props.label ?? String(props.index ?? 1);
  return (
    <KumoPopover.Root>
      <KumoPopover.Trigger
        openOnHover
        delay={150}
        aria-label={`Source ${marker}${props.title ? `: ${props.title}` : ""}`}
        render={
          <button
            type="button"
            style={{
              display: "inline-flex",
              padding: 0,
              border: 0,
              background: "none",
              cursor: "pointer",
              verticalAlign: "baseline",
            }}
          />
        }
      >
        <KumoBadge variant="secondary">{marker}</KumoBadge>
      </KumoPopover.Trigger>
      <KumoPopover.Content side="top">
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "6px",
            maxWidth: "300px",
          }}
        >
          {source ? (
            <KumoText variant="secondary" size="xs" as="span">
              {source}
            </KumoText>
          ) : null}
          {props.title ? (
            <KumoText bold as="span">
              {props.title}
            </KumoText>
          ) : null}
          {props.snippet ? (
            <KumoText
              variant="secondary"
              size="sm"
              as="span"
              DANGEROUS_style={CLAMP(3)}
            >
              {props.snippet}
            </KumoText>
          ) : null}
          {href ? (
            <KumoLink
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              variant="inline"
            >
              Open source
              <KumoLink.ExternalIcon />
            </KumoLink>
          ) : null}
        </div>
      </KumoPopover.Content>
    </KumoPopover.Root>
  );
}

// ---- FollowUp ----

/** FollowUp: secondary Kumo Buttons, one per suggested message. */
export function FollowUp(props: StandardProps<"FollowUp">) {
  const aria = useGenerativeUIAccessibility();
  const ArrowIcon = usePhosphorIcon("arrow-right");
  // Without a bound onFollowUp, the standard FollowUp sends the pill as a
  // follow-up event through the surface it sits in. That surface context is
  // not exported from the package, so only the standard FollowUp can do it.
  if (!props.onFollowUp) return <StandardFollowUp {...props} />;
  const items = (props.items ?? []).map((item) =>
    typeof item === "string"
      ? { label: item, message: item }
      : { label: item.label, message: item.message ?? item.label },
  );
  return (
    <div
      {...aria}
      style={{ display: "flex", flexDirection: "column", gap: "8px" }}
    >
      {props.title ? (
        <KumoText variant="secondary" size="sm" as="span">
          {props.title}
        </KumoText>
      ) : null}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
        {items.map((item) => (
          <KumoButton
            key={item.label}
            type="button"
            variant="secondary"
            size="sm"
            icon={ArrowIcon ? <ArrowIcon size={14} aria-hidden /> : undefined}
            onClick={(event) => {
              event.stopPropagation();
              void props.onFollowUp?.({ message: item.message });
            }}
          >
            {item.label}
          </KumoButton>
        ))}
      </div>
    </div>
  );
}

// ---- EntityCard ----

type ActionVariant = NonNullable<
  NonNullable<StandardProps<"EntityCard">["actions"]>[number]["variant"]
>;

/** The Kumo Button variant of a card action, with the standard default. */
export function entityActionVariantOf(
  variant: ActionVariant | undefined,
  hasHandler: boolean,
): "primary" | "secondary" | "outline" | "ghost" {
  switch (variant ?? (hasHandler ? "outline" : "ghost")) {
    case "solid":
      return "primary";
    case "soft":
      return "secondary";
    case "outline":
      return "outline";
    default:
      return "ghost";
  }
}

/** Five Phosphor stars for a 0 to 5 rating. */
function Stars({ rating, count }: { rating: number; count?: number }) {
  const Star = usePhosphorIcon("star");
  const StarHalf = usePhosphorIcon("star-half");
  const clamped = Math.max(0, Math.min(5, rating));
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
      <span
        role="img"
        aria-label={`Rated ${clamped} out of 5`}
        style={{ display: "inline-flex", color: "var(--color-kumo-warning)" }}
      >
        {[0, 1, 2, 3, 4].map((index) => {
          const fill = clamped - index;
          const Icon = fill > 0 && fill < 1 ? StarHalf : Star;
          return Icon ? (
            <Icon
              key={index}
              size={14}
              weight={fill >= 0.5 ? "fill" : "regular"}
              aria-hidden
            />
          ) : null;
        })}
      </span>
      <KumoText variant="secondary" size="xs" as="span">
        {clamped.toFixed(1)}
      </KumoText>
      {count !== undefined ? (
        <KumoText variant="secondary" size="xs" as="span">
          ({count})
        </KumoText>
      ) : null}
    </div>
  );
}

/**
 * EntityCard: a Kumo LayerCard with an image, the name, facts, a Kumo
 * Badge, stars and up to three Kumo actions.
 */
export function EntityCard(props: StandardProps<"EntityCard">) {
  const aria = useGenerativeUIAccessibility();
  const href = props.href ? safeHref(props.href) : undefined;
  const isHorizontal = props.layout === "horizontal";
  const isClickable = Boolean(props.onClick || href);
  const open = () => {
    if (props.onClick) void props.onClick({});
    else if (href) window.open(href, "_blank", "noopener,noreferrer");
  };
  const actions = props.actions ?? [];
  let image: ReactNode = null;
  if (props.image) {
    image = (
      <div style={{ width: isHorizontal ? "40%" : "100%", flex: "none" }}>
        <StandardImage
          url={props.image}
          description=""
          aspectRatio={props.imageAspectRatio ?? "4 / 3"}
          radius="md"
        />
      </div>
    );
  }
  return (
    <LayerCard
      {...aria}
      style={defined({
        display: "flex",
        flexDirection: isHorizontal ? "row" : "column",
        gap: "12px",
        padding: "12px",
        width: sizeOf(props.width),
        cursor: isClickable ? "pointer" : undefined,
      })}
      role={isClickable ? "link" : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onClick={isClickable ? open : undefined}
      onKeyDown={
        isClickable
          ? (event) => {
              // Only the card itself: Enter on an action button is the
              // button's own.
              const isOwnKey = event.target === event.currentTarget;
              if (isOwnKey && (event.key === "Enter" || event.key === " ")) {
                event.preventDefault();
                open();
              }
            }
          : undefined
      }
    >
      {image}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "6px",
          flex: 1,
          minWidth: 0,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: "8px",
          }}
        >
          <KumoText bold as="span">
            {props.title}
          </KumoText>
          {props.badge ? (
            <KumoBadge variant={badgeVariantOf(props.badge.color, "soft")}>
              {props.badge.label}
            </KumoBadge>
          ) : null}
        </div>
        {props.subtitle ? (
          <KumoText variant="secondary" size="sm" as="span">
            {props.subtitle}
          </KumoText>
        ) : null}
        {props.rating !== undefined ? (
          <Stars rating={props.rating} count={props.ratingCount} />
        ) : null}
        {props.description ? (
          <KumoText size="sm" as="span" DANGEROUS_style={CLAMP(3)}>
            {props.description}
          </KumoText>
        ) : null}
        {props.meta ? (
          <KumoText variant="secondary" size="sm" as="span">
            {props.meta}
          </KumoText>
        ) : null}
        {actions.length > 0 ? (
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: "8px",
              marginTop: "4px",
            }}
          >
            {actions.map((action) => {
              const actionHref = action.href
                ? safeHref(action.href)
                : undefined;
              const variant = entityActionVariantOf(
                action.variant,
                Boolean(actionHref || props.onAction),
              );
              return actionHref ? (
                <LinkButton
                  key={action.label}
                  href={actionHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  variant={variant}
                  size="sm"
                  onClick={(event) => event.stopPropagation()}
                >
                  {action.label}
                </LinkButton>
              ) : (
                <KumoButton
                  key={action.label}
                  type="button"
                  variant={variant}
                  size="sm"
                  onClick={(event) => {
                    event.stopPropagation();
                    void props.onAction?.({ label: action.label });
                  }}
                >
                  {action.label}
                </KumoButton>
              );
            })}
          </div>
        ) : null}
      </div>
    </LayerCard>
  );
}

// ---- ImageGrid ----

/**
 * ImageGrid: a Kumo Grid of standard Images (Kumo has no image component).
 * "bento" makes the first image twice as large.
 */
export function ImageGrid(props: StandardProps<"ImageGrid">) {
  const aria = useGenerativeUIAccessibility();
  const columns = Math.max(1, Math.floor(props.columns ?? 3));
  const images = props.images ?? [];
  const numericGap = typeof props.gap === "number" ? props.gap : undefined;
  return (
    <KumoGrid
      {...aria}
      gap={gapOf(numericGap ?? 2)}
      style={defined({
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gap: typeof props.gap === "string" ? props.gap : undefined,
      })}
    >
      {images.map((image, index) => {
        const isFeature =
          props.layout === "bento" && index === 0 && columns > 1;
        const href = image.href ? safeHref(image.href) : undefined;
        const picture = (
          <StandardImage
            url={image.url}
            description={image.description ?? image.caption ?? ""}
            aspectRatio={isFeature ? undefined : (props.aspectRatio ?? "1 / 1")}
            height={isFeature ? "100%" : undefined}
            radius="md"
            lightbox={!href}
          />
        );
        return (
          <div
            key={`${image.url}-${index}`}
            style={defined({
              display: "flex",
              flexDirection: "column",
              gap: "4px",
              minWidth: 0,
              gridColumn: isFeature ? "span 2" : undefined,
              gridRow: isFeature ? "span 2" : undefined,
            })}
          >
            {href ? (
              <a href={href} target="_blank" rel="noopener noreferrer">
                {picture}
              </a>
            ) : (
              picture
            )}
            {image.caption ? (
              <KumoText variant="secondary" size="xs" as="span">
                {image.caption}
              </KumoText>
            ) : null}
          </div>
        );
      })}
    </KumoGrid>
  );
}

export const compositeOverrides = {
  LinkCard: { component: LinkCard },
  Citation: { component: Citation },
  FollowUp: { component: FollowUp },
  EntityCard: { component: EntityCard },
  ImageGrid: { component: ImageGrid },
};
