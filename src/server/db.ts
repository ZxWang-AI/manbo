import { PrismaClient } from "@prisma/client";

const globalDatabase = globalThis as typeof globalThis & {
  manboPrisma?: PrismaClient;
};

export const prisma = globalDatabase.manboPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalDatabase.manboPrisma = prisma;
}
