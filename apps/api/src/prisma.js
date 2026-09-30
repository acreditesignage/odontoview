import { PrismaClient } from "@prisma/client";
export const prisma = globalThis.__odontoviewPrisma || new PrismaClient();
if (process.env.NODE_ENV !== "production") globalThis.__odontoviewPrisma = prisma;
