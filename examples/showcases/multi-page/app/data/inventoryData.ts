import { matchSorter } from "match-sorter";
// @ts-expect-error - no types, but it's a tiny function
import sortBy from "sort-by";

export type InventoryRecord = {
  id: string;
  avatar: string;
  displayName: string;
  priceInCents: number;
  description: string;
  createdAt: string;
};

type InventoryMutation = {
  id?: string;
  avatar: string;
  displayName: string;
  priceInCents: number;
  description: string;
};

const fakeInventory = {
  records: {} as Record<string, InventoryRecord>,

  async getAll(): Promise<InventoryRecord[]> {
    return Object.keys(fakeInventory.records)
      .map((key) => fakeInventory.records[key])
      .sort(sortBy("-createdAt", "last"));
  },

  async get(id: string): Promise<InventoryRecord | null> {
    return fakeInventory.records[id] || null;
  },

  async create(values: InventoryMutation): Promise<InventoryRecord> {
    const id = values.id || Math.random().toString(36).substring(2, 9);
    const createdAt = new Date().toISOString();
    const newItem = { id, createdAt, ...values };
    fakeInventory.records[id] = newItem;
    return newItem;
  },
};

////////////////////////////////////////////////////////////////////////////////
// Handful of helper functions to be called from route loaders and actions
export async function getInventory(query?: string | null) {
  await new Promise((resolve) => setTimeout(resolve, 500));
  let items = await fakeInventory.getAll();
  if (query) {
    items = matchSorter(items, query, {
      keys: ["displayName", "description"],
    });
  }
  return items.sort(sortBy("displayName", "createdAt"));
}

export async function getItem(id: string) {
  return fakeInventory.get(id);
}

export async function getAll() {
  await new Promise((resolve) => setTimeout(resolve, 500));
  return fakeInventory.records;
}

