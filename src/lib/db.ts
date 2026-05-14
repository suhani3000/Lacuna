import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
  })

if (!globalForPrisma.prisma) {
  globalForPrisma.prisma = prisma
}

function isStaleConnectionError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const m = err.message.toLowerCase()
  return (
    m.includes('closed') ||
    m.includes('econnreset') ||
    m.includes('connection reset') ||
    m.includes('server has closed') ||
    m.includes('kind: closed')
  )
}

/**
 * Re-run after idle-heavy work: poolers often close connections mid-request.
 */
export async function withPrismaRetry<T>(
  operation: () => Promise<T>,
  retries = 2,
): Promise<T> {
  let last: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await operation()
    } catch (err) {
      last = err
      if (attempt < retries && isStaleConnectionError(err)) {
        try {
          await prisma.$disconnect()
        } catch {
          /* ignore */
        }
        await prisma.$connect()
        continue
      }
      throw err
    }
  }
  throw last
}
