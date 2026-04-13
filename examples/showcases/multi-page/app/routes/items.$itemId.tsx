import { Form, redirect, useLoaderData } from "@remix-run/react";
import type { ActionFunction, LoaderFunctionArgs } from "@remix-run/node";
import invariant from "tiny-invariant";

import { useState } from "react";

import { getItem } from "../data/inventoryData";
import { addToCart, getCartItem } from "../data/cartData";

export const action: ActionFunction = async ({ request, params }) => {
  const itemId = params.itemId;
  invariant(itemId, "itemId param missing");
  const formData = await request.formData();

  const quantity = Number(formData.get("quantity"));

  addToCart({ itemId, quantity });

  return redirect("/cart");
};

export const loader = async ({ params }: LoaderFunctionArgs) => {
  invariant(params.itemId, "Missing itemId param");

  const item = await getItem(params.itemId);
  if (!item) {
    throw new Response("Not Found", { status: 404 });
  }
  const cartItem = await getCartItem(params.itemId);

  return { item, cartItem };
};

export default function Item() {
  const { item, cartItem } = useLoaderData<typeof loader>();
  const [quantity, setQuantity] = useState<number>(1);

  const cartQuantity = cartItem?.quantity || 0;
  return (
    <div id="item">
      <div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt={`${item.displayName} avatar`}
          key={item.avatar}
          src={item.avatar}
        />
      </div>

      <div>
        <h1>{item.displayName}</h1>

        {item.description ? <p>{item.description}</p> : null}

        <div>
          <p>You have {cartQuantity} in your cart</p>
          <Form method="post">
            <input
              name="quantity"
              min="1"
              value={quantity}
              type="number"
              onChange={(event) => {
                console.log(
                  quantity,
                  event.target.value,
                  event.target.value.replace(/\D/, ""),
                );
                const clean = event.target.value.replace(/\D/, "").trim();
                if (!clean) {
                  setQuantity(() => quantity);
                } else {
                  setQuantity(() =>
                    parseInt(event.target.value.replace(/\D/, ""), 10),
                  );
                }
              }}
            />
            <button type="submit">Add To Cart</button>
          </Form>
        </div>
      </div>
    </div>
  );
}
