import { db } from "#app/db.server.js";

export const getAllBrands = async () => {
  const brands = await db.brand.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  return { brands };
};
