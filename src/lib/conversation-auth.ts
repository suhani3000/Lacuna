import { prisma, withPrismaRetry } from '@/lib/db'

export async function findConversationForSession(
  sessionId: string,
  conversationId: string,
) {
  return withPrismaRetry(() =>
    prisma.conversation.findFirst({
      where: { id: conversationId, sessionId },
      select: { id: true, title: true },
    }),
  )
}
