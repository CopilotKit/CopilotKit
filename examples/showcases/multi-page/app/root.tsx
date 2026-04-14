import type { LinksFunction, LoaderFunctionArgs } from "@remix-run/node";
import { CopilotKit } from "@copilotkit/react-core";

import {
  Form,
  Link,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
  useNavigation,
  useSubmit,
} from "@remix-run/react";

import appStylesHref from "./app.css?url";
// import cpkStylesHref from "@copilotkit/react-ui/styles.css";
// TODO: Max: unsure why this is required to be this odd way, some loaderfoolery
// Actually this broke now too?
// import cpkStylesHref from "node_modules/@copilotkit/react-ui/dist/index.css";
import cpkStylesHref from "./cpk.css?url";

import { getInventory } from "./data/inventoryData";
import { useEffect } from "react";
import { CartRecord, getCart } from "./data/cartData";
import { CopilotPopup } from "@copilotkit/react-ui";
import { getAddress } from "./data/settingsData";
import Wrapper from "./wrapper";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: cpkStylesHref },
  { rel: "stylesheet", href: appStylesHref },
];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const q = url.searchParams.get("q");
  const items = await getInventory(q);
  const cartItems = await getCart();
  const address = await getAddress();

  return {
    items,
    cartItems,
    address,
    q,
    PUBLIC_COPILOT_KIT_PUBLIC_API_KEY: process.env.PUBLIC_COPILOT_KIT_PUBLIC_API_KEY,
  };
};

export default function App() {
  const { cartItems, items, address, q, PUBLIC_COPILOT_KIT_PUBLIC_API_KEY } = useLoaderData<typeof loader>();

  const cartQuantity = Object.values(cartItems as CartRecord[]).reduce((acc, { quantity }) => acc + quantity, 0);

  const navigation = useNavigation();
  const submit = useSubmit();
  const searching = navigation.location && new URLSearchParams(navigation.location.search).has("q");

  useEffect(() => {
    const searchField = document.getElementById("q");
    if (searchField instanceof HTMLInputElement) {
      searchField.value = q || "";
    }
  }, [q]);

  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
        <script
          dangerouslySetInnerHTML={{
            __html: `window.CPKK = ${JSON.stringify(PUBLIC_COPILOT_KIT_PUBLIC_API_KEY)};`,
          }}
        />
      </head>
      <body>
        <CopilotKit publicApiKey={PUBLIC_COPILOT_KIT_PUBLIC_API_KEY}>
          <Wrapper items={items} cartItems={cartItems} address={address}>
            <div id="siteHeader">
              <div>
                <Link to={`/items`}>
                  <button type="button">Home</button>
                </Link>
              </div>
              <div>
                <Form
                  id="search-form"
                  action="items"
                  onChange={(event) => {
                    const isFirstSearch = q === null;
                    submit(event.currentTarget, {
                      replace: !isFirstSearch,
                    });
                  }}
                  role="search"
                >
                  <input
                    defaultValue={q || ""}
                    className={searching ? "loading" : ""}
                    id="q"
                    aria-label="Search items"
                    placeholder="Search"
                    type="search"
                    name="q"
                  />
                  <div hidden={!searching} id="search-spinner" aria-hidden />
                </Form>
              </div>
              <div id="settingsButton">
                <Link to={`/settings`}>
                  <button type="button">{"Settings"}</button>
                </Link>
              </div>
              <div id="cartButton">
                <Link to={`/cart`}>
                  <button type="button">{"Cart" + (cartQuantity ? ` (${cartQuantity} items)` : "")} </button>
                </Link>
              </div>
            </div>
            <div id="detail">
              <Outlet />
            </div>
            <CopilotPopup
              instructions={
                "You are assisting the user as best as you can. Answer in the best way possible given the data you have."
              }
              labels={{
                title: "Popup Assistant",
                initial: "Need any help?",
              }}
            />
            <ScrollRestoration />
            <Scripts />
          </Wrapper>
        </CopilotKit>
      </body>
    </html>
  );
}
