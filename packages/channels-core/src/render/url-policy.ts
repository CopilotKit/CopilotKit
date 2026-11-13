/**
 * Remote resources in JSX may come from model or user input. Deny every fetch
 * by default: a synchronous hostname check cannot rule out DNS rebinding.
 * Applications can opt in to trusted origins with render.allowImageUrl.
 */
export function defaultAllowImageUrl(_url: string): boolean {
  return false;
}
