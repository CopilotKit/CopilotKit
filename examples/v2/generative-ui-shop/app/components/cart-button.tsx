import { ShoppingCart } from "lucide-react";
import { Link } from "react-router";
import { useCart } from "#app/contexts/cart.js";

export function CartButton() {
  const { itemCount } = useCart();
  return (
    <Link
      to="/cart"
      aria-label={`Cart with ${itemCount} ${itemCount === 1 ? "item" : "items"}`}
      className="relative inline-flex items-center p-2 text-gray-700 transition-colors duration-300 hover:text-amber-600 dark:text-gray-300 dark:hover:text-amber-500"
    >
      <ShoppingCart className="h-5 w-5" />
      {itemCount > 0 ? (
        <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-600 px-1 text-[10px] font-semibold text-white">
          {itemCount > 99 ? "99+" : itemCount}
        </span>
      ) : null}
    </Link>
  );
}
