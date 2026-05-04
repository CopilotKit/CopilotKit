import { ActionFunction } from "@remix-run/node";
import { checkout } from "~/data/cartData";

export const action: ActionFunction = async () => {
  return checkout();
};

export default function Checkout() {
  return <div>Congratulations on your very very real purchase!</div>;
}
