/** Toggle an available document root and report the resulting theme. */
export function toggleDocumentTheme(
  root: HTMLElement | undefined,
): "dark" | "light" {
  if (!root) return "light";
  return root.classList.toggle("dark") ? "dark" : "light";
}
