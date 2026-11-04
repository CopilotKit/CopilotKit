import { db } from "#app/db.server.js";

export const getAllCategories = async ({
  perPage,
}: { perPage?: number } = {}) => {
  const categories = await db.category.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, imageUrl: true },
    take: perPage,
  });
  return { categories };
};

export type Category = Awaited<
  ReturnType<typeof getAllCategories>
>["categories"][number];
