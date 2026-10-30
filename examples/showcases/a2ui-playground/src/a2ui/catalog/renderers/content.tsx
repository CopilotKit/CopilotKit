"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { highlight } from "sugar-high";
import { Check, Copy, Quote as QuoteIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RendererMap } from "./types";

const TEXT: Record<string, string> = {
  h1: "text-[24px] font-semibold leading-tight tracking-tight",
  h2: "text-[19px] font-semibold leading-snug tracking-tight",
  h3: "text-[15.5px] font-semibold leading-snug tracking-tight",
  h4: "text-[14px] font-semibold",
  h5: "text-[12.5px] font-semibold uppercase tracking-wide text-muted-foreground",
  body: "text-[13.5px] leading-relaxed text-foreground/90",
  caption: "text-[11.5px] leading-snug text-muted-foreground",
};
const TONE: Record<string, string> = {
  muted: "text-muted-foreground",
  accent: "text-[var(--a2-accent)]",
  positive: "text-[var(--a2-positive)]",
  negative: "text-[var(--a2-negative)]",
};

function youtubeId(url: string) {
  const m = url.match(/(?:youtu\.be\/|v=|embed\/|shorts\/)([\w-]{11})/);
  return m?.[1];
}
function vimeoId(url: string) {
  return url.match(/vimeo\.com\/(?:video\/)?(\d+)/)?.[1];
}

/**
 * transitions.dev streaming text: words fade in --stream-gap apart. When the text grows
 * in place (a streamed update), only the new words animate.
 */
export function StreamWords({ text }: { text?: string }) {
  const words = useMemo(
    () => (text ?? "").split(/(\s+)/).filter((w) => w.length),
    [text],
  );
  const [shown, setShown] = useState(0);
  const base = useRef(0);
  useEffect(() => {
    if (words.length === shown) return;
    base.current = Math.min(shown, words.length);
    const raf = requestAnimationFrame(() => setShown(words.length));
    return () => cancelAnimationFrame(raf);
  }, [words.length, shown]);
  return (
    <>
      {words.map((w, i) =>
        /^\s+$/.test(w) ? (
          w
        ) : (
          <span
            key={i}
            className={cn("t-stream-w", i < shown && "is-in")}
            style={
              {
                "--i": Math.min(Math.max(0, i - base.current) >> 1, 24),
              } as React.CSSProperties
            }
          >
            {w}
          </span>
        ),
      )}
    </>
  );
}

export const contentRenderers: RendererMap<
  "Heading" | "CodeBlock" | "Quote" | "ImageGallery" | "VideoEmbed" | "Kbd"
