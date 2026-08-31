import type { ChannelNode } from "@copilotkit/channels-ui";
import { isChannelComponent } from "@copilotkit/channels-ui";
import { isReactElement } from "./detect.js";

const INTERACTIVE = new Set(["button", "select", "input", "actions"]);
const NESTED_SNAPSHOT = new Set(["render", "carousel", "carouselCard"]);
const CARD_CHILD = new Set(["header", "section", "render", "image", "button"]);
const CAROUSEL_CHILD = new Set(["carouselCard", "render", "image"]);
const IMAGE_TYPES = new Set(["render", "image"]);

function childrenOf(node: ChannelNode): ChannelNode[] {
  const raw = node.props.children;
  if (raw == null || raw === false) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.filter(
    (c): c is ChannelNode =>
      typeof c === "object" && c !== null && "type" in c && "props" in c,
  );
}

function leftoverNonNodeChildren(node: ChannelNode): unknown[] {
  const raw = node.props.children;
  if (raw == null || raw === false || raw === true) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list.filter((c) => {
    if (c == null || c === false || c === true) return false;
    const isNode =
      typeof c === "object" && c !== null && "type" in c && "props" in c;
    return !isNode;
  });
}

function typeOf(node: ChannelNode): string {
  return typeof node.type === "string" ? node.type : "";
}

function stringTypeOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    typeof (value as { type: unknown }).type === "string"
  ) {
    return (value as { type: string }).type;
  }
  return "";
}

function throwIfBannedType(t: string): void {
  if (INTERACTIVE.has(t)) {
    throw new Error(
      "channels.render: <Render> cannot contain <Button>, <Select>, <Input>, or <Actions>",
    );
  }
  if (NESTED_SNAPSHOT.has(t)) {
    throw new Error(
      "channels.render: <Render> cannot contain <Render>, <Carousel>, or <CarouselCard>",
    );
  }
}

function invokeChild(
  type: (p: Record<string, unknown>) => unknown,
  props: Record<string, unknown>,
): unknown {
  try {
    return type(props ?? {});
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("channels.render:")) {
      throw err;
    }
    const name =
      typeof type.name === "string" && type.name ? type.name : "component";
    throw new Error(
      `channels.render: failed to inspect <${name}> inside <Render>`,
      { cause: err },
    );
  }
}

function walkBannedValue(value: unknown): void {
  if (value == null || value === false || value === true) return;
  if (typeof value === "string" || typeof value === "number") return;
  if (Array.isArray(value)) {
    for (const item of value) walkBannedValue(item);
    return;
  }
  if (typeof value !== "object" || !("type" in value)) return;

  const typed = value as { type: unknown; props?: Record<string, unknown> };
  const t = typed.type;
  const props = typed.props ?? {};

  // Host tag on a React element: "button" is HTML, not Channels <Button>.
  if (isReactElement(value) && typeof t === "string") {
    walkBannedValue(props.children);
    return;
  }

  if (typeof t === "function") {
    const out = invokeChild(
      t as (p: Record<string, unknown>) => unknown,
      props,
    );
    if (isChannelComponent(t)) {
      throwIfBannedType(stringTypeOf(out));
    }
    walkBannedValue(out);
    return;
  }

  if (typeof t === "string") {
    throwIfBannedType(t);
  }
  walkBannedValue(props.children);
}

function walkRenderBanned(node: ChannelNode): void {
  walkBannedValue(node.props.children);
}

function validateCarouselCard(node: ChannelNode): void {
  let headers = 0;
  let sections = 0;
  let images = 0;
  let buttons = 0;
  for (const child of childrenOf(node)) {
    const t = typeOf(child);
    if (!CARD_CHILD.has(t)) {
      throw new Error(
        "channels.render: <CarouselCard> only allows <Header>, <Section>, <Render>, <Image>, and <Button>",
      );
    }
    if (t === "header") headers += 1;
    if (t === "section") sections += 1;
    if (IMAGE_TYPES.has(t)) images += 1;
    if (t === "button") buttons += 1;
    if (t === "render") validateRender(child);
  }
  if (headers > 1) {
    throw new Error(
      "channels.render: <CarouselCard> allows at most one <Header>",
    );
  }
  if (sections > 1) {
    throw new Error(
      "channels.render: <CarouselCard> allows at most one <Section>",
    );
  }
  if (images > 1) {
    throw new Error("channels.render: <CarouselCard> allows at most one image");
  }
  if (buttons > 3) {
    throw new Error(
      "channels.render: <CarouselCard> allows at most 3 <Button>s",
    );
  }
}

function validateRender(node: ChannelNode): void {
  const alt = node.props.alt;
  if (typeof alt !== "string" || alt.length === 0) {
    throw new Error("channels.render: <Render> requires alt");
  }
  if (
    childrenOf(node).length === 0 &&
    leftoverNonNodeChildren(node).length === 0
  ) {
    throw new Error("channels.render: <Render> requires children");
  }
  walkRenderBanned(node);
}

function validateCarousel(node: ChannelNode): void {
  const slides = childrenOf(node);
  if (slides.length < 1 || slides.length > 10) {
    throw new Error("channels.render: <Carousel> must have 1 to 10 slides");
  }
  for (const slide of slides) {
    const t = typeOf(slide);
    if (!CAROUSEL_CHILD.has(t)) {
      throw new Error(
        "channels.render: <Carousel> children must be <CarouselCard>, <Render>, or <Image>",
      );
    }
    if (t === "carouselCard") validateCarouselCard(slide);
    if (t === "render") validateRender(slide);
  }
}

export function validateRenderTree(nodes: readonly ChannelNode[]): void {
  const visit = (node: ChannelNode, inCarousel: boolean): void => {
    const t = typeOf(node);
    if (t === "render") validateRender(node);
    if (t === "carousel") validateCarousel(node);
    if (t === "carouselCard" && !inCarousel) {
      throw new Error(
        "channels.render: <CarouselCard> is only valid inside <Carousel>",
      );
    }
    const next = t === "carousel" ? true : inCarousel;
    for (const child of childrenOf(node)) visit(child, next);
  };
  for (const node of nodes) visit(node, false);
}
