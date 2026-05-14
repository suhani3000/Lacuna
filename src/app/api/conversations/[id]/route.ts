import { NextResponse } from 'next/server'

import { findConversationForSession } from '@/lib/conversation-auth'
import { prisma, withPrismaRetry } from '@/lib/db'

export async function PATCH(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params

  let body: unknown
  try {
    body = (await req.json()) as unknown
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }
  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'Expected object' }, { status: 400 })
  }
  const o = body as Record<string, unknown>
  const sessionId = typeof o.sessionId === 'string' ? o.sessionId : null
  const title = typeof o.title === 'string' ? o.title.trim() : ''
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  }
  if (!title) {
    return NextResponse.json({ error: 'title required' }, { status: 400 })
  }

  const conv = await findConversationForSession(sessionId, id)
  if (!conv) {
    return NextResponse.json({ error: 'Unknown conversation' }, { status: 404 })
  }

  try {
    const row = await withPrismaRetry(() =>
      prisma.conversation.update({
        where: { id },
        data: { title },
        select: { id: true, title: true, updatedAt: true },
      }),
    )
    return NextResponse.json({
      id: row.id,
      title: row.title,
      updatedAt: row.updatedAt.toISOString(),
    })
  } catch (e) {
    console.error('PATCH /api/conversations/[id]:', e)
    return NextResponse.json({ error: 'Failed to rename' }, { status: 500 })
  }
}
