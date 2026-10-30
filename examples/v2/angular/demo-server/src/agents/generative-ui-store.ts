import { createRequire } from "node:module";
import { AbstractAgent, EventType } from "@ag-ui/client";
import type { BaseEvent, RunAgentInput } from "@ag-ui/client";
import { Observable } from "rxjs";
import type * as CatalogOperations from "../../../../../../showcase/shared/generative-ui-catalog/operations.js";
import type * as CatalogSamples from "../../../../../../showcase/shared/generative-ui-catalog/samples.js";

// The shared samples sit under the root package.json, which has no
// "type": "module", so tsx loads them as CommonJS and an ES import does not
// see their named exports.
const require = createRequire(import.meta.url);
const { sampleOperations } =
  require("../../../../../../showcase/shared/generative-ui-catalog/operations.js") as typeof CatalogOperations;
const { SAMPLES } =
  require("../../../../../../showcase/shared/generative-ui-catalog/samples.js") as typeof CatalogSamples;

// The server emits the surface activity itself, the way the runtime's
// generative UI middleware does for a model's render_ui tool call, so the
// demo needs no API key. The catalog is `shopUI` of the demo app: the
// standard catalog plus ProductCard and CartSummary.
const SURFACE_ACTIVITY_TYPE = "generative-ui-surface";
const SHOP_CATALOG_ID = "copilotkit/demo-shop@1";

const SIZES = ["S", "M", "L"].map((size) => ({ label: size, value: size }));

const PRODUCTS = [
  { id: "p1", name: "Trail Runner", price: 129, stock: 14 },
  { id: "p2", name: "City Sneaker", price: 89, stock: 3 },
  { id: "p3", name: "Alpine Boot", price: 219, stock: 7 },
];

const STORES = [
  { label: "Vienna, Mariahilfer Straße", lat: 48.199, lng: 16.353 },
  { label: "Graz, Herrengasse", lat: 47.07, lng: 15.439 },
  { label: "Linz, Landstraße", lat: 48.303, lng: 14.29 },
];

/** The product the store surface offers to add. */
const FEATURED = PRODUCTS[0];

function lastUserText(input: RunAgentInput): string {
  const message = [...input.messages]
    .toReversed()
    .find((m) => m.role === "user");
  return typeof message?.content === "string" ? message.content : "";
}

/** The A2UI user action of a generative UI event, from the run's envelope. */
function actionOf(input: RunAgentInput) {
  const props = input.forwardedProps as Record<string, unknown> | undefined;
  const ui = (props?.copilotkit as { ui?: Record<string, unknown> } | undefined)
    ?.ui;
  const metadata = ui?.metadata as
    | { extensions?: { copilotkit_action?: { action?: unknown } } }
    | undefined;
  return metadata?.extensions?.copilotkit_action?.action as
    | { name: string; context?: Record<string, unknown> }
    | undefined;
}

/** The store surface: a Card with a title, a chart, a table and buttons. */
function storeOperations(surfaceId: string): unknown[] {
  return [
    {
      version: "v1.0",
      createSurface: { surfaceId, catalogId: SHOP_CATALOG_ID },
    },
    {
      version: "v1.0",
      updateDataModel: { surfaceId, path: "/", value: { name: "" } },
    },
    {
      version: "v1.0",
      updateComponents: {
        surfaceId,
        components: [
          {
            id: "root",
            component: "Card",
            children: ["title", "intro", "chart", "table", "name", "actions"],
          },
          { id: "title", component: "Title", text: "Autumn running shoes" },
          {
            id: "intro",
            component: "Text",
            text: "Sales of the last four weeks, the stock, and a few things you can do. Every component here is a native Angular component.",
          },
          {
            id: "chart",
            component: "Chart",
            title: "Pairs sold per week",
            chartType: "bar",
            xKey: "week",
            data: [
              { week: "W1", sold: 12 },
              { week: "W2", sold: 19 },
              { week: "W3", sold: 15 },
              { week: "W4", sold: 24 },
            ],
            series: [{ key: "sold", label: "Pairs sold" }],
            showValueLabels: true,
          },
          {
            id: "table",
            component: "Table",
            caption: "Products in stock",
            columns: ["Product", "Price", "Stock"],
            rows: PRODUCTS.map((p) => [p.name, `$${p.price}`, p.stock]),
          },
          {
            id: "name",
            component: "TextField",
            label: "Your name for the order",
            value: { "@path": "/name" },
            placeholder: "Jane",
          },
          {
            id: "actions",
            component: "Row",
            children: ["add", "stock", "where"],
          },
          {
            id: "add",
            component: "Button",
            label: `Add ${FEATURED.name} to cart`,
            variant: "primary",
            onClick: {
              event: {
                name: "add_to_cart",
                userMessage: `Add the ${FEATURED.name} to my cart`,
                context: { productId: FEATURED.id, name: { "@path": "/name" } },
              },
            },
          },
          {
            id: "stock",
            component: "Button",
            label: "Check stock",
            onClick: {
              event: {
                name: "check_stock",
                userMessage: "Check the stock",
              },
            },
          },
          {
            id: "where",
            component: "Button",
            label: "Where to buy",
            onClick: {
              event: {
                name: "show_stores",
                userMessage: "Where can I buy them?",
              },
            },
          },
        ],
      },
    },
  ];
}

