import Link from "next/link";
import { useRef, type ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { SiDotnet, SiFastapi, SiPython, SiTypescript } from "react-icons/si";
import { cn } from "@/lib/cn";
import { FrameworkLogo } from "@/components/icons/framework-icons";
import { PixelMatrix } from "@/components/brand/pixel-matrix";
import { MATRIX_GROUND } from "@/components/brand/stage";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { VariantLang } from "./data";
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";

/*
 * Link cards for prototype D, on shadcn's Item, laid in a Tray the way the
 * website lays its use-case tabs: white, borderless, 12px corners inside the
 * tray's 20px over its 8px padding, so the two radii read as one shape. The
 * glyph is a solid ink mark with no tile (official colors for a logo). Hover
 * takes the website's lilac border-action edge and turns a docs glyph lilac.
 */
const GLYPH = {
  ink: "text-foreground group-hover/item:text-primary",
  logo: "",
} as const;

const CARD =
  "items-start gap-3.5 rounded-lg bg-tray-card p-4 transition-[border-color,background-color] duration-200 hover:border-edge-action focus-visible:border-ring motion-reduce:transition-none sm:p-5 [a]:hover:bg-tray-card";
const MEDIA =
  "size-6 transition-colors duration-200 motion-reduce:transition-none [&_svg]:size-[22px] [&_img]:size-[22px]";

/**
 * The lilac-grey tray under a card grid. Every row is as tall as the tallest,
 * so all cards in a tray are one size. `matrix` sets the cards on the
 * matrix's stage ground instead, the same look as every other matrix: a
 * wider tray (12px cards in a 28px tray over 16px of padding) so the squares
 * show around and between them, lit under the pointer.
 */
export function Tray({
  children,
  matrix = false,
}: {
  children: ReactNode;
  matrix?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative isolate grid auto-rows-fr grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
        matrix
          ? cn(
              "gap-3 overflow-hidden rounded-[28px] border-[1.5px] border-stage-rim p-3 sm:p-4",
              MATRIX_GROUND,
            )
          : "gap-2 rounded-[20px] bg-frame p-2",
      )}
    >
      {matrix ? <PixelMatrix interactive /> : null}
      {children}
    </div>
  );
}

export function LinkCard({
  href,
  title,
  description,
  icon,
  glyph = "ink",
}: {
  href: string;
  title: string;
  description?: string;
  icon: ReactNode;
  glyph?: keyof typeof GLYPH;
}) {
  return (
    <Item render={<Link href={href} />} className={CARD}>
      <ItemMedia className={cn(MEDIA, GLYPH[glyph])}>{icon}</ItemMedia>
      <ItemContent className="gap-1.5">
        <ItemTitle className="text-base leading-6 font-semibold">
          {title}
        </ItemTitle>
        {description ? (
          <ItemDescription className="leading-normal">
            {description}
          </ItemDescription>
        ) : null}
      </ItemContent>
    </Item>
  );
}

/**
 * Each language's own mark and color (lightened in dark mode to hold 3:1),
 * so a family card says at a glance what it ships in.
 */
const LANG: Record<VariantLang, { Icon: typeof SiPython; className: string }> =
  {
    python: { Icon: SiPython, className: "text-[#3776ab] dark:text-[#7cb0e0]" },
    typescript: {
      Icon: SiTypescript,
      className: "text-[#3178c6] dark:text-[#6fa8ec]",
    },
    fastapi: {
      Icon: SiFastapi,
      className: "text-[#009688] dark:text-[#3fd1bd]",
    },
    dotnet: { Icon: SiDotnet, className: "text-[#512bd4] dark:text-[#a28cf2]" },
  };

function LangIcon({ lang, size }: { lang: VariantLang; size: number }) {
  const { Icon, className } = LANG[lang];
  // The .NET mark is a wide wordmark, so it needs more room to read.
  const scaled = lang === "dotnet" ? Math.round(size * 1.4) : size;
  return <Icon size={scaled} className={className} aria-hidden="true" />;
}

/**
 * One card for a framework that ships in several languages. Hovering (or
 * clicking, on touch and keyboard) opens a popover of its variants, each
 * going straight to that variant's page; the languages show on the card.
 */
export function FamilyCard({
  name,
  summary,
  variants,
}: {
  name: string;
  summary: string;
  variants: { id: string; label: string; lang: VariantLang; href: string }[];
}) {
  // The popover hangs off the language chips, right under what was hovered,
  // not off the bottom of a card that a tall row may have stretched.
  const chips = useRef<HTMLSpanElement>(null);
  return (
    <Popover>
      <Item
        render={<PopoverTrigger openOnHover delay={120} closeDelay={160} />}
        className={cn(
          CARD,
          "cursor-pointer text-start data-popup-open:border-edge-action",
        )}
      >
        <ItemMedia className={MEDIA}>
          <FrameworkLogo slug={variants[0].id} size={22} />
        </ItemMedia>
        <ItemContent className="gap-1.5">
          <ItemTitle className="text-base leading-6 font-semibold">
            {name}
          </ItemTitle>
          <ItemDescription className="leading-normal">
            {summary}
          </ItemDescription>
          <span ref={chips} className="mt-1.5 flex flex-wrap gap-1">
            {variants.map((v) => (
              <span
                key={v.id}
                className="inline-flex h-6 items-center gap-1 rounded-full border bg-background px-1.5 text-xs font-medium text-foreground/80"
              >
                <LangIcon lang={v.lang} size={12} />
                {v.label}
              </span>
            ))}
          </span>
        </ItemContent>
      </Item>
      <PopoverContent
        anchor={chips}
        align="start"
        sideOffset={6}
        className="w-64 gap-0 rounded-xl p-1.5 ring-frame-rim"
      >
        {variants.map((v) => (
          <Link
            key={v.id}
            href={v.href}
            className="group/v flex min-h-10 items-center gap-2.5 rounded-lg px-2 text-sm transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
          >
            <span className="flex size-7 shrink-0 items-center justify-center rounded-md border bg-background">
              <LangIcon lang={v.lang} size={15} />
            </span>
            <span className="flex-1 font-medium">{v.label}</span>
            <ArrowRight
              className="size-4 text-muted-foreground transition-transform group-hover/v:translate-x-0.5 motion-reduce:transition-none"
              aria-hidden="true"
            />
          </Link>
        ))}
      </PopoverContent>
    </Popover>
  );
}

/** The website's mint "live" dot. */
export function LiveDot() {
  return (
    <span
      aria-hidden="true"
      className="size-2 shrink-0 rounded-full bg-brand-mint-deep ring-3 ring-tile-mint"
    />
  );
}
