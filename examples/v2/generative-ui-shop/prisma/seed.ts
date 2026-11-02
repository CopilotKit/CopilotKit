import { faker } from "@faker-js/faker";
import { db } from "#app/db.server.js";
import type { ProductUncheckedCreateInput } from "#app/generated/prisma/models.js";

const categories = [
  "Running",
  "Casual",
  "Athletic",
  "Lifestyle",
  "Hiking",
  "Comfort",
  "Formal",
];

const brands = [
  "SkyStep",
  "StreetWalk",
  "ProAthlete",
  "TimelessStep",
  "OutdoorPro",
  "VelocityRun",
  "SoftStep",
  "ExecutiveWear",
];

const sneakerImages = [
  "https://images.pexels.com/photos/2529148/pexels-photo-2529148.jpeg?auto=compress&cs=tinysrgb&w=600",
  "https://images.pexels.com/photos/1598505/pexels-photo-1598505.jpeg?auto=compress&cs=tinysrgb&w=600",
  "https://images.pexels.com/photos/1464625/pexels-photo-1464625.jpeg?auto=compress&cs=tinysrgb&w=600",
  "https://images.pexels.com/photos/1456706/pexels-photo-1456706.jpeg?auto=compress&cs=tinysrgb&w=600",
  "https://images.pexels.com/photos/1598508/pexels-photo-1598508.jpeg?auto=compress&cs=tinysrgb&w=600",
  "https://images.pexels.com/photos/2529157/pexels-photo-2529157.jpeg?auto=compress&cs=tinysrgb&w=600",
  "https://images.pexels.com/photos/1456705/pexels-photo-1456705.jpeg?auto=compress&cs=tinysrgb&w=600",
];
const productNames = [
  "Air Zoom Pegasus 38",
  "Ultraboost 21",
  "Gel-Kayano 27",
  "React Infinity Run Flyknit",
  "Fresh Foam 1080v11",
  "Speedcross 5",
  "Cloudswift",
  "Chuck Taylor All Star",
  "Samba OG",
  "Sneaker X Pro",
  "Runner Max",
  "Street Style",
  "Urban Walk",
  "Trail Blazer",
  "Comfy Step",
  "Flex Runner",
  "Power Boost",
  "Elite Trainer",
  "Comfort Cloud",
  "Business Elite",
];

function buildProductCatalog(
  targetCount: number,
  categoryMap: Map<string, string>,
  brandMap: Map<string, string>,
): ProductUncheckedCreateInput[] {
  const products: ProductUncheckedCreateInput[] = [];
  for (let i = 0; i < targetCount; i++) {
    products.push({
      name:
        faker.helpers.arrayElement(productNames) +
        " " +
        faker.commerce.productAdjective(),
      description: faker.lorem.paragraphs(),
      imageUrl: faker.helpers.arrayElement(sneakerImages),
      price: parseFloat(faker.commerce.price({ min: 20, max: 500, dec: 2 })),
      reviewScore: faker.number.int({ min: 1, max: 5 }),
      categoryId: categoryMap.get(faker.helpers.arrayElement(categories))!,
      brandId: brandMap.get(faker.helpers.arrayElement(brands))!,
    });
  }

  return products;
}

async function seed() {
  console.log("Seeding database...");
  console.time("Database seeded");

  await db.variation.deleteMany();
  await db.productReview.deleteMany();
  await db.product.deleteMany();
  await db.category.deleteMany();
  await db.brand.deleteMany();

  const categoryNames = categories.filter((name) => name !== "All");
  const brandNames = brands.filter((name) => name !== "All");

  const categoryMap = new Map<string, string>();
  for (const name of categoryNames) {
    const category = await db.category.create({
      data: { name, imageUrl: faker.helpers.arrayElement(sneakerImages) },
    });
    categoryMap.set(name, category.id);
  }

  const brandMap = new Map<string, string>();
  for (const name of brandNames) {
    const brand = await db.brand.create({ data: { name } });
    brandMap.set(name, brand.id);
  }

  const catalog = buildProductCatalog(100, categoryMap, brandMap);

  for (const product of catalog) {
    const createdProduct = await db.product.create({
      data: product,
    });

    const colors = ["Red", "Blue", "Black", "White"];
    const sizes = ["9", "10", "11", "12"];
    const variations = [];

    for (const color of colors) {
      for (const size of sizes) {
        variations.push({
          productId: createdProduct.id,
          color,
          size,
          quantity: faker.number.int({ min: 0, max: 2 }),
        });
      }
    }

    await db.variation.createMany({ data: variations });
    const createdVariations = await db.variation.findMany({
      where: { productId: createdProduct.id },
    });
    for (const v of createdVariations) {
      await db.productReview.create({
        data: {
          productId: createdProduct.id,
          rating: faker.number.int({ min: 1, max: 5 }),
          variationId: v.id,
        },
      });
    }
  }

  console.timeEnd("Database seeded");
}

seed()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
