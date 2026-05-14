/**
 * Escape text for safe HTML, then turn lightweight markers into HTML.
 * Used for assistant/coach bubbles only (never for raw user HTML).
 */
export function coachPlainTextToSafeHtml(text: string): string {
  const esc = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

  let t = esc
  t = t.replace(/«([^»]+)»/g, '<strong>$1</strong>')
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  t = t.replace(/`([^`]+)`/g, '<code class="coach-code">$1</code>')
  t = t.replace(/\n/g, '<br/>')
  return t
}
