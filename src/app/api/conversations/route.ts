import { NextResponse } from 'next/server'

import { prisma, withPrismaRetry } from '@/lib/db'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const sessionId = searchParams.get('sessionId')
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  }

  try {
    const rows = await withPrismaRetry(() =>
      prisma.conversation.findMany({
        where: { sessionId },
        orderBy: { updatedAt: 'desc' },
        take: 50,
        select: { id: true, title: true, createdAt: true, updatedAt: true },
      }),
    )
    return NextResponse.json(
      rows.map((r) => ({
        id: r.id,
        title: r.title,
        createdAt: r.createdAt.toISOString(),
        updatedAt: r.updatedAt.toISOString(),
      })),
    )
  } catch (e) {
    console.error('GET /api/conversations:', e)
    return NextResponse.json({ error: 'Failed to list conversations' }, { status: 500 })
  }
}

export async function POST(req: Request) {
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
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  }
  const title =
    typeof o.title === 'string' && o.title.trim().length > 0
      ? o.title.trim()
      : 'New topic'

  try {
    const row = await withPrismaRetry(() =>
      prisma.conversation.create({
        data: { sessionId, title },
        select: { id: true, title: true, createdAt: true, updatedAt: true },
      }),
    )
    return NextResponse.json({
      id: row.id,
      title: row.title,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    })
  } catch (e) {
    console.error('POST /api/conversations:', e)
    return NextResponse.json({ error: 'Failed to create conversation' }, { status: 500 })
  }
}
