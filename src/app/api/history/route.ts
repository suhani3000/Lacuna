import { NextResponse } from 'next/server'

import { findConversationForSession } from '@/lib/conversation-auth'
import { prisma, withPrismaRetry } from '@/lib/db'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const sessionId = searchParams.get('sessionId')
  const conversationId = searchParams.get('conversationId')

  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  }
  if (!conversationId) {
    return NextResponse.json({ error: 'conversationId required' }, { status: 400 })
  }

  const conv = await findConversationForSession(sessionId, conversationId)
  if (!conv) {
    return NextResponse.json({ error: 'Unknown conversation' }, { status: 404 })
  }

  try {
    const results = await withPrismaRetry(() =>
      prisma.gapRecord.findMany({
        where: { sessionId, conversationId },
        select: {
          id: true,
          concept: true,
          gap: true,
          question: true,
          hint: true,
          severity: true,
          recurringPattern: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      }),
    )

    return NextResponse.json(results)
  } catch {
    return NextResponse.json({ error: 'Failed to fetch history' }, { status: 500 })
  }
}
