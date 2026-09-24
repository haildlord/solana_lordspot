import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';
import { config } from './config';

const adapter = new PrismaPg({ connectionString: config.databaseUrl });

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient({ adapter });

if (config.nodeEnv !== 'production') {
  globalForPrisma.prisma = prisma;
}
