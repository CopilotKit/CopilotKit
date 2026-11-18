import { serializeJsonLd } from "@/lib/seo/structured-data";

/** Renders schema.org structured data for search and answer engines. */
export function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      // Serialized by serializeJsonLd, which escapes `<`.
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}
