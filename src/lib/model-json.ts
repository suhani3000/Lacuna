/**
 * Models often wrap JSON in markdown fences. Strip those before JSON.parse.
 */
export function stripAssistantJsonFence(text: string): string {
  const trimmed = text.trim()
  const loose = trimmed.match(/^```(?:json)?\s*\r?\n?([\s\S]*?)\r?\n?```$/im)
  if (loose?.[1]) {
    return loose[1].trim()
  }
  if (trimmed.startsWith('```')) {
    const withoutOpen = trimmed.replace(/^```(?:json)?\s*\r?\n?/i, '')
    const close = withoutOpen.lastIndexOf('```')
    if (close !== -1) {
      return withoutOpen.slice(0, close).trim()
    }
  }
  return trimmed
}
