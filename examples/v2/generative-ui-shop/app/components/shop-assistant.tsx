import {
  CopilotPopup,
  useAgentContext,
  useConfigureSuggestions,
  useFrontendTool,
  useHumanInTheLoop,
  useRenderTool,
} from "@copilotkit/react-core";
import { useLocation, useNavigate } from "react-router";
import { z } from "zod";
import { useCart } from "#app/contexts/cart.tsx";

const NAVIGABLE_PAGES = {
  "/": "The home page (hero, featured products, categories).",
  "/cart": "The customer's shopping cart.",
  "/products":
    "The full product catalog. Use this for general browse requests when no specific filter applies (for filtered search, use `searchProducts` instead).",
  "/compare":
    "The side-by-side comparison of the products the customer picked.",
  "/about": 'The "about EpicStore" page.',
  "/contact": "The contact form.",
} as const;

type Destination = keyof typeof NAVIGABLE_PAGES;

const destinationDoc = Object.entries(NAVIGABLE_PAGES)
  .map(([path, desc]) => `- ${path} — ${desc}`)
  .join("\n");

const AddToCartInput = z.object({
  productId: z
    .string()
    .describe(
      "The id of the product to add. Comes from a product the customer just saw, or the currently viewed product.",
    ),
  productName: z
    .string()
    .describe(
      "Display name of the product. Shown to the customer in the approval prompt so they can see what's about to be added before they confirm.",
    ),
  brand: z.string().describe("The brand name of the product."),
  price: z
    .number()
    .describe(
      "The price of one item. Copy it from a tool result or the product in your context.",
    ),
  imageUrl: z
    .string()
    .describe(
      "The image URL of the product. Copy it from a tool result or the product in your context.",
    ),
  size: z
    .string()
    .describe(
      'Size variation (e.g. "9", "10"). Must be an in-stock variation. Do not call this tool without a size — if the customer did not pick one, ask them first.',
    ),
  color: z
    .string()
    .describe(
      'Color variation (e.g. "Black", "Red"). Must be an in-stock variation. Do not call this tool without a color — if the customer did not pick one, ask them first.',
    ),
  quantity: z
    .number()
    .int()
    .min(1)
    .max(10)
    .describe("How many to add. Default to 1 if not specified."),
});

type Variations = {
  productName: string;
  variations: Array<{ size: string; color: string; quantity: number }>;
};

/** Suggestion pills for each page, so each surface is easy to try. */
function suggestionsFor(pathname: string) {
  if (pathname === "/") {
    return [
      {
        title: "Cheap running shoes",
        message: "Show me running shoes under $100",
      },
      { title: "Top rated", message: "Show me your top rated products" },
      {
        title: "Featured again",
        message: "Show the featured products again",
      },
    ];
  }
  if (pathname.startsWith("/products/")) {
    return [
      {
        title: "Cheaper alternatives",
        message: "Show me cheaper alternatives to this product",
      },
      {
        title: "Same brand",
        message: "Show me other products from this brand",
      },
      {
        title: "Sizes and colors",
        message: "What sizes and colors are there?",
      },
    ];
  }
  if (pathname === "/cart") {
    return [
      {
        title: "Goes with my cart",
        message: "Suggest products that go well with my cart",
      },
      { title: "Under $50", message: "Suggest products under $50" },
      {
        title: "Show my cart differently",
        message: "Show my cart items differently, with their descriptions",
      },
    ];
  }
  return [
    { title: "Take me to my cart", message: "Take me to my cart" },
    { title: "Hiking shoes", message: "Do you have hiking shoes?" },
  ];
}

/**
 * The shopping assistant: a chat popup on every page, the browser tools it
 * can call, and the context it reads. It renders products into the
 * generative UI surfaces of the page (see shopUI).
 */
