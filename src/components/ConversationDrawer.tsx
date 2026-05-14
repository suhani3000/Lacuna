'use client'

import { useEffect, useState } from 'react'

export interface ConversationRow {
  id: string
  title: string
  createdAt: string
  updatedAt: string
}

interface ConversationDrawerProps {
  sessionId: string
  currentId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  listVersion: number
  onSelect: (id: string) => void
  onCreated: (row: ConversationRow) => void
}

function parseList(data: unknown): ConversationRow[] | null {
  if (!Array.isArray(data)) return null
  const out: ConversationRow[] = []
  for (const item of data) {
    if (typeof item !== 'object' || item === null) return null
    const o = item as Record<string, unknown>
    if (typeof o.id !== 'string') return null
    if (typeof o.title !== 'string') return null
    if (typeof o.createdAt !== 'string') return null
    if (typeof o.updatedAt !== 'string') return null
    out.push({
      id: o.id,
      title: o.title,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
    })
  }
  return out
}

export default function ConversationDrawer({
  sessionId,
  currentId,
  open,
  onOpenChange,
  listVersion,
  onSelect,
  onCreated,
}: ConversationDrawerProps) {
  const [items, setItems] = useState<ConversationRow[]>([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!sessionId) {
      setItems([])
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    void (async () => {
      try {
        const res = await fetch(
          `/api/conversations?sessionId=${encodeURIComponent(sessionId)}`,
        )
        const data: unknown = await res.json()
        if (cancelled) return
        if (!res.ok) {
          setError(
            typeof data === 'object' &&
              data !== null &&
              typeof (data as { error?: unknown }).error === 'string'
              ? (data as { error: string }).error
              : 'Failed to load topics',
          )
          setItems([])
          return
        }
        const parsed = parseList(data)
        setItems(parsed ?? [])
        if (parsed === null) setError('Unexpected topics response')
      } catch {
        if (!cancelled) {
          setError('Failed to load topics')
          setItems([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [sessionId, listVersion])

  async function handleNewTopic() {
    if (!sessionId || creating) return
    setCreating(true)
    setError(null)
    try {
      const res = await fetch('/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      })
      const data: unknown = await res.json()
      if (!res.ok) {
        const msg =
          typeof data === 'object' &&
          data !== null &&
          typeof (data as { error?: unknown }).error === 'string'
            ? (data as { error: string }).error
            : 'Could not start topic'
        setError(msg)
        return
      }
      if (
        typeof data !== 'object' ||
        data === null ||
        typeof (data as { id?: unknown }).id !== 'string' ||
        typeof (data as { title?: unknown }).title !== 'string' ||
        typeof (data as { createdAt?: unknown }).createdAt !== 'string' ||
        typeof (data as { updatedAt?: unknown }).updatedAt !== 'string'
      ) {
        setError('Unexpected create response')
        return
      }
      const row: ConversationRow = {
        id: (data as { id: string }).id,
        title: (data as { title: string }).title,
        createdAt: (data as { createdAt: string }).createdAt,
        updatedAt: (data as { updatedAt: string }).updatedAt,
      }
      setItems((prev) => [row, ...prev])
      onCreated(row)
      onOpenChange(false)
    } catch {
      setError('Network error')
    } finally {
      setCreating(false)
    }
  }

  return (
    <>
      {open && (
        <button
          type="button"
          aria-label="Close menu"
          className="fixed inset-0 top-14 z-40 bg-black/50 lg:hidden"
          onClick={() => onOpenChange(false)}
        />
      )}

      <aside
        id="topic-drawer"
        className={[
          'flex w-[min(100%,18rem)] flex-col border-r border-gray-800 bg-gray-950 sm:w-64',
          'max-lg:fixed max-lg:left-0 max-lg:top-14 max-lg:bottom-0 max-lg:z-50 max-lg:shadow-xl max-lg:transition-transform',
          open ? 'max-lg:translate-x-0' : 'max-lg:-translate-x-full',
          'lg:static lg:z-0 lg:h-full lg:translate-x-0 lg:shrink-0',
        ].join(' ')}
      >
        <div className="flex items-center justify-between border-b border-gray-800 px-3 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Topics</p>
          <button
            type="button"
            className="rounded-md px-2 py-1 text-xs text-gray-400 hover:bg-gray-900 hover:text-gray-200 lg:hidden"
            onClick={() => onOpenChange(false)}
          >
            Close
          </button>
        </div>

        <div className="px-3 py-2">
          <button
            type="button"
            onClick={handleNewTopic}
            disabled={!sessionId || creating}
            className="w-full rounded-lg border border-indigo-700/60 bg-indigo-950/40 px-3 py-2 text-sm font-medium text-indigo-100 transition hover:bg-indigo-900/50 disabled:opacity-50"
          >
            {creating ? 'Starting…' : '+ New topic'}
          </button>
        </div>

        {error && (
          <p className="px-3 pb-2 text-center text-xs text-red-400" role="alert">
            {error}
          </p>
        )}

        <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-4" aria-label="Conversations">
          {loading && (
            <p className="px-2 py-4 text-center text-xs text-gray-500">Loading…</p>
          )}
          {!loading && items.length === 0 && (
            <p className="px-2 py-6 text-center text-xs text-gray-500">
              No topics yet. Start with &quot;New topic&quot;.
            </p>
          )}
          <ul className="space-y-1">
            {items.map((it) => {
              const active = it.id === currentId
              return (
                <li key={it.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onSelect(it.id)
                      onOpenChange(false)
                    }}
                    className={`w-full rounded-lg px-3 py-2.5 text-left text-sm transition ${
                      active
                        ? 'bg-gray-900 text-white ring-1 ring-indigo-600/60'
                        : 'text-gray-300 hover:bg-gray-900/80'
                    }`}
                  >
                    <span className="line-clamp-2 font-medium">{it.title}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        </nav>
      </aside>
    </>
  )
}
