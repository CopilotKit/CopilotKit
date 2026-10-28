import type { ComponentProps, ComponentType, ReactNode } from "react";
import NextImage from "next/image";
import {
  Card as FumadocsCard,
  Cards as FumadocsCards,
} from "fumadocs-ui/components/card";
import { CirclePause, Cloud, Code, PanelLeft, Server, Share2 } from "lucide-react";
import { docsHref } from "./href";
import type { DocsScope } from "./scope";

type CardProps = ComponentProps<typeof FumadocsCard> & {
  /** An image mark instead of an icon (a partner logo). */
  logo?: string;
  logoAlt?: string;
  logoClassName?: string;
};

/** `iconKey` values `<CTACards>` content uses (lucide names). */
const CTA_ICONS: Record<string, ComponentType> = {
  circlePause: CirclePause,
  cloud: Cloud,
  code: Code,
  panelLeft: PanelLeft,
  server: Server,
  share2: Share2,
};

const CTA_COLUMNS: Record<number, string> = {
  1: "grid-cols-1",
  2: "grid-cols-1 sm:grid-cols-2",
  3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3",
  4: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
};

/**
 * Fumadocs' cards. Links stay in the reader's docs surface: on
 * `/mastra/...` a card to `/quickstart` goes to `/mastra/quickstart`.
 */
export function createCards(scope: DocsScope) {
  function Card({ href, icon, logo, logoAlt = "", logoClassName, ...props }: CardProps) {
    const mark =
      icon ??
      (logo ? (
        <NextImage
          src={logo}
          alt={logoAlt}
          width={20}
          height={20}
          unoptimized
          className={logoClassName ?? "size-5 object-contain"}
        />
      ) : undefined);
    return (
      <FumadocsCard
        {...props}
        icon={mark}
        href={href ? docsHref(href, scope) : undefined}
      />
    );
  }

  function CTACards({
    cards,
    columns = 2,
    children,
  }: {
    cards?: { iconKey?: string; title: string; description?: string; href: string }[];
    columns?: number;
    children?: ReactNode;
  }) {
    return (
      <div className={`not-prose my-6 grid gap-4 ${CTA_COLUMNS[columns] ?? CTA_COLUMNS[2]}`}>
        {cards?.length
          ? cards.map((card) => {
              const Icon =
                card.iconKey && Object.hasOwn(CTA_ICONS, card.iconKey)
                  ? CTA_ICONS[card.iconKey]
                  : undefined;
              return (
                <Card
                  key={card.href}
                  href={card.href}
                  title={card.title}
                  description={card.description}
                  icon={Icon ? <Icon /> : undefined}
                />
              );
            })
          : children}
      </div>
    );
  }

  return { Cards: FumadocsCards, CardGroup: FumadocsCards, Card, CTACards };
}
