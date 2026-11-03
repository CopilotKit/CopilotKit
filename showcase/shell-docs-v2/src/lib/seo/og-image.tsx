import { readFileSync } from "node:fs";
import { join } from "node:path";
import { generateOGImage } from "fumadocs-ui/og";
import { appName } from "@/lib/shared";

// The docs' social card (1200x630): Fumadocs' stock template on its dark
// ground (an approved brand context), with the brand lilac in place of its
// default accent and the official CopilotKit mark. Shared by `/og/<path>/og.png`
// (live pages) and `/og/docs/<path>/image.png` (the /docs pages).

// Inlined as a data URI so the image renderer can draw it.
const markSrc = `data:image/svg+xml;base64,${readFileSync(
  join(process.cwd(), "public/copilotkit-mark.svg"),
).toString("base64")}`;

/** Collapse whitespace and cut to `max` characters, as shell-docs' cards did. */
function fit(value: string | undefined, max: number): string | undefined {
  const text = value?.replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text.length <= max ? text : `${text.slice(0, max - 3).trimEnd()}...`;
}

export function docsOgImage({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return generateOGImage({
    title: fit(title, 86) ?? appName,
    description: fit(description, 132),
    site: appName,
    // ImageResponse draws plain <img>; next/image does not work here.
    // oxlint-disable-next-line nextjs/no-img-element
    icon: <img src={markSrc} width={48} height={51} alt="" />,
    primaryColor: "rgba(190, 194, 255, 0.3)",
    primaryTextColor: "#bec2ff",
  });
}
