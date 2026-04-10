import type { LoaderFunctionArgs } from "@remix-run/node";
import { Link, useLoaderData } from "@remix-run/react";
import type { FunctionComponent } from "react";
import type { InventoryRecord } from "~/data/inventoryData";
import { getInventory } from "~/data/inventoryData";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const q = url.searchParams.get("q");
  const items = await getInventory(q);

  return { items };
};

export default function Items() {
  const { items } = useLoaderData<typeof loader>();

  return (
    <div id="itemWrapper">
      {items.map((item) => (
        <ItemCard item={item as InventoryRecord} key={item.id} />
      ))}
    </div>
  );
}

const ItemCard: FunctionComponent<{ item: InventoryRecord }> = ({ item }) => {
  return (
    <Link to={`${item.id}`} className="itemCard">
      <div>
        {/* oxlint-disable-next-line nextjs/no-img-element */}
        <img
          alt={`${item.displayName} avatar`}
          key={item.avatar}
          src={item.avatar}
        />
      </div>

      <div>
        <h2>{item.displayName}</h2>
      </div>

      <div>
        <h4>
          {(item.priceInCents / 100).toLocaleString("en-US", {
            style: "currency",
            currency: "USD",
          })}
        </h4>
      </div>
    </Link>
  );
};
