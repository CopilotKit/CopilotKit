/**
 * `render_carousel` / `/carousel` — mix native channel UI with React snapshots
 * in one message. Each slide is a `<CarouselCard>`: a native header, a
 * `<Render>` of `<ProductCard/>` (Takumi PNG), native sale text, and a native
 * Buy button.
 */
import { z } from "zod";
import {
  defineChannelTool,
  defineChannelCommand,
  Message,
  Header,
  Section,
  Button,
  Render,
  Carousel,
  CarouselCard,
} from "@copilotkit/channels";
import type {
  ChannelToolContext,
  InteractionContext,
} from "@copilotkit/channels";
import { ProductCard } from "../components/product-card.js";

export const catalogItemSchema = z.object({
  name: z.string().describe("Product name, e.g. 'Red shoes'."),
  price: z.string().describe("Formatted price, e.g. '$89'."),
  color: z.string().describe("Hex swatch for the card, e.g. '#5a3cd1'."),
  tag: z.string().optional().describe("Optional badge, e.g. 'On sale'."),
});

/** `render_carousel()` with no args must post the sample catalog. */
function coerceCarouselArgs(raw: unknown): Record<string, unknown> {
  if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  const obj = { ...(raw as Record<string, unknown>) };
  if (obj.heading == null) delete obj.heading;
  if (
    obj.items == null ||
    (Array.isArray(obj.items) && obj.items.length === 0)
  ) {
    delete obj.items;
  }
  return obj;
}

const schema = z.preprocess(
  coerceCarouselArgs,
  z.object({
    heading: z
      .string()
      .optional()
      .describe("Carousel heading. Defaults to 'This week'."),
    items: z
      .array(catalogItemSchema)
      .max(10)
      .optional()
      .describe(
        "Catalog slides. Omit this, or pass an empty list, to post the sample shoes / hat / bottle catalog.",
      ),
  }),
);

export type CatalogItem = z.infer<typeof catalogItemSchema>;

export const SAMPLE_CATALOG: CatalogItem[] = [
  {
    name: "Red running shoes",
    price: "$89",
    color: "#5a3cd1",
    tag: "On sale",
  },
  { name: "Canvas hat", price: "$24", color: "#ffac4d" },
  { name: "Steel bottle", price: "$18", color: "#3d92e8", tag: "New" },
];

type CarouselThread = ChannelToolContext["thread"];

function buyHandler(name: string) {
  return async ({ thread }: InteractionContext) => {
    await thread.post(`Added *${name}* to the cart.`);
  };
}

function CatalogCarousel({
  heading,
  items,
}: {
  heading: string;
  items: CatalogItem[];
}) {
  return (
    <Message>
      <Header>{heading}</Header>
      <Carousel>
        {items.map((item) => (
          <CarouselCard key={item.name}>
            <Header>{item.name}</Header>
            <Render alt={item.name} width={320} height={260}>
              <ProductCard
                name={item.name}
                price={item.price}
                color={item.color}
                tag={item.tag}
              />
            </Render>
            <Section>{item.tag ?? item.price}</Section>
            <Button
              value={`buy:${item.name}`}
              style="primary"
              onClick={buyHandler(item.name)}
            >
              Buy
            </Button>
          </CarouselCard>
        ))}
      </Carousel>
    </Message>
  );
}

/** True when the user asks for the sample carousel in plain text. */
export function isCarouselRequest(text: string | undefined): boolean {
  if (typeof text !== "string") return false;
  return /\bcarousel\b/i.test(text) || /\bsample catalog\b/i.test(text);
}

/** Shared by the tool, the slash command, and the plain-text mention path. */
export async function renderCatalogCarousel(
  thread: CarouselThread,
  args: { heading?: string; items?: CatalogItem[] } = {},
): Promise<string> {
  const heading = args.heading ?? "This week";
  const items = args.items?.length ? args.items : SAMPLE_CATALOG;
  await thread.post(<CatalogCarousel heading={heading} items={items} />, {
    filename: "carousel.png",
    altText: `${heading ?? "Catalog"}: ${items.map((item) => item.name).join(", ")}`,
  });
  return `Posted a ${items.length}-item carousel.`;
}

export const renderCarouselTool = defineChannelTool({
  name: "render_carousel",
  description:
    "Post a product carousel that mixes native channel UI with React snapshots. " +
    "Each slide has a React ProductCard image, native text, and a Buy button. " +
    "When the user asks for a carousel, catalog, or sample slides in plain text, " +
    "call this with no arguments to post the sample catalog.",
  parameters: schema,
  async handler(args, { thread }) {
    return renderCatalogCarousel(thread, args);
  },
});

export const carouselCommand = defineChannelCommand({
  name: "carousel",
  description: "Post a demo carousel of React product cards.",
  async handler({ thread }) {
    await renderCatalogCarousel(thread);
  },
});
