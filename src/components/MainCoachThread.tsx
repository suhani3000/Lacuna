'use client'

import { useEffect, useRef, useState } from 'react'

import { coachPlainTextToSafeHtml } from '@/lib/coach-format'

export interface CoachContext {
  concept: string
  gap: string
  question: string
}

interface ChatRow {
  id: string
  role: string
  content: string
  createdAt: string
}

function escapePlainText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

interface MainCoachThreadProps {
  sessionId: string
  conversationId: string | null
  coachContext: CoachContext | null
  refreshTrigger: number
  /** After a Lacuna analysis exists, copy and layout focus on coaching. */
  analysisReady?: boolean
  className?: string
}

export default function MainCoachThread({
  sessionId,
  conversationId,
  coachContext,
  refreshTrigger,
  analysisReady = false,
  className = '',
}: MainCoachThreadProps) {
  const [messages, setMessages] = useState<ChatRow[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, sending])

  useEffect(() => {
    if (!sessionId || !conversationId) {
      let cancelledEmpty = false
      queueMicrotask(() => {
        if (cancelledEmpty) return
        setMessages([])
        setLoading(false)
      })
      return () => {
        cancelledEmpty = true
      }
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    void (async () => {
      try {
        const qs = new URLSearchParams({
          sessionId,
          conversationId,
        })
        const res = await fetch(`/api/chat?${qs.toString()}`)
        const data: unknown = await res.json()
        if (cancelled) return
        if (!res.ok) {
          const msg =
            typeof data === 'object' &&
            data !== null &&
            typeof (data as { error?: unknown }).error === 'string'
              ? (data as { error: string }).error
              : 'Failed to load chat'
          setError(msg)
          setMessages([])
          return
        }
        if (!Array.isArray(data)) {
          setError('Unexpected chat response')
          setMessages([])
          return
        }
        const rows: ChatRow[] = []
        for (const row of data) {
          if (typeof row !== 'object' || row === null) continue
          const r = row as Record<string, unknown>
          if (typeof r.id !== 'string') continue
          if (typeof r.role !== 'string') continue
          if (typeof r.content !== 'string') continue
          if (typeof r.createdAt !== 'string') continue
          rows.push({
            id: r.id,
            role: r.role,
            content: r.content,
            createdAt: r.createdAt,
          })
        }
        setMessages(rows)
      } catch {
        if (!cancelled) {
          setError('Failed to load chat')
          setMessages([])
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [sessionId, conversationId, refreshTrigger])

  async function handleSend(e: React.FormEvent) {
    e.preventDefault()
    const text = draft.trim()
    if (!text || !sessionId || !conversationId || sending) return

    setSending(true)
    setError(null)
    setDraft('')

    const optimisticId = `local_${Date.now()}`
    setMessages((prev) => [
      ...prev,
      {
        id: optimisticId,
        role: 'user',
        content: text,
        createdAt: new Date().toISOString(),
      },
    ])

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          conversationId,
          text,
          context: coachContext ?? undefined,
        }),
      })
      const data: unknown = await res.json()
      if (!res.ok) {
        const msg =
          typeof data === 'object' &&
          data !== null &&
          typeof (data as { error?: unknown }).error === 'string'
            ? (data as { error: string }).error
            : 'Message failed'
        setError(msg)
        setMessages((prev) => prev.filter((m) => m.id !== optimisticId))
        return
      }
      if (
        typeof data !== 'object' ||
        data === null ||
        typeof (data as { reply?: unknown }).reply !== 'string'
      ) {
        setError('Unexpected reply from server')
        setMessages((prev) => prev.filter((m) => m.id !== optimisticId))
        return
      }

      const qs = new URLSearchParams({ sessionId, conversationId })
      const reload = await fetch(`/api/chat?${qs.toString()}`)
      const list: unknown = await reload.json()
      if (reload.ok && Array.isArray(list)) {
        const rows: ChatRow[] = []
        for (const row of list) {
          if (typeof row !== 'object' || row === null) continue
          const r = row as Record<string, unknown>
          if (typeof r.id !== 'string') continue
          if (typeof r.role !== 'string') continue
          if (typeof r.content !== 'string') continue
          if (typeof r.createdAt !== 'string') continue
          rows.push({
            id: r.id,
            role: r.role,
            content: r.content,
            createdAt: r.createdAt,
          })
        }
        setMessages(rows)
      } else {
        const reply = (data as { reply: string }).reply
        setMessages((prev) => {
          const without = prev.filter((m) => m.id !== optimisticId)
          return [
            ...without,
            {
              id: `${optimisticId}_u`,
              role: 'user',
              content: text,
              createdAt: new Date().toISOString(),
            },
            {
              id: `${optimisticId}_a`,
              role: 'assistant',
              content: reply,
              createdAt: new Date().toISOString(),
            },
          ]
        })
      }
    } catch {
      setError('Network error while sending')
      setMessages((prev) => prev.filter((m) => m.id !== optimisticId))
    } finally {
      setSending(false)
    }
  }

  if (!conversationId) {
    return (
      <div
        className={`flex flex-1 flex-col items-center justify-center px-6 text-center text-sm text-gray-500 ${className}`}
      >
        <p className="max-w-md">
          Open the menu and choose <span className="text-gray-300">New topic</span> to start a
          conversation, then explain a concept below.
        </p>
      </div>
    )
  }

  return (
    <div className={`flex min-h-0 flex-1 flex-col ${className}`}>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-1 py-2 sm:px-2">
        {loading && (
          <p className="text-center text-xs text-gray-500" aria-busy="true">
            Loading messages…
          </p>
        )}
        {!loading && messages.length === 0 && (
          <p className="py-8 text-center text-sm text-gray-500">
            {analysisReady
              ? 'Your gap summary is on the right. Ask the coach about the follow-up question, or say what still feels fuzzy.'
              : 'Explain your concept above to run the first Lacuna check. The coach thread will grow here.'}
          </p>
        )}
        {messages.map((m) => (
          <div
            key={m.id}
            className={
              m.role === 'assistant'
                ? 'rounded-xl border border-indigo-900/40 bg-indigo-950/25 px-4 py-3 text-sm text-gray-100 shadow-sm'
                : 'rounded-xl border border-gray-800 bg-gray-900/70 px-4 py-3 text-sm text-gray-200'
            }
          >
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              {m.role === 'assistant' ? 'Coach' : 'You'}
            </p>
            {m.role === 'assistant' ? (
              <div
                className="coach-rich leading-relaxed [&_.coach-code]:rounded [&_.coach-code]:bg-gray-900 [&_.coach-code]:px-1 [&_.coach-code]:font-mono [&_.coach-code]:text-[13px] [&_strong]:font-semibold [&_strong]:text-white"
                dangerouslySetInnerHTML={{
                  __html: coachPlainTextToSafeHtml(m.content),
                }}
              />
            ) : (
              <p className="whitespace-pre-wrap leading-relaxed">{escapePlainText(m.content)}</p>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {error && (
        <p className="shrink-0 px-2 py-1 text-center text-xs text-red-400" role="alert">
          {error}
        </p>
      )}

      <form
        onSubmit={handleSend}
        className="shrink-0 border-t border-gray-800 bg-gray-950/80 p-3 sm:p-4"
      >
        <label htmlFor="coach-input" className="sr-only">
          Message to coach
        </label>
        <textarea
          id="coach-input"
          rows={3}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          disabled={!sessionId || sending}
          placeholder="Reply to the question, ask for a nudge, or say what still feels fuzzy…"
          className="mb-2 w-full resize-none rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-sm text-gray-100 placeholder:text-gray-600 focus:border-indigo-600 focus:outline-none focus:ring-1 focus:ring-indigo-600 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!sessionId || sending || !draft.trim()}
          className="w-full rounded-lg bg-indigo-600 px-3 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-gray-800 disabled:text-gray-500"
        >
          {sending ? 'Sending…' : 'Send'}
        </button>
      </form>
    </div>
  )
}
