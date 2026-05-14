import OpenAI from 'openai'

import type { ExtractorOutput } from '@/agents/extractor'
import type { RetrieverOutput } from '@/agents/retriever'
import { stripAssistantJsonFence } from '@/lib/model-json'

export interface DetectorInput {
  concept: string
  explanation: string
  extracted: ExtractorOutput
  retrieved: RetrieverOutput
}

export interface DetectorOutput {
  primaryGap: string
  missedMechanisms: string[]
  recurringPattern: string | null
  severity: 'minor' | 'moderate' | 'significant'
}

const SYSTEM_PROMPT =
  'You are a Socratic tutor finding the single most critical gap in someone\'s understanding. You receive their explanation, an analysis of what they covered, and optionally their past mistakes on similar topics. You identify gaps with precision — never vague, always specific to the concept. Respond ONLY with valid JSON. No markdown, no preamble.'

function buildHistorySection(retrieved: RetrieverOutput): string {
  if (retrieved.hasHistory && retrieved.similarGaps.length > 0) {
    const lines = retrieved.similarGaps
      .map((g) => `- When explaining ${g.concept}: ${g.gap}`)
      .join('\n')
    return `IMPORTANT — Past gaps from this user on similar topics:\n${lines}\nIdentify if there is a recurring pattern in what this user consistently misses.`
  }
  if (!retrieved.hasHistory) {
    return 'No past history available for this user.'
  }
  return 'Session has prior gap records, but no sufficiently similar past gaps were retrieved for this explanation.'
}

function buildUserPrompt(input: DetectorInput): string {
  const historyBlock = buildHistorySection(input.retrieved)

  return `- Concept: ${input.concept}
- User's explanation: "${input.explanation}"
- What they covered well: ${input.extracted.whatWasExplainedWell}
- Terms they used: ${input.extracted.keyTermsUsed.join(', ')}
- Depth level: ${input.extracted.depthLevel}
- Notable absences from a complete explanation: ${input.extracted.notableAbsences.join('; ')}

${historyBlock}

Return JSON: { "primaryGap": string, "missedMechanisms": string[], "recurringPattern": string | null, "severity": "minor"|"moderate"|"significant" }`
}

function createFallbackOutput(): DetectorOutput {
  return {
    primaryGap: '',
    missedMechanisms: [],
    recurringPattern: null,
    severity: 'minor',
  }
}

function isSeverity(v: unknown): v is DetectorOutput['severity'] {
  return v === 'minor' || v === 'moderate' || v === 'significant'
}

function toStringArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null
  const out: string[] = []
  for (const item of v) {
    if (typeof item !== 'string') return null
    out.push(item)
  }
  return out
}

function parseRecurringPattern(v: unknown): string | null | undefined {
  if (v === null) return null
  if (typeof v === 'string') return v
  return undefined
}

function parseModelJson(raw: unknown): DetectorOutput | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>

  if (typeof o.primaryGap !== 'string') return null
  if (!isSeverity(o.severity)) return null

  const missedMechanisms = toStringArray(o.missedMechanisms)
  if (missedMechanisms === null) return null

  const recurring = parseRecurringPattern(o.recurringPattern)
  if (recurring === undefined) return null

  return {
    primaryGap: o.primaryGap,
    missedMechanisms,
    recurringPattern: recurring,
    severity: o.severity,
  }
}

function tryParseAssistantContent(content: string): DetectorOutput | null {
  const jsonText = stripAssistantJsonFence(content)
  try {
    const raw = JSON.parse(jsonText) as unknown
    return parseModelJson(raw)
  } catch {
    return null
  }
}

function normalizeGapText(parsed: DetectorOutput, input: DetectorInput): DetectorOutput {
  const gap = parsed.primaryGap.trim()
  if (gap) return parsed

  const fromAbsences = input.extracted.notableAbsences.map((s) => s.trim()).filter(Boolean)
  const fromMechanisms = parsed.missedMechanisms.map((s) => s.trim()).filter(Boolean)
  const fallback =
    fromAbsences.join('; ') ||
    fromMechanisms.join('; ') ||
    'Your explanation did not pin down the core mechanism or boundary conditions for this topic in a checkable way.'

  return { ...parsed, primaryGap: fallback }
}

export async function runDetector(input: DetectorInput): Promise<DetectorOutput> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    throw new Error(
      'OPENROUTER_API_KEY is not set; cannot call OpenRouter for the detector agent.',
    )
  }

  const client = new OpenAI({
    apiKey,
    baseURL: 'https://openrouter.ai/api/v1',
  })

  try {
    const response = await client.chat.completions.create({
      model: 'anthropic/claude-sonnet-4-5',
      max_tokens: 1024,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildUserPrompt(input) },
      ],
    })

    const contentRaw = response.choices[0]?.message?.content
    if (contentRaw === null || contentRaw === undefined) {
      throw new Error(
        'Detector received an empty assistant message from OpenRouter (choices[0].message.content is missing).',
      )
    }
    if (typeof contentRaw !== 'string') {
      throw new Error(
        'Detector expected a string assistant message from OpenRouter; received non-text content.',
      )
    }

    const parsed = tryParseAssistantContent(contentRaw)
    if (parsed === null) {
      const fb = createFallbackOutput()
      return normalizeGapText(fb, input)
    }
    return normalizeGapText(parsed, input)
  } catch (err) {
    const detail =
      err instanceof Error
        ? err.message
        : typeof err === 'string'
          ? err
          : 'Unknown error'
    throw new Error(`Detector agent failed while calling OpenRouter: ${detail}`)
  }
}
