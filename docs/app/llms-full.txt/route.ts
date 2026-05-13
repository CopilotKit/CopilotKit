import { source } from "@/app/source";
import { getLLMText } from "@/lib/get-llm-text";

export const revalidate = false;

export async function GET() {
  const scanned = await Promise.all(
    source
      .getPages()
      .slice()
      .sort((a, b) => a.url.localeCompare(b.url))
      .map(getLLMText),
  );

  return new Response(scanned.join("\n\n"), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
    },
  });
}
