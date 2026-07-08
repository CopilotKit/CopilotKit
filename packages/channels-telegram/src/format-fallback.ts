export function stripHtml(s: string): string {
  return s
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

export async function withTelegramFormatFallback<T>(
  send: (opts: { parseMode?: "HTML"; text: string }) => Promise<T>,
  text: string,
): Promise<T> {
  try {
    return await send({ parseMode: "HTML", text });
  } catch (err) {
    if (
      err instanceof Error &&
      /can't parse (?:caption )?entities|unsupported start tag|can't find end tag|tag .* is not (?:allowed|closed)/i.test(
        err.message,
      )
    ) {
      return send({ text: stripHtml(text) });
    }
    throw err;
  }
}
