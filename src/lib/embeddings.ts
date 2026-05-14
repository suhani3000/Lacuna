import { prisma, withPrismaRetry } from '@/lib/db'

export interface GapData {
  sessionId: string
  conversationId: string | null
  concept: string
  explanation: string
  gap: string
  question: string
  hint?: string | null
  severity?: string | null
  recurringPattern?: string | null
}

const EMBEDDING_MODEL = 'gemini-embedding-001'
const EMBEDDING_DIM = 768

function generateGapRecordId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

/**
 * @param taskType Use RETRIEVAL_DOCUMENT when embedding stored text; RETRIEVAL_QUERY for search queries.
 * @see https://ai.google.dev/gemini-api/docs/embeddings
 */
export async function generateEmbedding(
  text: string,
  options: { taskType?: string } = {},
): Promise<number[]> {
  const apiKey = process.env.GOOGLE_AI_STUDIO_API_KEY
  if (!apiKey) {
    throw new Error(
      'GOOGLE_AI_STUDIO_API_KEY is not set; cannot call Gemini embeddings.',
    )
  }

  const taskType = options.taskType ?? 'RETRIEVAL_DOCUMENT'
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent?key=${encodeURIComponent(apiKey)}`

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: { parts: [{ text }] },
        taskType,
        output_dimensionality: EMBEDDING_DIM,
      }),
    })
  } catch (err) {
    const detail = err instanceof Error ? err.message : 'Network error'
    throw new Error(`Failed to reach Gemini embedding API: ${detail}`)
  }

  let data: unknown
  try {
    data = (await res.json()) as unknown
  } catch {
    throw new Error(
      `Gemini embedding API returned non-JSON (HTTP ${res.status}).`,
    )
  }

  if (!res.ok) {
    let msg = `HTTP ${res.status}`
    if (typeof data === 'object' && data !== null) {
      const errObj = (data as { error?: { message?: string; status?: string } })
        .error
      if (errObj && typeof errObj.message === 'string') {
        msg = errObj.message
      }
    }
    throw new Error(`Gemini embedding failed: ${msg}`)
  }

  if (typeof data !== 'object' || data === null) {
    throw new Error('Gemini embedding response was not an object.')
  }

  const embedding = (data as { embedding?: { values?: unknown } }).embedding
  const values = embedding?.values
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error('Gemini returned no embedding values.')
  }

  const numbers: number[] = []
  for (const v of values) {
    if (typeof v !== 'number' || Number.isNaN(v)) {
      throw new Error('Gemini returned invalid embedding values.')
    }
    numbers.push(v)
  }

  if (numbers.length !== EMBEDDING_DIM) {
    throw new Error(
      `Expected ${EMBEDDING_DIM}-dim embedding, got ${numbers.length}.`,
    )
  }

  return numbers
}

export async function saveGapRecord(data: GapData): Promise<void> {
  try {
    const vectorArray = await generateEmbedding(data.explanation, {
      taskType: 'RETRIEVAL_DOCUMENT',
    })
    const id = generateGapRecordId()
    const convId = data.conversationId
    const hint = data.hint ?? null
    const severity = data.severity ?? null
    const recurring = data.recurringPattern ?? null

    await withPrismaRetry(() =>
      prisma.$executeRaw`
      INSERT INTO "GapRecord" (id, "sessionId", "conversationId", concept, explanation, gap, question, hint, severity, "recurringPattern", embedding, "createdAt")
      VALUES (
        ${id},
        ${data.sessionId},
        ${convId},
        ${data.concept},
        ${data.explanation},
        ${data.gap},
        ${data.question},
        ${hint},
        ${severity},
        ${recurring},
        ${JSON.stringify(vectorArray)}::vector,
        NOW()
      )
    `,
    )
  } catch (error) {
    console.error('Failed to save GapRecord:', error)
    throw error
  }
}
