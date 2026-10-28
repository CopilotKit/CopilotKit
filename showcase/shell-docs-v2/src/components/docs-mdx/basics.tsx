// The everyday shell-docs MDX components, on Fumadocs' own: callout aliases,
// steps, frames and media, property references, layout wrappers, and the
// icons content names inline (shell-docs drew most icons as emoji stand-ins;
// here they are the real marks).

import type { ComponentProps, ReactNode } from "react";
import NextLink from "next/link";
import defaultMdxComponents from "fumadocs-ui/mdx";
import { Callout } from "fumadocs-ui/components/callout";
import { Step as FumadocsStep, Steps } from "fumadocs-ui/components/steps";
import { ImageZoom as FumadocsImageZoom } from "fumadocs-ui/components/image-zoom";
import { TypeTable } from "fumadocs-ui/components/type-table";
import * as Lucide from "lucide-react";
import { FaArrowUp, FaCloud, FaGithub, FaServer, FaWrench } from "react-icons/fa";
import { IoLogoNodejs, IoLogoVercel } from "react-icons/io5";
import { PiMonitor } from "react-icons/pi";
import { RiNextjsLine } from "react-icons/ri";
import { SiLangchain, SiNestjs } from "react-icons/si";
import { Badge } from "@/components/ui/badge";
import { Button as UiButton } from "@/components/ui/button";
import { cn } from "@/lib/cn";

type Children = { children?: ReactNode };

// ---------------------------------------------------------------------------
// Callouts. Fumadocs' Callout already takes shell-docs' `warn` / `tip`.
// ---------------------------------------------------------------------------

type CalloutProps = ComponentProps<typeof Callout>;

export const callouts = {
  Callout,
  Note: (props: CalloutProps) => <Callout type="info" {...props} />,
  Info: (props: CalloutProps) => <Callout type="info" {...props} />,
  Tip: (props: CalloutProps) => <Callout type="info" {...props} />,
  Warning: (props: CalloutProps) => <Callout type="warn" {...props} />,
  Caution: (props: CalloutProps) => <Callout type="warn" {...props} />,
};

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

/** A step; shell-docs' optional `title` reads as the step's heading. */
function Step({ title, children }: { title?: string } & Children) {
  return (
    <FumadocsStep>
      {title ? <h4>{title}</h4> : null}
      {children}
    </FumadocsStep>
  );
}

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

/** A framed screenshot or recording, with an optional caption. */
function Frame({
  description,
  className,
  children,
}: { description?: ReactNode; className?: string } & Children) {
  return (
    <figure
      className={cn(
        "not-prose my-6 overflow-hidden rounded-xl border bg-card p-2 [&_img]:my-0 [&_img]:rounded-lg",
        className,
      )}
    >
      {children}
      {description ? (
        <figcaption className="px-1 pt-2 text-sm text-muted-foreground">
          {description}
        </figcaption>
      ) : null}
    </figure>
  );
}

const FumadocsImg = defaultMdxComponents.img;

/**
 * Markdown images arrive sized (Fumadocs measures them), so they take
 * Fumadocs' image. An `<img>` authored in JSX usually has no size, which
 * Next's image can't render, so it stays a plain image, as in shell-docs.
 */
function Img(props: ComponentProps<"img">) {
  const { src, width, height } = props;
  if (typeof src === "object" || (src && width && height)) {
    return (
      <FumadocsImg
        {...(props as ComponentProps<typeof FumadocsImg>)}
        // Remote images (the docs CDN) skip Next's optimizer, as shell-docs'
        // plain images did, so no host has to be allow-listed. (Fumadocs
        // renders next/image here; its prop types are framework-neutral.)
        {...{ unoptimized: typeof src === "string" && /^https?:/.test(src) }}
      />
    );
  }
  // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
  return <img {...props} className={cn("rounded-lg", props.className)} />;
}

/**
 * shell-docs' `<Image>` (content imported it from next/image): a plain
 * image that keeps its className, so `block dark:hidden` /
 * `hidden dark:block` pairs show one diagram per theme.
 */
function Image({
  src,
  alt = "",
  className,
  width,
  height,
}: {
  src?: string;
  alt?: string;
  className?: string;
  width?: number | string;
  height?: number | string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src ?? ""}
      alt={alt}
      width={width}
      height={height}
      className={cn("my-6 max-w-full rounded-lg", className)}
    />
  );
}

/**
 * Fumadocs' zoomable image; content always sizes it, 1000 square by habit.
 * Unoptimized: the sources are CDN GIFs and screenshots.
 */
function ImageZoom({
  width = 1000,
  height = 1000,
  ...props
}: ComponentProps<typeof FumadocsImageZoom>) {
  return (
    <FumadocsImageZoom
      width={width}
      height={height}
      {...{ unoptimized: true }}
      {...props}
      className={cn("h-auto w-full rounded-lg", props.className)}
    />
  );
}

function Video(props: ComponentProps<"video">) {
  return (
    <video {...props} className={cn("my-6 w-full rounded-xl", props.className)} />
  );
}

