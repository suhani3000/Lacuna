export const runtime = 'nodejs'
export const maxDuration = 60

import OpenAI from 'openai'
import { NextResponse } from 'next/server'

import { findConversationForSession } from '@/lib/conversation-auth'
import { prisma, withPrismaRetry } from '@/lib/db'

interface CoachContext {
  concept?: string
  gap?: string
  question?: string
}

function parseCoachContext(raw: unknown): CoachContext | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined
  const o = raw as Record<string, unknown>
  const out: CoachContext = {}
  if (typeof o.concept === 'string') out.concept = o.concept
  if (typeof o.gap === 'string') out.gap = o.gap
  if (typeof o.question === 'string') out.question = o.question
  return Object.keys(out).length ? out : undefined
}

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
    const rows = await withPrismaRetry(() =>
      prisma.chatMessage.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'asc' },
        take: 120,
        select: { id: true, role: true, content: true, createdAt: true },
      }),
    )
    const messages = rows.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      createdAt: m.createdAt.toISOString(),
    }))
    return NextResponse.json(messages)
  } catch (e) {
    console.error('GET /api/chat:', e)
    return NextResponse.json({ error: 'Failed to load chat' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  let body: unknown
  try {
    body = (await req.json()) as unknown
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (typeof body !== 'object' || body === null) {
    return NextResponse.json({ error: 'Expected JSON object' }, { status: 400 })
  }
  const o = body as Record<string, unknown>
  const sessionId = typeof o.sessionId === 'string' ? o.sessionId : null
  const conversationId = typeof o.conversationId === 'string' ? o.conversationId : null
  const text = typeof o.text === 'string' ? o.text.trim() : ''
  if (!sessionId) {
    return NextResponse.json({ error: 'sessionId required' }, { status: 400 })
  }
  if (!conversationId) {
    return NextResponse.json({ error: 'conversationId required' }, { status: 400 })
  }
  if (!text) {
    return NextResponse.json({ error: 'text required' }, { status: 400 })
  }

  const conv = await findConversationForSession(sessionId, conversationId)
  if (!conv) {
    return NextResponse.json({ error: 'Unknown conversation' }, { status: 404 })
  }

  const context = parseCoachContext(o.context)

  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      { error: 'OPENROUTER_API_KEY is not configured on the server.' },
      { status: 500 },
    )
  }

  const client = new OpenAI({
    apiKey,
    baseURL: 'https://openrouter.ai/api/v1',
  })

  try {
    await withPrismaRetry(() =>
      prisma.chatMessage.create({
        data: {
          sessionId,
          conversationId,
          role: 'user',
          content: text,
        },
      }),
    )

    const prior = await withPrismaRetry(() =>
      prisma.chatMessage.findMany({
        where: { conversationId },
        orderBy: { createdAt: 'desc' },
        take: 28,
        select: { role: true, content: true },
      }),
    )
    prior.reverse()

    const contextBlock = context
      ? [
          'Latest Lacuna analysis for this thread:',
          context.concept ? `Concept: ${context.concept}` : '',
          context.gap ? `Identified gap: ${context.gap}` : '',
          context.question ? `Guiding question: ${context.question}` : '',
        ]
          .filter(Boolean)
          .join('\n')
      : 'No structured analysis context was attached to this message; use the thread.'

    const system = `You are a Socratic coach in Lacuna — a tutoring chat focused on explaining concepts clearly and surfacing misunderstandings.
${contextBlock}

Formatting rules (critical):
- Do NOT use Markdown asterisks like **bold** — they render as ugly literals in the UI.
- Do NOT use Markdown headings with # symbols.
- To emphasize important words or short phrases, wrap them in French quotation marks like «this».
- For short code, identifiers, or pseudo-code fragments, use a single pair of backticks like \`node.next\`.
- Prefer short paragraphs and bullet lines starting with "• " when listing steps.
- Be concise unless the user asks for depth.`

    const openaiMessages: {
      role: 'system' | 'user' | 'assistant'
      content: string
    }[] = [
      { role: 'system', content: system },
      ...prior.map((m) => ({
        role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
        content: m.content,
      })),
    ]

    const completion = await client.chat.completions.create({
      model: 'anthropic/claude-sonnet-4-5',
      max_tokens: 900,
      messages: openaiMessages,
    })

    const replyRaw = completion.choices[0]?.message?.content
    const reply =
      typeof replyRaw === 'string' && replyRaw.trim()
        ? replyRaw.trim()
        : 'I did not get a usable reply from the model. Try rephrasing your message.'

    await withPrismaRetry(() =>
      prisma.chatMessage.create({
        data: {
          sessionId,
          conversationId,
          role: 'assistant',
          content: reply,
        },
      }),
    )

    await withPrismaRetry(() =>
      prisma.conversation.update({
        where: { id: conversationId },
        data: { title: conv.title },
      }),
    )

    return NextResponse.json({ reply })
  } catch (e) {
    console.error('POST /api/chat:', e)
    const msg = e instanceof Error ? e.message : 'Chat failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
