/**
 * CopilotKit brand render config for the image cards: the compiled Tailwind
 * stylesheet + the Plus Jakarta Sans brand font, fed to
 * `createChannel({ render: { stylesheets, fonts } })`.
 *
 * `styles/brand.css` is produced by `pnpm build:css` (Tailwind) and committed,
 * so the bot runs without a build step. Cards are authored with Tailwind classes
 * (see app/showcase, app/components); Takumi resolves them from this sheet.
 */
import { readFile } from "node:fs/promises";
import type { RenderFont } from "@copilotkit/channels";

const FONT_DIR = new URL("../../assets/fonts/", import.meta.url);
const BRAND_CSS = new URL("../../styles/brand.css", import.meta.url);

/** Load the compiled brand stylesheet + Plus Jakarta Sans (Medium 500, Bold 700). */
export async function loadBrandRender(): Promise<{
  stylesheets: string[];
  fonts: RenderFont[];
}> {
  const [css, medium, bold] = await Promise.all([
    readFile(BRAND_CSS, "utf8"),
    readFile(new URL("PlusJakartaSans-Medium.ttf", FONT_DIR)),
    readFile(new URL("PlusJakartaSans-Bold.ttf", FONT_DIR)),
  ]);
  const fonts: RenderFont[] = [
    { name: "Plus Jakarta Sans", data: new Uint8Array(medium), weight: 500 },
    { name: "Plus Jakarta Sans", data: new Uint8Array(bold), weight: 700 },
  ];
  return { stylesheets: [css], fonts };
}