[
  {
    avatar: "https://picsum.photos/seed/item1/200",
    displayName: "Vintage Backpack",
    priceInCents: 4999,
    description: "A durable and stylish backpack for everyday use.",
  },
  {
    avatar: "https://picsum.photos/seed/item2/200",
    displayName: "Wireless Headphones",
    priceInCents: 8995,
    description: "Noise-canceling headphones with 30-hour battery life.",
  },
  {
    avatar: "https://picsum.photos/seed/item3/200",
    displayName: "Espresso Machine",
    priceInCents: 24900,
    description: "Brew barista-quality espresso at home.",
  },
  {
    avatar: "https://picsum.photos/seed/item4/200",
    displayName: "Running Shoes",
    priceInCents: 12000,
    description: "Lightweight shoes designed for comfort and speed.",
  },
  {
    avatar: "https://picsum.photos/seed/item5/200",
    displayName: "Smartwatch",
    priceInCents: 19999,
    description: "Track your health and notifications on the go.",
  },
  {
    avatar: "https://picsum.photos/seed/item6/200",
    displayName: "Bluetooth Speaker",
    priceInCents: 3999,
    description: "Compact speaker with deep bass and clear sound.",
  },
  {
    avatar: "https://picsum.photos/seed/item7/200",
    displayName: "Desk Lamp",
    priceInCents: 2250,
    description: "LED desk lamp with touch controls and dimming.",
  },
  {
    avatar: "https://picsum.photos/seed/item8/200",
    displayName: "Stainless Steel Water Bottle",
    priceInCents: 1875,
    description: "Keeps your drinks hot or cold for hours.",
  },
  {
    avatar: "https://picsum.photos/seed/item9/200",
    displayName: "Gaming Mouse",
    priceInCents: 5999,
    description: "Ergonomic mouse with customizable buttons and lights.",
  },
  {
    avatar: "https://picsum.photos/seed/item10/200",
    displayName: "Mechanical Keyboard",
    priceInCents: 9900,
    description: "Tactile keys and RGB lighting for gaming or typing.",
  },
  {
    avatar: "https://picsum.photos/seed/item11/200",
    displayName: "Yoga Mat",
    priceInCents: 2999,
    description: "Non-slip surface for yoga or pilates practice.",
  },
  {
    avatar: "https://picsum.photos/seed/item12/200",
    displayName: "Sunglasses",
    priceInCents: 4500,
    description: "UV-protected, stylish sunglasses for sunny days.",
  },
  {
    avatar: "https://picsum.photos/seed/item13/200",
    displayName: "Electric Toothbrush",
    priceInCents: 7995,
    description: "Powerful cleaning with smart timer technology.",
  },
  {
    avatar: "https://picsum.photos/seed/item14/200",
    displayName: "Hoodie",
    priceInCents: 6000,
    description: "Warm, cozy, and perfect for chilly weather.",
  },
  {
    avatar: "https://picsum.photos/seed/item15/200",
    displayName: "Leather Wallet",
    priceInCents: 3500,
    description: "Slim and stylish wallet made from genuine leather.",
  },
  {
    avatar: "https://picsum.photos/seed/item16/200",
    displayName: "Notebook Set",
    priceInCents: 1599,
    description: "Pack of 3 softcover notebooks for notes and sketches.",
  },
  {
    avatar: "https://picsum.photos/seed/item17/200",
    displayName: "Portable Charger",
    priceInCents: 2799,
    description: "Fast-charging power bank with dual USB ports.",
  },
  {
    avatar: "https://picsum.photos/seed/item18/200",
    displayName: "Cooking Pan",
    priceInCents: 3200,
    description: "Non-stick pan ideal for everyday cooking.",
  },
  {
    avatar: "https://picsum.photos/seed/item19/200",
    displayName: "Minimalist Watch",
    priceInCents: 11000,
    description: "Elegant watch with clean, modern design.",
  },
  {
    avatar: "https://picsum.photos/seed/item20/200",
    displayName: "Camping Tent",
    priceInCents: 13000,
    description: "2-person lightweight and waterproof tent.",
  },
  {
    avatar: "https://picsum.photos/seed/item21/200",
    displayName: "Scented Candles",
    priceInCents: 2450,
    description: "Set of 3 aromatherapy candles for relaxation.",
  },
  {
    avatar: "https://picsum.photos/seed/item22/200",
    displayName: "Laptop Stand",
    priceInCents: 4000,
    description: "Adjustable stand for comfortable laptop use.",
  },
  {
    avatar: "https://picsum.photos/seed/item23/200",
    displayName: "Beanie Hat",
    priceInCents: 1495,
    description: "Soft knit beanie to keep you warm in winter.",
  },
  {
    avatar: "https://picsum.photos/seed/item24/200",
    displayName: "Desk Organizer",
    priceInCents: 2349,
    description: "Keep your workspace tidy with multiple compartments.",
  },
  {
    avatar: "https://picsum.photos/seed/item25/200",
    displayName: "Cordless Drill",
    priceInCents: 7500,
    description: "Powerful and compact drill for home projects.",
  },
  {
    avatar: "https://picsum.photos/seed/item26/200",
    displayName: "Phone Tripod",
    priceInCents: 1995,
    description: "Flexible tripod perfect for content creation.",
  },
  {
    avatar: "https://picsum.photos/seed/item27/200",
    displayName: "Wireless Charger",
    priceInCents: 2999,
    description: "Fast wireless charging pad for smartphones.",
  },
  {
    avatar: "https://picsum.photos/seed/item28/200",
    displayName: "Bath Towels",
    priceInCents: 3999,
    description: "Soft and absorbent towel set in multiple colors.",
  },
  {
    avatar: "https://picsum.photos/seed/item29/200",
    displayName: "Picnic Blanket",
    priceInCents: 2500,
    description: "Waterproof blanket for outdoor picnics and camping.",
  },
  {
    avatar: "https://picsum.photos/seed/item30/200",
    displayName: "Digital Alarm Clock",
    priceInCents: 1850,
    description: "Easy-to-read clock with snooze and backlight.",
  },
  {
    avatar: "https://picsum.photos/seed/item31/200",
    displayName: "Leather Journal",
    priceInCents: 2699,
    description: "Handmade journal with vintage leather cover.",
  },
  {
    avatar: "https://picsum.photos/seed/item32/200",
    displayName: "Slip-On Sneakers",
    priceInCents: 5500,
    description: "Comfortable sneakers perfect for casual outings.",
  },
  {
    avatar: "https://picsum.photos/seed/item33/200",
    displayName: "Wall Art Print",
    priceInCents: 3499,
    description: "High-quality print to add character to any room.",
  },
  {
    avatar: "https://picsum.photos/seed/item34/200",
    displayName: "Bike Helmet",
    priceInCents: 6500,
    description: "Safety-certified helmet with adjustable straps.",
  },
  {
    avatar: "https://picsum.photos/seed/item35/200",
    displayName: "French Press",
    priceInCents: 2875,
    description: "Brew rich and bold coffee the classic way.",
  },
  {
    avatar: "https://picsum.photos/seed/item36/200",
    displayName: "Graphic Tee",
    priceInCents: 2200,
    description: "Casual t-shirt with a unique printed design.",
  },
  {
    avatar: "https://picsum.photos/seed/item37/200",
    displayName: "Skateboard",
    priceInCents: 8999,
    description: "Complete skateboard for beginners and pros.",
  },
  {
    avatar: "https://picsum.photos/seed/item38/200",
    displayName: "BBQ Grill Set",
    priceInCents: 5495,
    description: "Everything you need for a perfect barbecue.",
  },
  {
    avatar: "https://picsum.photos/seed/item39/200",
    displayName: "Plant Pot Set",
    priceInCents: 3150,
    description: "Decorative pots for indoor or outdoor plants.",
  },
  {
    avatar: "https://picsum.photos/seed/item40/200",
    displayName: "Throw Pillow",
    priceInCents: 1995,
    description: "Soft decorative pillow for your couch or bed.",
  },
  {
    avatar: "https://picsum.photos/seed/item41/200",
    displayName: "Linen Apron",
    priceInCents: 2700,
    description: "Classic kitchen apron with adjustable fit.",
  },
  {
    avatar: "https://picsum.photos/seed/item42/200",
    displayName: "Board Game",
    priceInCents: 4499,
    description: "Fun and strategic game for family game night.",
  },
  {
    avatar: "https://picsum.photos/seed/item43/200",
    displayName: "Face Serum",
    priceInCents: 3600,
    description: "Hydrating serum with vitamins C and E.",
  },
  {
    avatar: "https://picsum.photos/seed/item44/200",
    displayName: "Hiking Backpack",
    priceInCents: 9800,
    description: "Spacious and rugged backpack for outdoor adventures.",
  },
  {
    avatar: "https://picsum.photos/seed/item45/200",
    displayName: "Instant Camera",
    priceInCents: 7499,
    description: "Capture and print memories in seconds.",
  },
  {
    avatar: "https://picsum.photos/seed/item46/200",
    displayName: "Cheese Board Set",
    priceInCents: 4950,
    description: "Elegant bamboo board with utensils and accessories.",
  },
  {
    avatar: "https://picsum.photos/seed/item47/200",
    displayName: "Dumbbell Set",
    priceInCents: 5900,
    description: "Adjustable dumbbells for your home gym.",
  },
  {
    avatar: "https://picsum.photos/seed/item48/200",
    displayName: "Floor Lamp",
    priceInCents: 7800,
    description: "Modern standing lamp with adjustable brightness.",
  },
  {
    avatar: "https://picsum.photos/seed/item49/200",
    displayName: "Cooking Knife",
    priceInCents: 3850,
    description: "Chef-grade knife with razor-sharp edge.",
  },
  {
    avatar: "https://picsum.photos/seed/item50/200",
    displayName: "Wool Blanket",
    priceInCents: 6999,
    description: "Warm and soft wool blanket for cozy nights.",
  },
].forEach((item) => {
  fakeInventory.create({
    ...item,
    id: item.displayName.toLowerCase().replaceAll(" ", "-"),
  });
});
