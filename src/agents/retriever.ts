import { generateEmbedding } from '@/lib/embeddings'
import { prisma, withPrismaRetry } from '@/lib/db'

export interface RetrieverInput {
  explanation: string
  sessionId: string
  conversationId: string
}

export interface SimilarGap {
  concept: string
  gap: string
  question: string
  similarity: number
}

export interface RetrieverOutput {
  similarGaps: SimilarGap[]
  hasHistory: boolean
}

export async function runRetriever(input: RetrieverInput): Promise<RetrieverOutput> {
  try {
    const queryVector = await generateEmbedding(input.explanation, {
      taskType: 'RETRIEVAL_QUERY',
    })

    const results = await withPrismaRetry(() =>
      prisma.$queryRaw<
        Array<{ concept: string; gap: string; question: string; distance: number }>
      >`
        SELECT concept, gap, question,
               embedding <=> ${JSON.stringify(queryVector)}::vector AS distance
        FROM "GapRecord"
        WHERE "sessionId" = ${input.sessionId}
          AND "conversationId" = ${input.conversationId}
        ORDER BY distance ASC
        LIMIT 3
      `,
    )

    if (results.length === 0) {
      return { similarGaps: [], hasHistory: false }
    }

    const similarGaps = results
      .map((row) => ({
        concept: row.concept,
        gap: row.gap,
        question: row.question,
        similarity: Math.max(0, 1 - Number(row.distance)),
      }))
      .filter((row) => row.similarity >= 0.3)

    return {
      similarGaps,
      hasHistory: true,
    }
  } catch {
    return { similarGaps: [], hasHistory: false }
  }
}
