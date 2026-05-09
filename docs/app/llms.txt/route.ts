import { source } from "@/app/source";
import { getMarkdownPath } from "@/lib/get-llm-text";

export const revalidate = false;

export function GET(request: Request) {
  const origin = new URL(request.url).origin;
  const pages = source
    .getPages()
    .slice()
    .sort((a, b) => a.url.localeCompare(b.url));

  const lines = [
    "# CopilotKit Docs",
    "",
    "> AI-friendly markdown index for CopilotKit documentation.",
    "",
    "Every link below points to a markdown version of the corresponding docs page.",
    "Use llms-full.txt when you want the full docs corpus in one file.",
    "",
    "## Docs",
    "",
    ...pages.map((page) => {
      const description = page.data.description ? `: ${page.data.description}` : "";
      return `- [${page.data.title}](${origin}${getMarkdownPath(page.url)})${description}`;
    }),
    "",
    "## Optional",
    "",
    `- [Full documentation](${origin}/llms-full.txt): Complete CopilotKit docs in a single markdown file.`,
  ];

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
    },
  });
}
