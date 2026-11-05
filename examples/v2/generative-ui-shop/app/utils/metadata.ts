import type { MetaDescriptor } from "react-router";

/**
 * Get the meta title from an array of meta descriptors.
 * @param metaDescriptors - An array of meta descriptors from route matches
 * @returns The meta title or null if not found
 */
export function getMetaTitle(metaDescriptors?: MetaDescriptor[]) {
  if (!metaDescriptors) return null;

  for (const item of metaDescriptors) {
    if ("title" in item && item.title && typeof item.title === "string")
      return item.title;
  }
  return null;
}
/**
 * Helper to get the meta array from route matches by route id.
 * @param matches - An array of route matches
 * @param id - The id of the route to find
 * @returns An array of meta descriptors for the matching route
 */
export function getMetaFromMatches<
  T extends { id?: string; meta?: MetaDescriptor[] },
>(matches: (T | undefined)[], id: string) {
  for (const match of matches) {
    if (match?.id === id && match?.meta) return match.meta;
  }
  return [];
}

/**
 * Helper to construct a prefixed title. If no prefix is provided, returns the original title.
 * @param title - The original title
 * @param prefix - The prefix to add
 * @returns The constructed title
 */
export function constructPrefixedTitle(title: string, prefix?: string | null) {
  return prefix ? `${prefix} | ${title}` : title;
}
