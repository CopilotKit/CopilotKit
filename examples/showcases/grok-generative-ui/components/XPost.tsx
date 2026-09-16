"use client";

import { useState } from "react";
import { avatarUrl, firstLink, formatCount } from "@/lib/discourse";
import type { Post } from "@/lib/discourse";

/**
 * A post rendered the way it looks on X: 40px avatar, name + handle + age on one
 * line, body at 15/20, and the four-action footer.
 *
 * The icons are drawn as plain geometry (speech bubble, recycle arrows, heart,
 * bars) rather than traced from X's own glyph set — we're matching the layout
 * people recognise, not reproducing another company's marks.
 */

const X_DIM = "#71767b";
const X_LINE = "#2f3336";

function Action({
  path,
  value,
  hover,
}: {
  path: React.ReactNode;
  value?: string;
  hover: string;
}) {
  return (
    <span
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        color: X_DIM,
        fontSize: 13,
      }}
      onMouseEnter={(e) => (e.currentTarget.style.color = hover)}
      onMouseLeave={(e) => (e.currentTarget.style.color = X_DIM)}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      >
        {path}
      </svg>
      {value && (
        <span className="mono" style={{ fontSize: 12 }}>
          {value}
        </span>
      )}
    </span>
  );
}

/** Deterministic avatar tint so the same handle always looks the same. */
function tint(handle: string) {
  let h = 0;
  for (let i = 0; i < handle.length; i++)
    h = (h * 31 + handle.charCodeAt(i)) % 360;
  return `hsl(${h} 42% 32%)`;
}