function YouTubeVideo({ id, title }: { id?: string; title?: string }) {
  if (!id) return null;
  return (
    <iframe
      src={`https://www.youtube.com/embed/${id}`}
      title={title || "YouTube video"}
      className="my-6 aspect-video w-full rounded-xl border-0"
      sandbox="allow-scripts allow-same-origin allow-presentation allow-popups"
      loading="lazy"
      allowFullScreen
    />
  );
}

// ---------------------------------------------------------------------------
// Property references: one Fumadocs type table row each, as in shell-docs.
// ---------------------------------------------------------------------------

function PropertyReference({
  name,
  type,
  required = false,
  deprecated = false,
  cloudOnly = false,
  default: defaultValue,
  children,
}: {
  name: string;
  type: string;
  required?: boolean;
  deprecated?: boolean;
  cloudOnly?: boolean;
  default?: string;
  collapsable?: boolean;
} & Children) {
  return (
    <TypeTable
      type={{
        [name]: {
          type,
          required,
          deprecated,
          default: defaultValue === undefined ? undefined : <code>{defaultValue}</code>,
          description: (
            <div className="space-y-3">
              {cloudOnly ? <Badge variant="secondary">Copilot Cloud</Badge> : null}
              <div className="prose-no-margin">{children}</div>
            </div>
          ),
        },
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Layout wrappers shell-docs kept for older content.
// ---------------------------------------------------------------------------

const grid = (cols: string) =>
  function Grid({ children }: Children) {
    return <div className={cn("my-6 grid gap-4", cols)}>{children}</div>;
  };

function Panel({ title, children }: { title?: string } & Children) {
  return (
    <div className="my-3 rounded-xl border bg-card p-4">
      {title ? <p className="mt-0 mb-1 font-semibold">{title}</p> : null}
      {children}
    </div>
  );
}

const Wrapper = ({ children }: Children) => <div>{children}</div>;

const layout = {
  FeatureGrid: grid("sm:grid-cols-2"),
  AttributeCards: grid("sm:grid-cols-2"),
  TwoColumnSection: grid("md:grid-cols-2"),
  Feature: Panel,
  PatternCard: Panel,
  IntegrationButtonGroup: ({ children }: Children) => (
    <div className="my-4 flex flex-wrap gap-2">{children}</div>
  ),
  ActionButtons: ({ children }: Children) => (
    <div className="my-4 flex gap-2">{children}</div>
  ),
  CodeGroup: Wrapper,
  IntegrationsGrid: Wrapper,
};

// ---------------------------------------------------------------------------
// Links and buttons
// ---------------------------------------------------------------------------

function Link({ href, children, ...rest }: ComponentProps<"a">) {
  if (!href) return <a {...rest}>{children}</a>;
  return (
    <NextLink href={href} {...rest}>
      {children}
    </NextLink>
  );
}

/** An inert button in prose (shell-docs' `<Button>` stub); links act. */
function Button({
  href,
  children,
  ...rest
}: { href?: string } & ComponentProps<"button">) {
  if (href) {
    return (
      <UiButton
        variant="outline"
        nativeButton={false}
        render={<NextLink href={href} />}
        className="not-prose"
      >
        {children}
      </UiButton>
    );
  }
  return (
    <UiButton variant="outline" type="button" className="not-prose" {...rest}>
      {children}
    </UiButton>
  );
}

// ---------------------------------------------------------------------------
// Icons named in content (as children or in `icon={<X />}` props).
// ---------------------------------------------------------------------------

const lucideNames = [
  "ArrowLeftRight", "Banknote", "Blocks", "Book", "BookA", "BookOpen", "Bot",
  "CircleDollarSign", "CirclePause", "Cloud", "Cog", "Cpu", "CpuIcon",
  "Database", "FileSpreadsheet", "Layers", "LayoutList", "LinkIcon",
  "MessageCircle", "MessageCircleDashed", "MessageSquare", "MessageSquareMore",
  "MonitorIcon", "Network", "Newspaper", "PaintbrushIcon", "PanelLeft", "Plane",
  "Play", "Plug", "PlugIcon", "RepeatIcon", "Rocket", "Server", "ServerIcon",
  "Settings", "Share2", "Sparkles", "SquareChartGantt", "SquareTerminal",
  "Trash", "UserIcon", "UserPen", "Wrench", "WrenchIcon", "X", "Zap",
] as const;

const icons: Record<string, unknown> = Object.fromEntries(
  lucideNames.map((name) => [name, Lucide[name]]),
);

/** `<Code />` is lucide's glyph in an icon slot; with children, inline code. */
function Code({ children, ...props }: Children & ComponentProps<"svg">) {
  return children ? <code>{children}</code> : <Lucide.Code {...props} />;
}

export const basicComponents = {
  ...callouts,
  Steps,
  Step,
  Frame,
  img: Img,
  Image,
  ImageZoom,
  video: Video,
  YouTubeVideo,
  PropertyReference,
  ...layout,
  Link,
  Button,
  ...icons,
  Code,
  FaArrowUp,
  FaCloud,
  FaGithub,
  FaServer,
  FaWrench,
  IoLogoNodejs,
  IoLogoVercel,
  PiMonitor,
  RiNextjsLine,
  SiLangchain,
  SiNestjs,
};
