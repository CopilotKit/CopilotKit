/** The Clipboard API, else the old copy command (it works where the API is not allowed, such as an http:// LAN address). */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {}
  const tmp = document.createElement("textarea");
  tmp.value = text;
  tmp.setAttribute("readonly", "");
  tmp.style.cssText = "position:fixed;top:0;left:0;opacity:0";
  // Selecting the textarea takes focus; give it back once the textarea is gone.
  const before = document.activeElement as HTMLElement | null;
  document.body.appendChild(tmp);
  tmp.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {}
  tmp.remove();
  before?.focus({ preventScroll: true });
  return ok;
}
