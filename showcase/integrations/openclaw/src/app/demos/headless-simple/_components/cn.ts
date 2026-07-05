/**
 * Tiny local class-name joiner. The openclaw demos are self-contained, so we
 * inline this instead of pulling in `@/lib/utils` (clsx/tailwind-merge). It
 * simply drops falsy values and joins the rest with a space.
 */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
