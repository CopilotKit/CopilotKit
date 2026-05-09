import { source } from "@/app/source";

type DocPage = ReturnType<typeof source.getPages>[number];

export function getMarkdownPath(url: string) {
  return url === "/" ? "/index.md" : `${url}.md`;
}

export async function getLLMText(page: DocPage) {
  const processed = await page.data.getText("processed");
  const description = page.data.description
    ? `> ${page.data.description}\n\n`
    : "";

  return `# ${page.data.title} (${page.url})\n\n${description}${processed}`;
}
