const SESSION_KEY = 'feynman_session_id'

export function getOrCreateSessionId(): string {
  if (typeof window === 'undefined') return ''
  const existing = localStorage.getItem(SESSION_KEY)
  if (existing) return existing
  const id = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
  localStorage.setItem(SESSION_KEY, id)
  return id
}