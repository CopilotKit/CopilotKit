export const SAVE_SNIPPET_ICON_SLOT_PX = 36;

export const SAVE_SNIPPET_BESIDE_WRAP_CLASS =
  "cpk:relative cpk:w-full cpk:overflow-visible";

export const SAVE_SNIPPET_BESIDE_BODY_CLASS = "cpk:w-full";

export const SAVE_SNIPPET_BESIDE_SAVE_CLASS = "cpk:absolute cpk:top-0 cpk:z-10";

export function saveSnippetBesideStyle(side: "left" | "right") {
  if (side === "left") {
    return {
      left: "auto",
      right: "100%",
      marginLeft: "0px",
      marginRight: "4px",
    } as const;
  }
  return {
    left: "100%",
    right: "auto",
    marginLeft: "4px",
    marginRight: "0px",
  } as const;
}

export function pickSaveSnippetSide(
  roomRight: number,
  roomLeft: number,
  slotPx = SAVE_SNIPPET_ICON_SLOT_PX,
): "left" | "right" {
  if (roomRight >= slotPx) {
    return "right";
  }
  if (roomLeft >= slotPx) {
    return "left";
  }
  return "right";
}

export function findOverflowAncestor(el: HTMLElement): HTMLElement {
  let node: HTMLElement | null = el.parentElement;
  while (node) {
    const style = getComputedStyle(node);
    const overflowX = style.overflowX;
    const overflow = style.overflow;
    if (
      overflowX === "hidden" ||
      overflowX === "auto" ||
      overflowX === "scroll" ||
      overflow === "hidden" ||
      overflow === "auto" ||
      overflow === "scroll"
    ) {
      return node;
    }
    node = node.parentElement;
  }
  return document.documentElement;
}

export function measurableBox(el: HTMLElement): HTMLElement {
  let node: HTMLElement | null = el;
  while (node && getComputedStyle(node).display === "contents") {
    node = node.firstElementChild as HTMLElement | null;
  }
  return node ?? el;
}

export function measureSaveSnippetSide(
  wrap: HTMLElement,
  body: HTMLElement,
): "left" | "right" {
  const clip = findOverflowAncestor(wrap);
  const clipRect = clip.getBoundingClientRect();
  const box = measurableBox(
    (body.firstElementChild as HTMLElement | null) ?? body,
  );
  const bodyRect = box.getBoundingClientRect();
  return pickSaveSnippetSide(
    clipRect.right - bodyRect.right,
    bodyRect.left - clipRect.left,
  );
}