/**
 * The stores surface, rendered into the page's `side` target: a Map with a
 * marker per store. The selected marker is bound to the data model, so the
 * button sends the choice back as event context.
 */
function storesOperations(surfaceId: string): unknown[] {
  return [
    {
      version: "v1.0",
      createSurface: { surfaceId, catalogId: SHOP_CATALOG_ID },
    },
    {
      version: "v1.0",
      updateDataModel: { surfaceId, path: "/", value: { store: "" } },
    },
    {
      version: "v1.0",
      updateComponents: {
        surfaceId,
        components: [
          {
            id: "root",
            component: "Card",
            children: ["title", "map", "hint", "pickup"],
          },
          { id: "title", component: "Title", text: "Stores with these shoes" },
          {
            id: "map",
            component: "Map",
            markers: STORES,
            selected: { "@path": "/store" },
            height: 260,
            zoom: 7,
          },
          {
            id: "hint",
            component: "Text",
            text: "Pick a store on the map, then reserve your order there.",
          },
          {
            id: "pickup",
            component: "Button",
            label: "Reserve for pickup",
            variant: "primary",
            onClick: {
              event: {
                name: "pickup",
                userMessage: "Reserve my order for pickup",
                context: { store: { "@path": "/store" } },
              },
            },
          },
        ],
      },
    },
  ];
}

/**
 * The shop: a form bound to the data model, a ProductCard per product (an
 * app component that calls the app's `addToCart` function) and the
 * CartSummary bound to the app's cart state. Buying changes the UI
 * without the agent; checkout comes back here as an event.
 */
function shopOperations(surfaceId: string): unknown[] {
  return [
    {
      version: "v1.0",
      createSurface: { surfaceId, catalogId: SHOP_CATALOG_ID },
    },
    {
      version: "v1.0",
      updateDataModel: {
        surfaceId,
        path: "/",
        value: { size: "M", gift: false },
      },
    },
    {
      version: "v1.0",
      updateComponents: {
        surfaceId,
        components: [
          {
            id: "root",
            component: "Card",
            children: ["title", "intro", "form", "products", "cart"],
          },
          { id: "title", component: "Title", text: "Build your order" },
          {
            id: "intro",
            component: "Text",
            text: "Pick a size and gift wrap, set a quantity on a shoe and add it. The cart is state of the app, so it changes at once.",
          },
          { id: "form", component: "Row", gap: 3, children: ["size", "gift"] },
          {
            id: "size",
            component: "Select",
            label: "Size",
            value: { "@path": "/size" },
            options: SIZES,
          },
          {
            id: "gift",
            component: "CheckBox",
            label: "Gift wrap",
            value: { "@path": "/gift" },
          },
          {
            id: "products",
            component: "Row",
            gap: 3,
            wrap: "wrap",
            children: PRODUCTS.map((p) => `card-${p.id}`),
          },
          ...PRODUCTS.map((p) => ({
            id: `card-${p.id}`,
            component: "ProductCard",
            productId: p.id,
            name: p.name,
            price: p.price,
            image: `https://picsum.photos/seed/${p.id}/320/240`,
            size: { "@path": "/size" },
            gift: { "@path": "/gift" },
            onAddToCart: { event: { name: "addToCart" } },
          })),
          {
            id: "cart",
            component: "CartSummary",
            onCheckout: {
              event: { name: "checkout", userMessage: "Check out my cart" },
            },
          },
        ],
      },
    },
  ];
}

/**
 * A surface with mistakes in it, as a model makes them: a component the
 * catalog does not have, a prop of the wrong type, a value outside the enum.
 * Each one shows a local fallback; the rest of the surface renders. The
 * activity also carries a rejected operation, which the chat card notes.
 */
function errorsOperations(surfaceId: string): unknown[] {
  return [
    {
      version: "v1.0",
      createSurface: { surfaceId, catalogId: SHOP_CATALOG_ID },
    },
    {
      version: "v1.0",
      updateDataModel: { surfaceId, path: "/", value: { count: 42 } },
    },
    {
      version: "v1.0",
      updateComponents: {
        surfaceId,
        components: [
          {
            id: "root",
            component: "Card",
            children: ["title", "intro", "badbound", "ok"],
          },
          {
            id: "title",
            component: "Title",
            text: "When the agent gets it wrong",
          },
          {
            id: "intro",
            component: "Text",
            text: "The badge below is bound to a number where it needs text: it shows a local fallback and the rest renders. A second operation with a component the catalog does not have was rejected: the chat card says so.",
          },
          { id: "badbound", component: "Badge", label: { "@path": "/count" } },
          { id: "ok", component: "Badge", label: "Still fine" },
        ],
      },
    },
    {
      version: "v1.0",
      updateComponents: {
        surfaceId,
        components: [
          { id: "unknown", component: "Widget", text: "not in the catalog" },
        ],
      },
    },
  ];
}

