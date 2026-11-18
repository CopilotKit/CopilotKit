"use client";
import { useCallback, useMemo, useState } from "react";
import { findProduct } from "./products";

export const COUPON_CODE = "SAVE10";

export function useCart() {
  const [lines, setLines] = useState<Record<string, number>>({});
  const [coupon, setCoupon] = useState<string | null>(null);

  const addItem = useCallback((productId: string, quantity = 1) => {
    if (!findProduct(productId))
      throw new Error(`Unknown product "${productId}"`);
    setLines((current) => ({
      ...current,
      [productId]: (current[productId] ?? 0) + quantity,
    }));
  }, []);

  const removeItem = useCallback((productId: string) => {
    setLines(({ [productId]: _removed, ...rest }) => rest);
  }, []);

  const applyCoupon = useCallback((code: string) => {
    if (code.trim().toUpperCase() !== COUPON_CODE)
      throw new Error(`Coupon "${code}" is not valid`);
    setCoupon(COUPON_CODE);
  }, []);

  return useMemo(() => {
    const items = Object.entries(lines).map(([productId, quantity]) => ({
      productId,
      quantity,
      name: findProduct(productId)?.name ?? productId,
      price: findProduct(productId)?.price ?? 0,
    }));
    const subtotal = items.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0,
    );
    const total = Math.round(subtotal * (coupon ? 0.9 : 1) * 100) / 100;
    const count = items.reduce((sum, item) => sum + item.quantity, 0);
    return {
      items,
      count,
      subtotal,
      total,
      coupon,
      addItem,
      removeItem,
      applyCoupon,
    };
  }, [lines, coupon, addItem, removeItem, applyCoupon]);
}

export type Cart = ReturnType<typeof useCart>;
