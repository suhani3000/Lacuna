import OpenAI from 'openai'

import type { DetectorOutput } from '@/agents/detector'
import { stripAssistantJsonFence } from '@/lib/model-json'

export interface InterrogatorInput {
  concept: string
  explanation: string // user's original explanation verbatim
  detected: DetectorOutput
}

export interface InterrogatorOutput {
  question: string
  targetedAt: string
  hint: string
  severity: string
}

const SYSTEM_PROMPT =
  "You are a Socratic interrogator. Your job is to ask the ONE question that makes someone realize what they don't actually understand. Rules: (1) Your question must quote or directly reference a specific phrase the user wrote. (2) The question must be unanswerable with 'I don't know' — it must force active thinking. (3) Never reveal the answer or give it away in the question. (4) Generic questions are failures. Every question must be crafted specifically from what this person wrote. Respond ONLY with valid JSON."

function buildUserPrompt(input: InterrogatorInput): string {
  const patternLine = input.detected.recurringPattern
    ? `Recurring pattern: ${input.detected.recurringPattern}`
    : ''

  return `The user explained "${input.concept}" as follows:

"${input.explanation}"

The primary gap in their understanding: ${input.detected.primaryGap}
Specific mechanisms they missed: ${input.detected.missedMechanisms.join(', ')}
${patternLine}
Gap severity: ${input.detected.severity}

Generate ONE follow-up question that:
1. Quotes or references a specific word/phrase from their explanation above
2. Directly targets the primary gap
3. Cannot be dismissed with "I don't know" — forces them to reason

Return JSON: {
  "question": string,
  "targetedAt": string,
  "hint": string,
  "severity": "${input.detected.severity}"
}`
}

function createFallbackOutput(input: InterrogatorInput): InterrogatorOutput {
  return {
    question: "Can you explain the part you're least sure about?",
    targetedAt: 'general understanding',
    hint: "Think about what would break your explanation.",
    severity: input.detected.severity,
  }
}

function parseModelJson(raw: unknown): Pick<
  InterrogatorOutput,
  'question' | 'targetedAt' | 'hint'
> | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>

  if (typeof o.question !== 'string') return null
  if (typeof o.targetedAt !== 'string') return null
  if (typeof o.hint !== 'string') return null

  return {
    question: o.question,
    targetedAt: o.targetedAt,
    hint: o.hint,
  }
}

function tryParseAssistantContent(
  content: string,
): Pick<InterrogatorOutput, 'question' | 'targetedAt' | 'hint'> | null {
  const jsonText = stripAssistantJsonFence(content)
  try {
    const parsed = JSON.parse(jsonText) as unknown
    return parseModelJson(parsed)
  } catch {
    return null
  }
}

export async function runInterrogator(
  input: InterrogatorInput,
): Promise<InterrogatorOutput> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    throw new Error(
      'OPENROUTER_API_KEY is not set; cannot call OpenRouter for the interrogator agent.',
    )
  }

  const client = new OpenAI({
    apiKey,
    baseURL: 'https://openrouter.ai/api/v1',
  })

  try {
    const response = await client.chat.completions.create({
      model: 'anthropic/claude-sonnet-4-5',
      max_tokens: 512,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(input) },
      ],
    })

    const contentRaw = response.choices[0]?.message?.content
    if (contentRaw === null || contentRaw === undefined) {
      throw new Error(
        'Interrogator received an empty assistant message from OpenRouter (choices[0].message.content is missing).',
      )
    }
    if (typeof contentRaw !== 'string') {
      throw new Error(
        'Interrogator expected a string assistant message from OpenRouter; received non-text content.',
      )
    }

    const parsed = tryParseAssistantContent(contentRaw)
    if (parsed === null) {
      return createFallbackOutput(input)
    }

    return {
      ...parsed,
      severity: input.detected.severity,
    }
  } catch (err) {
    const detail =
      err instanceof Error
        ? err.message
        : typeof err === 'string'
          ? err
          : 'Unknown error'
    throw new Error(`Interrogator agent failed while calling OpenRouter: ${detail}`)
  }
}
