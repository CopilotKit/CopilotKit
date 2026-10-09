const CARD_FIELDS = new Set([
  "type",
  "block_id",
  "hero_image",
  "icon",
  "title",
  "subtitle",
  "body",
  "actions",
  "slack_icon",
  "subtext",
]);
const CAROUSEL_FIELDS = new Set(["type", "block_id", "elements"]);

/** Validate Card and Carousel blocks before any Slack provider call. */
export function validateSlackBlockKit(blocks: readonly unknown[]): void {
  blocks.forEach((block, index) => validateBlock(block, `/blocks/${index}`));
}

function validateBlock(value: unknown, path: string): void {
  if (!isRecord(value)) return;
  if (value.type === "card") validateCard(value, path);
  if (value.type === "carousel") validateCarousel(value, path);
}

function validateCard(card: Record<string, unknown>, path: string): void {
  rejectUnknownFields(card, CARD_FIELDS, path);
  if (
    card.hero_image === undefined &&
    card.title === undefined &&
    card.actions === undefined &&
    card.body === undefined
  ) {
    throw new TypeError(
      `${path}: card requires hero_image, title, actions, or body`,
    );
  }
  if (card.actions !== undefined) {
    if (!Array.isArray(card.actions)) invalidField(`${path}/actions`);
    if (card.actions.length > 3) invalidField(`${path}/actions`);
    card.actions.forEach((action, index) => {
      if (!isRecord(action) || action.type !== "button") {
        invalidField(`${path}/actions/${index}`);
      }
    });
  }
}

function validateCarousel(
  carousel: Record<string, unknown>,
  path: string,
): void {
  rejectUnknownFields(carousel, CAROUSEL_FIELDS, path);
  if (
    !Array.isArray(carousel.elements) ||
    carousel.elements.length < 1 ||
    carousel.elements.length > 10
  ) {
    invalidField(`${path}/elements`);
  }
  carousel.elements.forEach((card, index) => {
    const cardPath = `${path}/elements/${index}`;
    if (!isRecord(card) || card.type !== "card") invalidField(cardPath);
    validateCard(card, cardPath);
  });
}

function rejectUnknownFields(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  path: string,
): void {
  for (const field of Object.keys(value)) {
    if (!allowed.has(field)) {
      const fieldPath = `${path}/${jsonPointer(field)}`;
      if (value.type === "card" && field === "children") {
        invalidField(fieldPath, "Card buttons belong in actions");
      }
      if (
        value.type === "carousel" &&
        (field === "cards" || field === "children")
      ) {
        invalidField(fieldPath, "Carousel cards belong in elements");
      }
      invalidField(fieldPath);
    }
  }
}

function invalidField(path: string, expected?: string): never {
  throw new TypeError(
    `invalid field at ${path}${expected ? `; ${expected}` : ""}`,
  );
}

function jsonPointer(value: string): string {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
