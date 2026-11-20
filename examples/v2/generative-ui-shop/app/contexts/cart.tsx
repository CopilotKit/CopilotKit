import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";

export type CartItem = {
  productId: string;
  name: string;
  brand: string;
  price: number;
  imageUrl: string;
  size: string;
  color: string;
  quantity: number;
};

type CartContextValue = {
  items: CartItem[];
  itemCount: number;
  total: number;
  addItem: (item: Omit<CartItem, "quantity"> & { quantity?: number }) => void;
  updateQuantity: (id: string, quantity: number) => void;
  removeItem: (id: string) => void;
  clear: () => void;
  getItemId: (item: Pick<CartItem, "productId" | "size" | "color">) => string;
};

const CartContext = createContext<CartContextValue | null>(null);

const STORAGE_KEY = "epicstore.cart.v1";

const itemKey = ({
  productId,
  size,
  color,
}: Pick<CartItem, "productId" | "size" | "color">) =>
  `${productId}::${size}::${color}`;

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) setItems(JSON.parse(raw) as CartItem[]);
    } catch {
      // ignore — fall back to empty cart
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      // ignore — storage may be unavailable
    }
  }, [items]);

  const addItem = useCallback<CartContextValue["addItem"]>((item) => {
    const quantity = item.quantity ?? 1;
    setItems((prev) => {
      const id = itemKey(item);
      const existing = prev.find((p) => itemKey(p) === id);
      if (existing) {
        return prev.map((p) =>
          itemKey(p) === id ? { ...p, quantity: p.quantity + quantity } : p,
        );
      }
      return [...prev, { ...item, quantity }];
    });
  }, []);

  const updateQuantity = useCallback<CartContextValue["updateQuantity"]>(
    (id, quantity) => {
      setItems((prev) =>
        quantity <= 0
          ? prev.filter((p) => itemKey(p) !== id)
          : prev.map((p) => (itemKey(p) === id ? { ...p, quantity } : p)),
      );
    },
    [],
  );

  const removeItem = useCallback<CartContextValue["removeItem"]>((id) => {
    setItems((prev) => prev.filter((p) => itemKey(p) !== id));
  }, []);

  const clear = useCallback(() => setItems([]), []);

  const value = useMemo<CartContextValue>(() => {
    const itemCount = items.reduce((sum, p) => sum + p.quantity, 0);
    const total = items.reduce((sum, p) => sum + p.price * p.quantity, 0);
    return {
      items,
      itemCount,
      total,
      addItem,
      updateQuantity,
      removeItem,
      clear,
      getItemId: itemKey,
    };
  }, [items, addItem, updateQuantity, removeItem, clear]);

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used inside <CartProvider>");
  return ctx;
}
