import OpenAI from 'openai'

export interface ExtractorInput {
  concept: string
  explanation: string
}

export interface ExtractorOutput {
  conceptName: string
  keyTermsUsed: string[]
  structureType: string
  depthLevel: 'surface' | 'intermediate' | 'deep'
  whatWasExplainedWell: string
  notableAbsences: string[]
}

const SYSTEM_PROMPT =
  'You are an expert at analyzing how deeply someone understands a topic based solely on their own explanation. You identify structure, depth, and gaps with surgical precision. Respond ONLY with valid JSON matching the exact schema. No preamble, no markdown fences, no explanation outside the JSON.'

function buildUserPrompt(input: ExtractorInput): string {
  return `Analyze this explanation of "${input.concept}".

User's explanation:
"${input.explanation}"

Return ONLY this JSON structure:
{
  "conceptName": string,
  "keyTermsUsed": string[],
  "structureType": string,
  "depthLevel": "surface" | "intermediate" | "deep",
  "whatWasExplainedWell": string,
  "notableAbsences": string[]  // 3-6 concepts genuinely missing from a complete explanation
}`
}

function createFallbackOutput(input: ExtractorInput): ExtractorOutput {
  return {
    conceptName: input.concept,
    keyTermsUsed: [],
    structureType: '',
    depthLevel: 'surface',
    whatWasExplainedWell: '',
    notableAbsences: [],
  }
}

function isDepthLevel(v: unknown): v is ExtractorOutput['depthLevel'] {
  return v === 'surface' || v === 'intermediate' || v === 'deep'
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

function parseModelJson(raw: unknown): ExtractorOutput | null {
  if (typeof raw !== 'object' || raw === null) return null
  const o = raw as Record<string, unknown>

  if (typeof o.conceptName !== 'string') return null
  if (typeof o.structureType !== 'string') return null
  if (typeof o.whatWasExplainedWell !== 'string') return null
  if (!isDepthLevel(o.depthLevel)) return null

  const keyTermsUsed = toStringArray(o.keyTermsUsed)
  const notableAbsences = toStringArray(o.notableAbsences)
  if (keyTermsUsed === null || notableAbsences === null) return null

  return {
    conceptName: o.conceptName,
    keyTermsUsed,
    structureType: o.structureType,
    depthLevel: o.depthLevel,
    whatWasExplainedWell: o.whatWasExplainedWell,
    notableAbsences,
  }
}

function tryParseAssistantContent(content: string): ExtractorOutput | null {
  const trimmed = content.trim()
  try {
    const raw = JSON.parse(trimmed) as unknown
    return parseModelJson(raw)
  } catch {
    return null
  }
}

export async function runExtractor(input: ExtractorInput): Promise<ExtractorOutput> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    throw new Error(
      'OPENROUTER_API_KEY is not set; cannot call OpenRouter for the extractor agent.',
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
        'Extractor received an empty assistant message from OpenRouter (choices[0].message.content is missing).',
      )
    }
    if (typeof contentRaw !== 'string') {
      throw new Error(
        'Extractor expected a string assistant message from OpenRouter; received non-text content.',
      )
    }

    const parsed = tryParseAssistantContent(contentRaw)
    if (parsed === null) {
      return createFallbackOutput(input)
    }
    return parsed
  } catch (err) {
    const detail =
      err instanceof Error
        ? err.message
        : typeof err === 'string'
          ? err
          : 'Unknown error'
    throw new Error(`Extractor agent failed while calling OpenRouter: ${detail}`)
  }
}