> = {
  Heading: ({ props }) => {
    const level = props.level ?? "2";
    return (
      <header className="flex min-w-0 flex-col gap-1">
        {/* The eyebrow follows the title on its line: context, not a kicker above it. */}
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
          <h2
            className={cn(
              "font-semibold tracking-tight text-balance",
              level === "1"
                ? "text-[24px] leading-tight"
                : level === "3"
                  ? "text-[15.5px]"
                  : "text-[19px] leading-snug",
            )}
          >
            <StreamWords text={props.text} />
          </h2>
          {props.eyebrow ? (
            <span className="a2-label">{props.eyebrow}</span>
          ) : null}
        </div>
        {props.subtitle ? (
          <p className="text-[13px] leading-relaxed text-muted-foreground text-pretty">
            <StreamWords text={props.subtitle} />
          </p>
        ) : null}
      </header>
    );
  },

  CodeBlock: ({ props }) => {
    const [copied, setCopied] = useState(false);
    const html = useMemo(() => highlight(props.code ?? ""), [props.code]);
    return (
      <figure className="a2-card a2-enter w-full min-w-0 overflow-hidden">
        <figcaption className="flex items-center justify-between border-b border-[var(--a2-line)] px-3.5 py-2">
          <span className="flex items-center gap-2 font-mono text-[11px] text-muted-foreground">
            <span className="flex gap-1">
              <span className="size-2 rounded-full bg-white/15" />
              <span className="size-2 rounded-full bg-white/15" />
              <span className="size-2 rounded-full bg-white/15" />
            </span>
            {props.filename ?? props.language ?? "code"}
          </span>
          <button
            onClick={() => {
              void navigator.clipboard?.writeText(props.code ?? "");
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            }}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-muted-foreground transition hover:bg-white/5 hover:text-foreground"
          >
            {copied ? (
              <Check className="size-3" />
            ) : (
              <Copy className="size-3" />
            )}
            {copied ? "Copied" : "Copy"}
          </button>
        </figcaption>
        <pre className="a2-code overflow-x-auto px-4 py-3 font-mono text-[12.5px] leading-[1.65]">
          <code dangerouslySetInnerHTML={{ __html: html }} />
        </pre>
      </figure>
    );
  },

  Quote: ({ props }) => (
    <figure className="a2-enter relative w-full min-w-0 overflow-hidden rounded-[var(--a2-radius)] border border-[var(--a2-line)] bg-gradient-to-br from-violet-500/[0.07] to-transparent px-5 py-4">
      <QuoteIcon className="absolute right-4 top-3 size-8 text-violet-300/15" />
      <blockquote className="text-[15px] font-medium leading-relaxed tracking-tight text-pretty">
        {props.text}
      </blockquote>
      {props.author ? (
        <figcaption className="mt-3 text-[12px] text-muted-foreground">
          <span className="font-medium text-foreground/90">{props.author}</span>
          {props.role ? <span>, {props.role}</span> : null}
        </figcaption>
      ) : null}
    </figure>
  ),

  ImageGallery: ({ props }) => {
    const images = Array.isArray(props.images) ? props.images : [];
    const cols = Math.min(4, Math.max(2, props.columns ?? 3));
    return (
      <div
        className="a2-enter grid w-full min-w-0 gap-2"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {images.map((img, i) => (
          <figure
            key={i}
            className={cn(
              "group relative overflow-hidden rounded-[12px] border border-[var(--a2-line)] bg-white/[0.03]",
              i === 0 &&
                images.length > 3 &&
                (images.length + 3) % cols === 0 &&
                "col-span-2 row-span-2",
            )}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={img.url}
              alt={img.caption ?? ""}
              className="aspect-square size-full object-cover transition duration-500 group-hover:scale-[1.03]"
            />
            {img.caption ? (
              <figcaption className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/80 to-transparent px-2.5 pb-2 pt-6 text-[11px] font-medium text-white/90">
                {img.caption}
              </figcaption>
            ) : null}
          </figure>
        ))}
      </div>
    );
  },

  VideoEmbed: ({ props }) => {
    const yt = youtubeId(props.url ?? "");
    const vm = vimeoId(props.url ?? "");
    const src = yt
      ? `https://www.youtube-nocookie.com/embed/${yt}`
      : vm
        ? `https://player.vimeo.com/video/${vm}`
        : null;
    return (
      <figure className="a2-enter flex w-full min-w-0 flex-col gap-1.5">
        <div className="aspect-video w-full overflow-hidden rounded-[12px] border border-[var(--a2-line)] bg-black">
          {src ? (
            <iframe
              src={src}
              title={props.title ?? "Video"}
              className="size-full"
              allow="accelerometer; encrypted-media; picture-in-picture"
              allowFullScreen
              loading="lazy"
            />
          ) : (
            <div className="grid size-full place-items-center text-[12px] text-muted-foreground">
              Unsupported video URL
            </div>
          )}
        </div>
        {props.title ? (
          <figcaption className="text-[12px] text-muted-foreground">
            {props.title}
          </figcaption>
        ) : null}
      </figure>
    );
  },

  Kbd: ({ props }) => (
    <div className="inline-flex items-center gap-2 text-[12.5px]">
      <span className="inline-flex items-center gap-1">
        {(props.keys ?? []).map((k, i) => (
          <kbd
            key={i}
            className="min-w-6 rounded-md border border-b-2 border-white/15 bg-white/[0.06] px-1.5 py-0.5 text-center font-mono text-[11px] font-medium text-foreground/90"
          >
            {k}
          </kbd>
        ))}
      </span>
      {props.label ? (
        <span className="text-muted-foreground">{props.label}</span>
      ) : null}
    </div>
  ),
};
