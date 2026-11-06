export interface Product {
  id: string;
  name: string;
  price: number;
  category: "headphones" | "speakers" | "accessories";
  tagline: string;
}

export const PRODUCTS: Product[] = [
  {
    id: "aurora-x",
    name: "Aurora X Headphones",
    price: 179,
    category: "headphones",
    tagline: "Adaptive ANC, 40h battery",
  },
  {
    id: "pulse-mini",
    name: "Pulse Mini Earbuds",
    price: 89,
    category: "headphones",
    tagline: "Pocketable, IPX5",
  },
  {
    id: "studio-pro",
    name: "Studio Pro Monitors",
    price: 349,
    category: "headphones",
    tagline: "Flat response for mixing",
  },
  {
    id: "boom-go",
    name: "Boom Go Speaker",
    price: 129,
    category: "speakers",
    tagline: "Rugged outdoor sound",
  },
  {
    id: "room-one",
    name: "Room One Speaker",
    price: 249,
    category: "speakers",
    tagline: "Room-filling smart speaker",
  },
  {
    id: "dock-c",
    name: "Dock C Charger",
    price: 39,
    category: "accessories",
    tagline: "Charges buds and phone",
  },
];

export const findProduct = (id: string) => PRODUCTS.find((p) => p.id === id);
