const SESSION_KEY = 'lacuna_session_id'
const LEGACY_SESSION_KEY = 'feynman_session_id'

const NOTION_PARENT_STORAGE_KEY = 'lacuna_notion_parent_id'
const LEGACY_NOTION_PARENT_KEY = 'feynman_notion_parent_id'

export function getOrCreateSessionId(): string {
  if (typeof window === 'undefined') return ''
  let existing = localStorage.getItem(SESSION_KEY)
  if (!existing) {
    const legacy = localStorage.getItem(LEGACY_SESSION_KEY)
    if (legacy) {
      localStorage.setItem(SESSION_KEY, legacy)
      localStorage.removeItem(LEGACY_SESSION_KEY)
      existing = legacy
    }
  }
  if (existing) return existing
  const id = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
  localStorage.setItem(SESSION_KEY, id)
  return id
}

/** Read Notion parent id; migrates legacy `feynman_notion_parent_id` key once. */
export function readNotionParentFromStorage(): string {
  if (typeof window === 'undefined') return ''
  const v = localStorage.getItem(NOTION_PARENT_STORAGE_KEY)
  if (v) return v
  const legacy = localStorage.getItem(LEGACY_NOTION_PARENT_KEY)
  if (legacy) {
    localStorage.setItem(NOTION_PARENT_STORAGE_KEY, legacy)
    localStorage.removeItem(LEGACY_NOTION_PARENT_KEY)
    return legacy
  }
  return ''
}

export function writeNotionParentToStorage(value: string): void {
  if (typeof window === 'undefined') return
  const v = value.trim()
  if (v) {
    localStorage.setItem(NOTION_PARENT_STORAGE_KEY, v)
    localStorage.removeItem(LEGACY_NOTION_PARENT_KEY)
  } else {
    localStorage.removeItem(NOTION_PARENT_STORAGE_KEY)
    localStorage.removeItem(LEGACY_NOTION_PARENT_KEY)
  }
}