export default function XPost({ post, last }: { post: Post; last: boolean }) {
  // Quoted/reposted results sometimes come back with no display name. Falling
  // back to the handle keeps the card from rendering a nameless header and a
  // blank avatar.
  const name = post.name?.trim() || post.handle;
  const [avatarFailed, setAvatarFailed] = useState(false);
  const link = firstLink(post.text);
  const accent =
    post.stance === "bull"
      ? "var(--bull)"
      : post.stance === "bear"
        ? "var(--bear)"
        : "transparent";

  return (
    <a
      href={post.url}
      target="_blank"
      rel="noreferrer"
      style={{
        position: "relative",
        display: "flex",
        gap: 12,
        padding: "12px 16px 10px",
        borderBottom: last ? "none" : `1px solid ${X_LINE}`,
        textDecoration: "none",
        color: "#e7e9ea",
        transition: "background 120ms ease",
      }}
      onMouseEnter={(e) =>
        (e.currentTarget.style.background = "rgba(255,255,255,0.03)")
      }
      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
    >
      {/* stance marker — ours, not X's */}
      <span
        style={{
          position: "absolute",
          left: 0,
          top: 10,
          bottom: 10,
          width: 2,
          borderRadius: 9999,
          background: accent,
        }}
      />

      <span
        style={{
          position: "relative",
          flexShrink: 0,
          width: 40,
          height: 40,
          borderRadius: "50%",
          overflow: "hidden",
          background: tint(post.handle),
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 16,
          fontWeight: 700,
          color: "#fff",
        }}
      >
        {/* The tile stays underneath as the fallback, so a 404 degrades to a
            tinted initial instead of a broken-image glyph. */}
        {name.charAt(0).toUpperCase()}
        {!avatarFailed && (
          // eslint-disable-next-line @next/next/no-img-element -- remote host, no loader
          <img
            src={avatarUrl(post.handle)}
            alt=""
            width={40}
            height={40}
            loading="lazy"
            onError={() => setAvatarFailed(true)}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
            }}
          />
        )}
      </span>

      <span style={{ minWidth: 0, flex: 1 }}>
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            lineHeight: "20px",
          }}
        >
          <span
            style={{
              fontWeight: 700,
              fontSize: 15,
              color: "#e7e9ea",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: "45%",
            }}
          >
            {name}
          </span>
          {post.verified && (
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="#1d9bf0"
              style={{ flexShrink: 0 }}
              aria-label="Verified account"
            >
              <path d="M12 1.8 14.5 4l3-.3 1 2.9 2.7 1.4-1 2.9 1 2.9-2.7 1.4-1 2.9-3-.3L12 22.2 9.5 20l-3 .3-1-2.9-2.7-1.4 1-2.9-1-2.9L5.5 6.8l1-2.9 3 .3L12 1.8Zm-1.1 13.6 5.6-5.6-1.5-1.5-4.1 4.1-2-2L7.4 12l3.5 3.4Z" />
            </svg>
          )}
          <span
            style={{
              color: X_DIM,
              fontSize: 15,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              minWidth: 0,
            }}
          >
            @{post.handle}
          </span>
          {/* The model does not always return an age. Rendering the separator
              unconditionally leaves a dangling "·" on those cards. */}
          {post.postedAt?.trim() && (
            <>
              <span style={{ color: X_DIM, fontSize: 15, flexShrink: 0 }}>
                ·
              </span>
              <span style={{ color: X_DIM, fontSize: 15, flexShrink: 0 }}>
                {post.postedAt}
              </span>
            </>
          )}
        </span>

        <span
          style={{
            display: "block",
            fontSize: 15,
            lineHeight: "20px",
            margin: "2px 0 10px",
            whiteSpace: "pre-wrap",
          }}
        >
          {post.text}
        </span>

        {/* Link card, built from the URL in the body. X shows a title and image
            here; we only claim the domain, because that is all we actually
            know without fetching the page. */}
        {link && (
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              border: `1px solid ${X_LINE}`,
              borderRadius: 12,
              padding: "9px 12px",
              margin: "0 0 10px",
              maxWidth: 420,
            }}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke={X_DIM}
              strokeWidth="1.9"
            >
              <path d="M10 13.5a4 4 0 0 0 5.7.3l2.6-2.6a4 4 0 0 0-5.7-5.7l-1.5 1.5" />
              <path d="M14 10.5a4 4 0 0 0-5.7-.3l-2.6 2.6a4 4 0 0 0 5.7 5.7l1.5-1.5" />
            </svg>
            <span
              className="mono"
              style={{
                fontSize: 12,
                color: X_DIM,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {link.domain}
            </span>
          </span>
        )}

        <span
          style={{
            display: "flex",
            gap: 0,
            justifyContent: "space-between",
            maxWidth: 420,
          }}
        >
          <Action
            hover="#1d9bf0"
            value={post.replies ? formatCount(post.replies) : undefined}
            path={
              <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.3-.6L3 21l1.8-4.4A8.3 8.3 0 0 1 3.6 11.5a8.4 8.4 0 0 1 9-8.4 8.4 8.4 0 0 1 8.4 8.4z" />
            }
          />
          <Action
            hover="#00ba7c"
            value={post.reposts ? formatCount(post.reposts) : undefined}
            path={
              <>
                <path d="M17 2.5 20.5 6 17 9.5" />
                <path d="M20.5 6H7a3.5 3.5 0 0 0-3.5 3.5V11" />
                <path d="M7 21.5 3.5 18 7 14.5" />
                <path d="M3.5 18H17a3.5 3.5 0 0 0 3.5-3.5V13" />
              </>
            }
          />
          <Action
            hover="#f91880"
            value={formatCount(post.likes)}
            path={
              <path d="M12 20.5S3.5 15.2 3.5 9.4A4.4 4.4 0 0 1 12 7.3a4.4 4.4 0 0 1 8.5 2.1c0 5.8-8.5 11.1-8.5 11.1z" />
            }
          />
          <Action
            hover="#1d9bf0"
            value={post.views?.trim() || undefined}
            path={
              <>
                <path d="M4 20V13" />
                <path d="M9.3 20V8" />
                <path d="M14.6 20v-9" />
                <path d="M20 20V4" />
              </>
            }
          />
        </span>
      </span>
    </a>
  );
}
