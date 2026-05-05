/**
 * Extracts all complete `<style>` blocks from raw HTML.
 * Returns concatenated style tags suitable for injection into `<head>`.
 */
export function extractCompleteStyles(html: string): string {
  const matches = html.match(/<style\b[^>]*>[\s\S]*?<\/style>/gi);
  return matches ? matches.join("") : "";
}

/**
 * Processes raw accumulated HTML for safe preview via innerHTML injection.
 * Pure function, no DOM dependencies.
 *
 * Pipeline (order matters):
 * 1. Strip incomplete tag at end
 * 2. Strip complete <style>, <script>, and <head> blocks
 * 3. Strip incomplete <style>/<script>/<head> blocks
 * 4. Strip incomplete HTML entities
 * 5. Extract body content
 */
export function processPartialHtml(html: string): string {
  let result = html;
  result = result.replace(/<[^>]*$/, "");
  result = result.replace(/<(style|script|head)\b[^>]*>[\s\S]*?<\/\1>/gi, "");
  result = result.replace(/<(style|script|head)\b[^>]*>[\s\S]*$/gi, "");
  result = result.replace(/&[a-zA-Z0-9#]*$/, "");
  const bodyMatch = result.match(/<body[^>]*>([\s\S]*)/i);
  if (bodyMatch) {
    result = bodyMatch[1]!;
    result = result.replace(/<\/body>[\s\S]*/i, "");
  }
  return result;
}
