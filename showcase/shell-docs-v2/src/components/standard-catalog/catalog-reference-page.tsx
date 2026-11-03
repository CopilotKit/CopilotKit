import Link from "next/link";
import type { TOCItemType } from "fumadocs-core/toc";
import { Heading } from "fumadocs-ui/components/heading";
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from "fumadocs-ui/layouts/spacious/page";
import { Feedback } from "@/components/feedback/client";
import { sendPageFeedback } from "@/lib/feedback";
import {
  CatalogComponentApi,
  CatalogReferenceDescription,
} from "./catalog-reference-api";
import { CatalogStoryLoader } from "./catalog-story-loader";
import {
  CATALOG_REFERENCE_PATH,
  catalogComponentSlug,
  catalogParts,
} from "./catalog-reference";

/**
 * A standard catalog component's reference page (shell-docs'
 * `CatalogReferencePage`): its story (a live preview with a control per prop,
 * one variant per catalog sample) and props, then each of its parts
 * (`GridItem` on Grid's page) under its own heading, so `#grid-item` lands on
 * it. `prefix` is the URL's scope (`/vue/mastra`), for its links.
 */
export function CatalogReferenceArticle({
  name,
  prefix,
}: {
  name: string;
  prefix: string;
}) {
  const parts = catalogParts(name);
  const toc: TOCItemType[] = [
    { title: "Props", url: "#props", depth: 2 },
    ...parts.map((part) => ({
      title: part,
      url: `#${catalogComponentSlug(part)}`,
      depth: 2,
    })),
  ];
  const index = `${prefix}${CATALOG_REFERENCE_PATH}`;

  return (
    <DocsPage toc={toc} footer={{ enabled: false }}>
      <DocsTitle className="text-[2.25rem] leading-[1.1] font-medium md:text-[2.5rem] tracking-[-0.03em] text-balance wrap-anywhere">
        {name}
      </DocsTitle>
      <DocsDescription className="mb-0">
        <CatalogReferenceDescription name={name} />
      </DocsDescription>
      <DocsBody>
        <CatalogStoryLoader name={name} />
        <Heading as="h2" id="props">
          Props
        </Heading>
        <CatalogComponentApi name={name} />
        {parts.map((part) => (
          <section key={part} aria-label={part}>
            <Heading as="h2" id={catalogComponentSlug(part)}>
              {part}
            </Heading>
            <p>
              <CatalogReferenceDescription name={part} />
            </p>
            <CatalogStoryLoader name={part} />
            <CatalogComponentApi name={part} />
          </section>
        ))}
        <p>
          <Link href={index}>All standard components</Link>
        </p>
      </DocsBody>
      <Feedback onSendAction={sendPageFeedback} />
    </DocsPage>
  );
}
