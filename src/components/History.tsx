'use client'

import { useEffect, useState } from 'react'

export interface HistoryProps {
  sessionId: string
  conversationId: string | null
  refreshTrigger: number
}

export interface HistoryItem {
  id: string
  concept: string
  gap: string
  question: string
  createdAt: string
  hint?: string | null
  severity?: string | null
  recurringPattern?: string | null
}

function timeAgo(dateString: string): string {
  const then = new Date(dateString).getTime()
  if (Number.isNaN(then)) {
    return ''
  }
  const diffSec = Math.floor((Date.now() - then) / 1000)
  if (diffSec < 45) {
    return 'Just now'
  }
  const mins = Math.floor(diffSec / 60)
  if (mins < 60) {
    return mins === 1 ? '1 min ago' : `${mins} min ago`
  }
  const hours = Math.floor(mins / 60)
  if (hours < 24) {
    return hours === 1 ? '1 hour ago' : `${hours} hours ago`
  }
  const days = Math.floor(hours / 24)
  return days === 1 ? '1 day ago' : `${days} days ago`
}

function isHistoryItem(row: unknown): row is HistoryItem {
  if (typeof row !== 'object' || row === null) return false
  const r = row as Record<string, unknown>
  if (typeof r.id !== 'string') return false
  if (typeof r.concept !== 'string') return false
  if (typeof r.gap !== 'string') return false
  if (typeof r.question !== 'string') return false
  if (typeof r.createdAt !== 'string') return false
  if (Number.isNaN(new Date(r.createdAt).getTime())) return false
  if ('hint' in r && r.hint != null && typeof r.hint !== 'string') return false
  if ('severity' in r && r.severity != null && typeof r.severity !== 'string') return false
  if (
    'recurringPattern' in r &&
    r.recurringPattern != null &&
    typeof r.recurringPattern !== 'string'
  ) {
    return false
  }
  return true
}

function parseHistoryPayload(data: unknown): HistoryItem[] | null {
  if (!Array.isArray(data)) return null
  const items: HistoryItem[] = []
  for (const row of data) {
    if (!isHistoryItem(row)) return null
    items.push(row)
  }
  return items
}

export default function History({
  sessionId,
  conversationId,
  refreshTrigger,
}: HistoryProps) {
  const [items, setItems] = useState<HistoryItem[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!sessionId || !conversationId) {
      let cancelled = false
      queueMicrotask(() => {
        if (cancelled) return
        setItems([])
        setIsLoading(false)
        setError(null)
      })
      return () => {
        cancelled = true
      }
    }

    let cancelled = false
    setIsLoading(true)
    setError(null)

    void (async () => {
      try {
        const qs = new URLSearchParams({
          sessionId,
          conversationId,
        })
        const res = await fetch(`/api/history?${qs.toString()}`)
        const data: unknown = await res.json()

        if (cancelled) return

        if (!res.ok) {
          const msg =
            typeof data === 'object' &&
            data !== null &&
            typeof (data as { error?: unknown }).error === 'string'
              ? (data as { error: string }).error
              : 'Failed to load history'
          setError(msg)
          setItems([])
          return
        }

        const parsed = parseHistoryPayload(data)
        if (parsed === null) {
          setError('Unexpected response from server')
          setItems([])
          return
        }

        setItems(parsed)
      } catch {
        if (!cancelled) {
          setError('Failed to load history')
          setItems([])
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [sessionId, conversationId, refreshTrigger])

  return (
    <div className="rounded-xl border border-gray-800/90 bg-gray-900/50 p-3 sm:p-4">
      <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
        Past analyses (this topic)
      </h3>

      {!conversationId && (
        <p className="py-6 text-center text-sm text-gray-500">
          Select a topic to see its analysis history.
        </p>
      )}

      {conversationId && isLoading && (
        <div className="space-y-3" aria-busy="true" aria-label="Loading history">
          <div className="h-14 w-full animate-pulse rounded-lg bg-gray-800" />
          <div className="h-14 w-full animate-pulse rounded-lg bg-gray-800" />
        </div>
      )}

      {conversationId && !isLoading && error && (
        <p className="py-4 text-center text-sm text-red-400">{error}</p>
      )}

      {conversationId && !isLoading && !error && items.length === 0 && (
        <p className="py-4 text-center text-xs leading-relaxed text-gray-500 sm:text-sm">
          No checks in this thread yet. Run one from the explanation area when it&apos;s visible.
        </p>
      )}

      {conversationId && !isLoading && !error && items.length > 0 && (
        <ul className="max-h-52 space-y-2 overflow-y-auto pr-0.5 sm:max-h-64">
          {items.map((item) => (
            <li key={item.id}>
              <article className="rounded-lg border border-gray-800 bg-gray-950/80 p-3">
                <div className="mb-2 flex items-start justify-between gap-3">
                  <h4 className="text-sm font-bold text-gray-100">{item.concept}</h4>
                  <time
                    className="shrink-0 text-xs text-gray-500"
                    dateTime={item.createdAt}
                  >
                    {timeAgo(item.createdAt)}
                  </time>
                </div>
                <p className="line-clamp-2 text-sm leading-snug text-gray-300">{item.gap}</p>
                <p className="mt-1 line-clamp-2 text-sm italic text-gray-400">{item.question}</p>
              </article>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
