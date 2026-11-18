import { redirect } from "@remix-run/node";
import type { LoaderFunction } from "@remix-run/node";

export const loader: LoaderFunction = () => {
  return redirect("/items");
};

export default function Index() {
  return null;
}