/**
 * A scripted agent for the native generative UI demo. It renders the store
 * surface with the standard catalog and answers the events of its surfaces.
 * No API key needed.
 */
export class GenerativeUIStoreAgent extends AbstractAgent {
  constructor() {
    super({ agentId: "generative-ui" });
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable((observer) => {
      const emit = (event: Record<string, unknown>) =>
        observer.next(event as BaseEvent);
      const say = (text: string) => {
        const messageId = crypto.randomUUID();
        emit({
          type: EventType.TEXT_MESSAGE_START,
          messageId,
          role: "assistant",
        });
        emit({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta: text });
        emit({ type: EventType.TEXT_MESSAGE_END, messageId });
      };
      const render = (
        surfaceId: string,
        operations: unknown[],
        target: string = "chat",
        rejected: { index: number; reason: string }[] = [],
      ) =>
        emit({
          type: EventType.ACTIVITY_SNAPSHOT,
          // One activity message per surface, as the middleware names them.
          messageId: `genui:${surfaceId}`,
          activityType: SURFACE_ACTIVITY_TYPE,
          content: {
            surfaceId,
            target,
            catalogId: SHOP_CATALOG_ID,
            operations,
            status: "ready",
            rejected,
          },
        });

      emit({
        type: EventType.RUN_STARTED,
        threadId: input.threadId,
        runId: input.runId,
      });

      const action = actionOf(input);
      const text = lastUserText(input).toLowerCase();
      if (!action && /everything|catalog/.test(text)) {
        // One surface per sample: each sample has its own ids and data model.
        SAMPLES.forEach((sample, index) => {
          const surfaceId = `catalog-${input.runId}-${index}`;
          render(
            surfaceId,
            sampleOperations(sample, surfaceId, SHOP_CATALOG_ID),
          );
        });
        say(
          "Every component of the standard catalog, rendered natively in Angular.",
        );
      } else if (!action && /error|broken|wrong/.test(text)) {
        const surfaceId = `errors-${input.runId}`;
        render(surfaceId, errorsOperations(surfaceId), "chat", [
          { index: 3, reason: 'unknown component "Widget"' },
        ]);
        say(
          "A surface with mistakes in it: a prop bound to the wrong type, and an operation with an unknown component. Each stays local.",
        );
      } else if (!action && /shop|cart|order/.test(text)) {
        const surfaceId = `shop-${input.runId}`;
        render(surfaceId, shopOperations(surfaceId));
        say(
          "Here is the shop. Adding a pair changes the cart right away; it is state of the app, not of me.",
        );
      } else if (action?.name === "checkout") {
        const order = String(action.context?.order ?? "").trim();
        const total = Number(action.context?.total ?? 0);
        say(
          order
            ? `Order placed: ${order} for $${total}. Thanks!`
            : "Your cart is empty. Add a pair first.",
        );
      } else if (action?.name === "add_to_cart") {
        const product = PRODUCTS.find(
          (p) => p.id === action.context?.productId,
        );
        const name = String(action.context?.name ?? "").trim();
        say(
          !product
            ? "That product is not in the store."
            : name
              ? `Added the ${product.name} to the cart for ${name}.`
              : `Added the ${product.name} to the cart. Tip: type your name in the field first.`,
        );
      } else if (action?.name === "check_stock") {
        const low = PRODUCTS.filter((p) => p.stock < 5).map((p) => p.name);
        say(
          low.length
            ? `Low stock: ${low.join(", ")}. Everything else is fine.`
            : "Everything is in stock.",
        );
      } else if (action?.name === "show_stores") {
        render(
          `stores-${input.runId}`,
          storesOperations(`stores-${input.runId}`),
          "side",
        );
        say(
          "Three stores have them; they are on the map next to the chat. Pick one and I will hold your order there.",
        );
      } else if (action?.name === "pickup") {
        const store = String(action.context?.store ?? "").trim();
        say(
          store
            ? `Reserved for pickup at ${store}. It will be ready tomorrow.`
            : "Pick a store on the map first.",
        );
      } else {
        render(`store-${input.runId}`, storeOperations(`store-${input.runId}`));
        say(
          "Here is the store. The field is bound to the data model; the buttons send events back to me.",
        );
      }

      emit({
        type: EventType.RUN_FINISHED,
        threadId: input.threadId,
        runId: input.runId,
      });
      observer.complete();
    });
  }
}
