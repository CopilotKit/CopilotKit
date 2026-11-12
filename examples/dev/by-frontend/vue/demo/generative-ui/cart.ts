import { computed, ref } from "vue";
import { findProduct } from "./products";

export const COUPON_CODE = "SAVE10";

/**
 * The cart of the store page. It lives in the app, not in the agent:
 * generated UI reads it through the `cart` state and changes it through the
 * `addToCart` and `applyCoupon` functions.
 */
export function useCart() {
  const lines = ref<Record<string, number>>({});
  const coupon = ref<string | null>(null);

  const items = computed(() =>
    Object.entries(lines.value).map(([productId, quantity]) => ({
      productId,
      quantity,
      name: findProduct(productId)?.name ?? productId,
      price: findProduct(productId)?.price ?? 0,
    })),
  );
  const subtotal = computed(() =>
    items.value.reduce((sum, item) => sum + item.price * item.quantity, 0),
  );
  const total = computed(
    () => Math.round(subtotal.value * (coupon.value ? 0.9 : 1) * 100) / 100,
  );
  const count = computed(() =>
    items.value.reduce((sum, item) => sum + item.quantity, 0),
  );

  function addItem(productId: string, quantity: number) {
    if (!findProduct(productId))
      throw new Error(`Unknown product "${productId}"`);
    lines.value = {
      ...lines.value,
      [productId]: (lines.value[productId] ?? 0) + quantity,
    };
  }

  function removeItem(productId: string) {
    const rest = { ...lines.value };
    delete rest[productId];
    lines.value = rest;
  }

  function applyCoupon(code: string) {
    if (code.trim().toUpperCase() !== COUPON_CODE)
      throw new Error(`Coupon "${code}" is not valid`);
    coupon.value = COUPON_CODE;
  }

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
}
