import { Form, Link, useLoaderData } from "@remix-run/react";
import { checkout, getCart, removeItem } from "~/data/cartData";
import type { CartRecord } from "~/data/cartData";
import { getAll } from "~/data/inventoryData";
import type { InventoryRecord } from "~/data/inventoryData";

import type { FunctionComponent } from "react";
import invariant from "tiny-invariant";
import type { ActionFunction } from "@remix-run/node";
import { redirect } from "@remix-run/node";
import { getAddress } from "~/data/settingsData";
import { useCopilotReadable } from "@copilotkit/react-core";

export const loader = async () => {
  const [cartItems, allInventory, address] = await Promise.all([
    getCart(),
    getAll(),
    getAddress(),
  ]);

  return { cartItems, allInventory, address };
};

export const action: ActionFunction = async ({ request }) => {
  const formData = await request.formData();
  const _action = formData.get("_action");

  switch (_action) {
    case "updateItem": {
      // do cart logic
      break;
    }
    case "removeItem": {
      const itemId = formData.get("itemId");
      invariant(itemId, "missing itemId to remove");
      return removeItem(itemId.toString());
      break;
    }
    case "checkout": {
      await checkout();

      return redirect("/checkoutComplete");
    }
    default:
      throw new Error("Unknown action");
  }
};

const CartRow: FunctionComponent<{
  cartItem: CartRecord;
  allInventory: Record<string, InventoryRecord>;
}> = ({ cartItem, allInventory }) => {
  const inventoryItem = allInventory[cartItem.itemId];
  invariant(inventoryItem, "item not found in inventory");
  const quantity = cartItem.quantity;
  const priceInCents = inventoryItem.priceInCents;
  const multipliedPrice = quantity * priceInCents;

  return (
    <tr>
      <td>{inventoryItem.displayName}</td>
      <td>{cartItem.quantity}</td>
      <td>
        {(inventoryItem.priceInCents / 100).toLocaleString("en-US", {
          style: "currency",
          currency: "USD",
        })}
      </td>
      <td>
        {(multipliedPrice / 100).toLocaleString("en-US", {
          style: "currency",
          currency: "USD",
        })}
      </td>
      <td>
        <Form method="post">
          <input type="hidden" name="_action" value="removeItem" />
          <input type="hidden" name="itemId" value={cartItem.itemId} />
          <button type="submit">Remove from Cart</button>
        </Form>
      </td>
    </tr>
  );
};

const CheckoutButton: FunctionComponent<{
  address: string | null;
}> = ({ address }) => {
  if (!address) {
    return (
      <Link to="/settings">
        <button>Add your address</button>
      </Link>
    );
  }
  return (
    <Form method="post">
      <input name="_action" type="hidden" value="checkout" />
      <button type="submit">Checkout</button>
    </Form>
  );
};

export default function Cart() {
  const { cartItems, allInventory, address } = useLoaderData<typeof loader>();

  useCopilotReadable({
    description: "A map of item Ids and their quantities in the cart",
    value: JSON.stringify(cartItems),
  });

  const total = Object.values(cartItems).reduce((total, cartItem) => {
    const inventoryItem = allInventory[cartItem.itemId];
    invariant(inventoryItem, "item not found in inventory");
    const quantity = cartItem.quantity;
    const priceInCents = inventoryItem.priceInCents;
    const multipliedPrice = quantity * priceInCents;

    return total + multipliedPrice;
  }, 0);

  if (!Object.keys(cartItems).length) {
    return (
      <div>
        <div>Your cart is empty!</div>
        <div>
          <Link to="/items">
            <button>Go buy something!</button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <table id="cart">
        <thead key="head">
          <td>Item</td>
          <td>Quantity</td>
          <td>Price each</td>
          <td>Applied Price</td>
          {/* space for remove button*/}
          <td />
        </thead>
        {cartItems.map((cartItem) => (
          <CartRow
            key={cartItem.itemId}
            cartItem={cartItem as CartRecord}
            allInventory={allInventory as Record<string, InventoryRecord>}
          />
        ))}

        <tr>
          <td />
          <td />
          <td>Total:</td>
          <td>
            {(total / 100).toLocaleString("en-US", {
              style: "currency",
              currency: "USD",
            })}
          </td>
        </tr>

        <tfoot>
          <td />
          <td />
          <td />
          <td>
            <CheckoutButton address={address} />
          </td>
        </tfoot>
      </table>
    </div>
  );
}
