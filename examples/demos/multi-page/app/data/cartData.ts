// @ts-expect-error - no types, but it's a tiny function
import sortBy from "sort-by";
import invariant from "tiny-invariant";

export type CartRecord = {
  itemId: string;
  quantity: number;
};

const fakeCart = {
  records: {} as Record<string, CartRecord>,

  async getAll(): Promise<CartRecord[]> {
    return Object.keys(fakeCart.records)
      .map((key) => fakeCart.records[key])
      .sort(sortBy("-itemId", "last"));
  },

  async get(id: string): Promise<CartRecord | null> {
    return fakeCart.records[id] || null;
  },

  async addToCart(id: string, quantity: number): Promise<CartRecord> {
    invariant(quantity > 0, "quantity to add must be > 0");
    const existing = await fakeCart.get(id);
    const previous = existing?.quantity || 0;
    const newRecord = { itemId: id, quantity: previous + quantity };
    fakeCart.records[id] = newRecord;
    return newRecord;
  },

  async updateQuantity(
    id: string,
    quantity: number,
  ): Promise<CartRecord | null> {
    invariant(quantity >= 0, "quantity must be >= 0");
    if (quantity == 0) {
      return fakeCart.removeItem(id);
    }
    const newRecord = { itemId: id, quantity: quantity };
    fakeCart.records[id] = newRecord;
    return newRecord;
  },

  removeItem(id: string): null {
    delete fakeCart.records[id];
    return null;
  },
};

export async function getCartItem(id: string) {
  return fakeCart.get(id);
}

export async function getCart() {
  await new Promise((resolve) => setTimeout(resolve, 500));
  const items = await fakeCart.getAll();
  return items.sort(sortBy("displayName"));
}

export async function addToCart(item: CartRecord) {
  return fakeCart.addToCart(item.itemId, item.quantity);
}

export async function checkout() {
  fakeCart.records = {};
}

export async function removeItem(itemId: string) {
  return fakeCart.removeItem(itemId);
}
