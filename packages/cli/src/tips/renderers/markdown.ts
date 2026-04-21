import chalk from "chalk";
import { Tip, TipRenderer } from "../types.js";

export class MarkdownTipRenderer implements TipRenderer {
  render(tip: Tip, log: (msg: string) => void): void {
    const formatted = this.formatMarkdown(tip.message);
    log("");
    log(`💡 ${formatted}`);
  }

  private formatMarkdown(text: string): string {
    // Phase 1: Extract markdown links into placeholders to avoid double-processing URLs
    const links: string[] = [];
    let result = text.replace(
      /\[(.*?)\]\((.*?)\)/g,
      (_match, linkText: string, url: string) => {
        const index = links.length;
        links.push(`${linkText} (${chalk.blue(url)})`);
        return `\x00LINK${index}\x00`;
      },
    );

    // Phase 2: Bold — **text**
    result = result.replace(/\*\*(.*?)\*\*/g, (_match, content: string) =>
      chalk.bold(content),
    );

    // Phase 3: Inline code — `code`
    result = result.replace(/`(.*?)`/g, (_match, content: string) =>
      chalk.cyan(content),
    );

    // Phase 4: Bare URLs (placeholders won't match)
    result = result.replace(/(https?:\/\/[^\s]+)/g, (url: string) =>
      chalk.blue(url),
    );

    // Phase 5: Restore link placeholders
    result = result.replace(
      /\x00LINK(\d+)\x00/g,
      (_match, index: string) => links[parseInt(index)],
    );

    return result;
  }
}
