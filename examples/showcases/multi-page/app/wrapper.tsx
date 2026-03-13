import { useCopilotAction, useCopilotReadable } from "@copilotkit/react-core";
import { CartRecord, getCart } from "./data/cartData";
import { getInventory, InventoryRecord } from "./data/inventoryData";
import { FC, ReactNode } from "react";
import { useFetcher, useLoaderData, useNavigate } from "@remix-run/react";
import { getAddress } from "./data/settingsData";

interface WrapperProps {
  items: InventoryRecord[];
  cartItems: CartRecord[];
  address: string | null;
  children: ReactNode;
}

export const loader = async () => {
  const items = await getInventory();
  const cartItems = await getCart();
  const address = await getAddress();

  return {
    items,
    cartItems,
    address,
  };
};

const Wrapper: FC<WrapperProps> = ({ children }: WrapperProps) => {
  const { cartItems, items, address } = useLoaderData<typeof loader>();

  const fetcher = useFetcher();
  const navigate = useNavigate();

  useCopilotReadable({
    description: "All of the available items from the store",
    value: JSON.stringify(items),
  });

  useCopilotReadable({
    description:
      "A list of ids and quantites of items added to the cart. Ids reference the ids in the items list",
    value: JSON.stringify(cartItems),
  });

  useCopilotReadable({
    description: "The users address, if one is configured",
    value: JSON.stringify(address),
  });

  useCopilotAction({
    name: "navigate",
    description: "Navigates to a specific page",
    parameters: [
      {
        name: "route",
        type: "string",
        description: "the path to navigate to",
        required: true,
      },
    ],
    handler: ({ route }) => {
      navigate(route);
    },
  });

  useCopilotAction({
    name: "addToCart",
    description: "Add an item to a cart",
    parameters: [
      {
        name: "quantity",
        type: "number",
        description: "how many of the item to add to the cart",
        required: false,
      },
      {
        name: "itemId",
        type: "string",
        description: "the item of the id to add to the cart",
        required: true,
      },
    ],
    handler: async ({ itemId, quantity = 1 }) => {
      return fetcher.submit(
        { itemId, quantity },
        { method: "post", action: `/items/${itemId}` },
      );
    },
  });

  useCopilotAction({
    name: "setAddress",
    description: "Set the user's address",
    parameters: [
      {
        name: "address",
        type: "string",
        description: "the new address to set",
        required: true,
      },
    ],
    handler: async ({ address }) => {
      return fetcher.submit(
        { address },
        { method: "post", action: "/settings" },
      );
    },
  });

  return children;
};

export default Wrapper;
