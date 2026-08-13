import type { ChannelNode } from "@copilotkit/channels-ui";

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

function typeOf(node: ChannelNode): string {
  return typeof node.type === "string" ? node.type : "";
}

function walkRenderBanned(node: ChannelNode): void {
  for (const child of childrenOf(node)) {
    const t = typeOf(child);
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
    walkRenderBanned(child);
  }
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
  if (childrenOf(node).length === 0 && node.props.children == null) {
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
