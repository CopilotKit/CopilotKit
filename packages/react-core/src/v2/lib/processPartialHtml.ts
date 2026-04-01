/**
 * Extracts all complete `<style>` blocks from the raw HTML.
 * Returns the concatenated style tags, suitable for injection into `<head>`.
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
 * 5. Extract body content (or use full string if no <body>)
 */
export function processPartialHtml(html: string): string {
  let result = html;

  // 1. Strip incomplete tag at end — e.g. `<div class="fo`
  result = result.replace(/<[^>]*$/, "");

  // 2. Strip complete <style>, <script>, and <head> blocks
  result = result.replace(/<(style|script|head)\b[^>]*>[\s\S]*?<\/\1>/gi, "");

  // 3. Strip incomplete <style>/<script>/<head> blocks (opening tag, no close)
  result = result.replace(/<(style|script|head)\b[^>]*>[\s\S]*$/gi, "");

  // 4. Strip incomplete HTML entities — e.g. `&amp` without semicolon
  result = result.replace(/&[a-zA-Z0-9#]*$/, "");

  // 5. Extract body content
  const bodyMatch = result.match(/<body[^>]*>([\s\S]*)/i);
  if (bodyMatch) {
    result = bodyMatch[1]!;
    // Strip </body> and everything after
    result = result.replace(/<\/body>[\s\S]*/i, "");
  }

  return result;
}
