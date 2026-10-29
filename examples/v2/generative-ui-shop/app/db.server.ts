import { PrismaBetterSQLite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "./generated/prisma/client";

// The same file as `url` in prisma/schema.prisma. The Prisma CLI resolves
// that path from the prisma/ folder. The app resolves this one from the
// example root.
const adapter = new PrismaBetterSQLite3({ url: "file:./prisma/data.db" });
const prisma = new PrismaClient({ adapter });
await prisma.$connect();
export const db = prisma;
