import type { LitRenderable } from "../types";

export function renderChildList(
  childList: unknown,
  buildChild: (id: string, basePath?: string) => LitRenderable,
): LitRenderable[] {
  if (!Array.isArray(childList)) return [];
  return childList
    .map((item: unknown) => {
      if (item && typeof item === "object" && "id" in item) {
        const node = item as { id: string; basePath?: string };
        return buildChild(node.id, node.basePath);
      }
      if (typeof item === "string") return buildChild(item);
      return null;
    })
    .filter(Boolean) as LitRenderable[];
}
