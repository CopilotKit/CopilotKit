# Generative UI shop example

A React Router shop (EpicStore) with a shopping assistant. When you ask the
assistant for products, it renders them into areas of the page, outside the
chat. Each area is a `GenerativeUISurface` that only takes the `ProductGrid`
and `ProductCard` components:

| Page            | Surface                | Shows until the agent replaces it |
| --------------- | ---------------------- | --------------------------------- |
| Home            | `featured`             | The featured products             |
| Product details | `recommendations-<id>` | "You Might Also Like"             |
| Cart            | `cart-suggestions`     | "You may also like"               |

```tsx
<GenerativeUISurface
  ui={shopUI}
  id="featured"
  description="The Featured Products section of the home page. ..."
  components={["ProductGrid", "ProductCard"]}
  fallback={<FeaturedProducts />}
/>
```

The agent is a TanStack AI agent (`BuiltInAgent` with `type: 'tanstack'`). It
has server tools that read the catalog from SQLite through Prisma
(`searchProducts`, `getProducts`, and more). The agent copies the product data
from the tool results into the props of each card. The browser does not fetch
product data.

The compare page uses its own TanStack AI chat with structured output. It does
not use CopilotKit.

## Setup

1. Install the dependencies. Run this command from the repo root:

   ```bash
   pnpm install
   ```

2. Build the CopilotKit packages. Run this command from the repo root:

   ```bash
   pnpm nx run-many -t build --projects=@copilotkit/react-core,@copilotkit/runtime
   ```

3. Copy `.env.example` to `.env`, then set `OPENAI_API_KEY` in `.env`.

4. Create and fill the SQLite database. Run this command in this folder:

   ```bash
   pnpm prisma generate && pnpm db:setup
   ```

5. Start the app:

   ```bash
   pnpm example-dev
   ```

6. Open http://localhost:3012.

## Try it

The suggestion pills of the chat change for each page.

1. On the home page, click **Cheap running shoes**. The featured products
   change to the matching shoes. Click **Featured again** to get the featured
   products back.
2. Open a product. Click **Cheaper alternatives**. The "You Might Also Like"
   row changes.
3. Ask for an item, for example "Add size 11 in Black to my cart". Approve it
   in the chat.
4. Ask "Take me to my cart", then click **Goes with my cart**. The "You may
   also like" row changes.