export function ShopAssistant() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const cart = useCart();

  useAgentContext({
    description: "The page the customer is on",
    value: { path: pathname },
  });
  useAgentContext({
    description: "The customer's shopping cart",
    value: {
      items: cart.items.map(({ productId, name, size, color, quantity }) => ({
        productId,
        name,
        size,
        color,
        quantity,
      })),
      total: cart.total,
    },
  });

  useConfigureSuggestions(
    { available: "always", suggestions: suggestionsFor(pathname) },
    [pathname],
  );

  useFrontendTool(
    {
      name: "navigateTo",
      description:
        'Take the customer to a page in the EpicStore site. Use this when they ask to go somewhere — for example "take me to the cart", "show me all products", "go back home", "open the about page".',
      parameters: z.object({
        destination: z
          .enum(Object.keys(NAVIGABLE_PAGES) as [Destination, ...Destination[]])
          .describe(
            `Which page to take the customer to. Pick one of:\n${destinationDoc}`,
          ),
      }),
      handler: async ({ destination }) => {
        await navigate(destination);
        return { destination };
      },
    },
    [navigate],
  );

  useHumanInTheLoop(
    {
      name: "addToCart",
      description:
        "Add a product to the customer's shopping cart. Use this only when (a) the customer explicitly asks to add something AND (b) you know both the size and color from the customer. If size or color is missing, call `showVariations` first so the customer can see the table and pick — do not call addToCart with guessed values. The customer will see what is about to be added and click Yes or No before this tool actually runs.",
      parameters: AddToCartInput,
      render: ({ args, status, respond, result }) => {
        if (status === "complete") {
          return (
            <div className="my-2 text-xs text-gray-500 italic dark:text-gray-400">
              {result?.includes('"added":true')
                ? "✅ Added to your cart."
                : "❌ Cancelled — not added."}
            </div>
          );
        }
        return (
          <div className="my-2 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950">
            <div className="mb-1 text-sm font-medium text-gray-900 dark:text-gray-100">
              🛒 Add to cart?
            </div>
            <div className="mb-3 text-xs text-gray-700 dark:text-gray-300">
              <div>{args.productName ?? "this product"}</div>
              <div className="mt-1 opacity-75">
                size {args.size ?? "–"} · color {args.color ?? "–"} · qty{" "}
                {args.quantity ?? 1}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={!respond}
                onClick={async () => {
                  if (status !== "executing") return;
                  cart.addItem({
                    productId: args.productId,
                    name: args.productName,
                    brand: args.brand,
                    price: args.price,
                    imageUrl: args.imageUrl,
                    size: args.size,
                    color: args.color,
                    quantity: args.quantity,
                  });
                  await respond({ added: true });
                }}
                className="rounded bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                Yes, add it
              </button>
              <button
                type="button"
                disabled={!respond}
                onClick={() =>
                  void respond?.({ added: false, cancelled: true })
                }
                className="rounded bg-gray-300 px-3 py-1 text-xs font-medium text-gray-800 hover:bg-gray-400 disabled:opacity-50 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600"
              >
                No, cancel
              </button>
            </div>
          </div>
        );
      },
    },
    [cart],
  );

  // showVariations runs on the server. Its result renders as a stock table.
  useRenderTool(
    {
      name: "showVariations",
      parameters: z.object({ productId: z.string() }),
      render: ({ status, result }) => {
        if (status !== "complete") {
          return (
            <div className="my-1 text-xs text-gray-500 italic">
              Looking up sizes and colors…
            </div>
          );
        }
        return <VariationsTable data={parseVariations(result)} />;
      },
    },
    [],
  );

  return (
    <CopilotPopup
      labels={{
        modalHeaderTitle: "Shopping Assistant",
        welcomeMessageText:
          "👋 Hi! Ask me about products, or tell me where you'd like to go.",
        chatInputPlaceholder: "Ask about products or where to go...",
      }}
    />
  );
}

function parseVariations(result: unknown): Variations | null {
  try {
    const value = typeof result === "string" ? JSON.parse(result) : result;
    return Array.isArray(value?.variations) ? (value as Variations) : null;
  } catch {
    return null;
  }
}

function VariationsTable({ data }: { data: Variations | null }) {
  if (!data) return null;
  const { variations } = data;
  const sizes = Array.from(new Set(variations.map((v) => v.size)));
  const colors = Array.from(new Set(variations.map((v) => v.color)));
  const find = (size: string, color: string) =>
    variations.find((v) => v.size === size && v.color === color)?.quantity;
  return (
    <div className="my-2">
      <div className="mb-1 text-xs font-medium text-gray-800 dark:text-gray-100">
        Variations for {data.productName}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="border-b border-stone-200 dark:border-gray-700">
              <th className="px-2 py-1 text-left font-medium text-gray-600 dark:text-gray-400">
                Size
              </th>
              {colors.map((c) => (
                <th
                  key={c}
                  className="px-2 py-1 text-left font-medium text-gray-600 dark:text-gray-400"
                >
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sizes.map((s) => (
              <tr
                key={s}
                className="border-b border-stone-100 dark:border-gray-800"
              >
                <td className="px-2 py-1 font-medium text-gray-800 dark:text-gray-100">
                  {s}
                </td>
                {colors.map((c) => {
                  const qty = find(s, c);
                  return (
                    <td
                      key={c}
                      className={
                        qty === undefined
                          ? "px-2 py-1 text-gray-400"
                          : qty === 0
                            ? "px-2 py-1 text-gray-400 line-through"
                            : "px-2 py-1 text-emerald-700 dark:text-emerald-400"
                      }
                    >
                      {qty ?? "—"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
