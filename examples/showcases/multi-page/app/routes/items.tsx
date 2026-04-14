import type { LoaderFunctionArgs } from "@remix-run/node";

import { Outlet, useLoaderData, useNavigation } from "@remix-run/react";

import { useEffect } from "react";

import { getInventory } from "../data/inventoryData";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const q = url.searchParams.get("q");
  const items = await getInventory(q);

  return { items, q };
};

export default function Items() {
  const { q } = useLoaderData<typeof loader>();
  const navigation = useNavigation();

  const searching = navigation.location && new URLSearchParams(navigation.location.search).has("q");

  useEffect(() => {
    const searchField = document.getElementById("q");
    if (searchField instanceof HTMLInputElement) {
      searchField.value = q || "";
    }
  }, [q]);

  return (
    <div className={navigation.state === "loading" && !searching ? "loading" : ""}>
      <Outlet />
    </div>
  );
}
