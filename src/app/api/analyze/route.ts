export const runtime = 'nodejs'
export const maxDuration = 60

import { runExtractor } from '@/agents/extractor'
import { runRetriever } from '@/agents/retriever'
import { runDetector } from '@/agents/detector'
import { runInterrogator } from '@/agents/interrogator'
import { findConversationForSession } from '@/lib/conversation-auth'
import { saveGapRecord } from '@/lib/embeddings'
import { prisma, withPrismaRetry } from '@/lib/db'

interface AnalyzeRequest {
  concept: string
  explanation: string
  sessionId: string
  conversationId: string
}

type SSEMessage =
  | { step: 1 | 2 | 3 | 4; type: 'thinking'; status: string }
  | { step: 1 | 2 | 3 | 4; type: 'done'; label: string }
  | {
      type: 'complete'
      gap: string
      question: string
      hint: string
      recurringPattern: string | null
      severity: string
    }
  | { type: 'error'; message: string }

function parseAnalyzeBody(raw: string): AnalyzeRequest | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed) as unknown
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const o = parsed as Record<string, unknown>
  if (typeof o.concept !== 'string') return null
  if (typeof o.explanation !== 'string') return null
  if (typeof o.sessionId !== 'string') return null
  if (typeof o.conversationId !== 'string') return null
  return {
    concept: o.concept,
    explanation: o.explanation,
    sessionId: o.sessionId,
    conversationId: o.conversationId,
  }
}

function buildAnalysisUserMessage(concept: string, explanation: string): string {
  return `I ran a Feynman check on «${concept}».

My explanation:
${explanation}`
}

function buildAnalysisAssistantMessage(input: {
  severity: string
  gap: string
  question: string
  hint: string
}): string {
  return [
    `Severity: «${input.severity}»`,
    '',
    'WHAT YOU MISSED',
    input.gap,
    '',
    'QUESTION',
    input.question,
    '',
    'HINT',
    input.hint,
  ].join('\n')
}

export async function POST(req: Request) {
  let body: AnalyzeRequest
  try {
    const text = await req.text()
    const parsed = parseAnalyzeBody(text)
    if (!parsed) {
      return Response.json(
        {
          error:
            'Invalid or empty JSON body; expected { concept, explanation, sessionId, conversationId }.',
        },
        { status: 400 },
      )
    }
    body = parsed
  } catch {
    return Response.json({ error: 'Could not read request body.' }, { status: 400 })
  }

  const { concept, explanation, sessionId, conversationId } = body
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const emit = (msg: SSEMessage) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(msg)}\n\n`))

      try {
        const conv = await findConversationForSession(sessionId, conversationId)
        if (!conv) {
          emit({ type: 'error', message: 'Unknown conversation for this session.' })
          return
        }

        emit({ step: 1, type: 'thinking', status: 'Reading your explanation...' })
        const extracted = await runExtractor({ concept, explanation })
        emit({
          step: 1,
          type: 'done',
          label: `Identified ${extracted.notableAbsences.length} potential gaps`,
        })

        emit({ step: 2, type: 'thinking', status: 'Searching this topic thread...' })
        const retrieved = await runRetriever({
          explanation,
          sessionId,
          conversationId,
        })
        emit({
          step: 2,
          type: 'done',
          label: retrieved.hasHistory
            ? `Found ${retrieved.similarGaps.length} related past gaps`
            : 'No prior checks in this thread yet',
        })

        emit({ step: 3, type: 'thinking', status: 'Identifying the gap...' })
        const detected = await runDetector({
          concept,
          explanation,
          extracted,
          retrieved,
        })
        emit({
          step: 3,
          type: 'done',
          label: `Gap found (severity: ${detected.severity})`,
        })

        emit({ step: 4, type: 'thinking', status: 'Crafting your question...' })
        const final = await runInterrogator({ concept, explanation, detected })
        emit({ step: 4, type: 'done', label: 'Question generated' })

        try {
          await saveGapRecord({
            sessionId,
            conversationId,
            concept,
            explanation,
            gap: detected.primaryGap,
            question: final.question,
            hint: final.hint,
            severity: detected.severity,
            recurringPattern: detected.recurringPattern,
          })
        } catch (e) {
          console.error('saveGapRecord failed after retries:', e)
        }

        try {
          const userMsg = buildAnalysisUserMessage(concept, explanation)
          const assistantMsg = buildAnalysisAssistantMessage({
            severity: detected.severity,
            gap: detected.primaryGap,
            question: final.question,
            hint: final.hint,
          })
          await withPrismaRetry(() =>
            prisma.$transaction([
              prisma.chatMessage.create({
                data: {
                  sessionId,
                  conversationId,
                  role: 'user',
                  content: userMsg,
                },
              }),
              prisma.chatMessage.create({
                data: {
                  sessionId,
                  conversationId,
                  role: 'assistant',
                  content: assistantMsg,
                },
              }),
              prisma.conversation.update({
                where: { id: conversationId },
                data: { title: concept },
              }),
            ]),
          )
        } catch (e) {
          console.error('Failed to append analysis chat messages:', e)
        }

        emit({
          type: 'complete',
          gap: detected.primaryGap,
          question: final.question,
          hint: final.hint,
          recurringPattern: detected.recurringPattern,
          severity: detected.severity,
        })
      } catch (err) {
        emit({
          type: 'error',
          message: err instanceof Error ? err.message : 'Pipeline failed',
        })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
