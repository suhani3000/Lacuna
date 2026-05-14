'use client'

import { useEffect, useRef, useState } from 'react'

import { getOrCreateSessionId, readNotionParentFromStorage, writeNotionParentToStorage } from '@/lib/session'

export interface GapCardProps {
  concept: string
  data: {
    gap: string
    question: string
    hint: string
    recurringPattern: string | null
    severity: string
  }
  variant?: 'default' | 'compact'
}

function severityStyles(severity: string): { label: string; className: string } {
  const s = severity.toLowerCase()
  if (s === 'significant') {
    return {
      label: 'Significant',
      className:
        'border border-red-800 bg-red-950 text-red-200 ring-1 ring-red-800/60',
    }
  }
  if (s === 'moderate') {
    return {
      label: 'Moderate',
      className:
        'border border-yellow-800 bg-yellow-950 text-yellow-100 ring-1 ring-yellow-800/60',
    }
  }
  return {
    label: 'Minor',
    className:
      'border border-blue-800 bg-blue-950 text-blue-100 ring-1 ring-blue-800/60',
  }
}

export default function GapCard({
  concept,
  data,
  variant = 'default',
}: GapCardProps) {
  const [hintVisible, setHintVisible] = useState(false)
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveErrorDetail, setSaveErrorDetail] = useState<string | null>(null)
  const [notionParentId, setNotionParentId] = useState('')
  const notionParentRef = useRef<HTMLInputElement>(null)
  const badge = severityStyles(data.severity)
  const compact = variant === 'compact'
  const showNotionControls =
    saveStatus === 'idle' || saveStatus === 'saving' || saveStatus === 'error'

  useEffect(() => {
    let cancelled = false
    queueMicrotask(() => {
      if (cancelled) return
      try {
        setNotionParentId(readNotionParentFromStorage())
      } catch {
        setNotionParentId('')
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (saveStatus !== 'saved' && saveStatus !== 'error') return
    const t = window.setTimeout(() => {
      setSaveStatus('idle')
      setSaveErrorDetail(null)
    }, 3000)
    return () => window.clearTimeout(t)
  }, [saveStatus])

  async function handleSaveToNotion() {
    setSaveErrorDetail(null)
    setSaveStatus('saving')
    const trimmedParent = notionParentId.trim()
    try {
      writeNotionParentToStorage(trimmedParent)
    } catch {
      /* ignore */
    }
    try {
      const res = await fetch('/api/composio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: getOrCreateSessionId(),
          concept,
          gap: data.gap,
          question: data.question,
          hint: data.hint,
          ...(trimmedParent ? { notionParentId: trimmedParent } : {}),
        }),
      })
      const json: unknown = await res.json()
      if (
        typeof json === 'object' &&
        json !== null &&
        (json as { requiresAuth?: unknown }).requiresAuth === true &&
        typeof (json as { authUrl?: unknown }).authUrl === 'string' &&
        (json as { authUrl: string }).authUrl.trim() !== ''
      ) {
        window.location.href = (json as { authUrl: string }).authUrl.trim()
        return
      }
      const success =
        typeof json === 'object' &&
        json !== null &&
        (json as { success?: unknown }).success === true
      if (success) {
        setSaveStatus('saved')
        return
      }
      const errText =
        typeof json === 'object' &&
        json !== null &&
        typeof (json as { error?: unknown }).error === 'string'
          ? (json as { error: string }).error
          : null
      const detail = errText ?? 'Save failed.'
      setSaveErrorDetail(detail)
      setSaveStatus('error')
      if (detail.includes('Missing Notion parent')) {
        requestAnimationFrame(() => notionParentRef.current?.focus())
      }
    } catch {
      setSaveErrorDetail('Network error while calling Composio.')
      setSaveStatus('error')
    }
  }

  return (
    <div
      className={
        compact
          ? 'space-y-3 rounded-xl border border-gray-800/90 bg-gray-900/40 p-3 shadow-sm sm:p-4'
          : 'space-y-6 rounded-xl border border-gray-800 bg-gray-900 p-6 shadow-sm'
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide sm:text-xs ${badge.className}`}
        >
          {badge.label}
        </span>
        <h2
          className={
            compact
              ? 'text-sm font-semibold text-gray-100'
              : 'text-base font-semibold text-gray-100'
          }
        >
          Gap: <span className="text-gray-300">{concept}</span>
        </h2>
      </div>

      <section
        className={
          compact
            ? 'rounded-lg border border-amber-800/80 bg-amber-950/80 p-3'
            : 'rounded-lg border border-amber-800 bg-amber-950 p-4'
        }
        aria-labelledby="gap-heading"
      >
        <p
          id="gap-heading"
          className="text-[10px] font-semibold uppercase tracking-wider text-amber-200/90 sm:text-xs"
        >
          What you missed
        </p>
        <p
          className={
            compact
              ? 'mt-1.5 text-xs leading-relaxed text-amber-50 sm:text-sm'
              : 'mt-2 text-sm leading-relaxed text-amber-50'
          }
        >
          {data.gap.trim()
            ? data.gap
            : 'The model did not return a single gap sentence, but your explanation still looks incomplete on the key mechanism or edge cases for this topic.'}
        </p>
      </section>

      <section className="relative" aria-labelledby="question-heading">
        <p id="question-heading" className="sr-only">
          The question
        </p>
        {!compact && (
          <span
            className="pointer-events-none select-none font-serif text-5xl leading-none text-indigo-500/40 sm:text-7xl"
            aria-hidden
          >
            &ldquo;
          </span>
        )}
        <blockquote
          className={
            compact
              ? 'border-l-4 border-indigo-500 pl-3'
              : '-mt-8 border-l-4 border-indigo-500 pl-4 sm:-mt-10 sm:pl-6'
          }
        >
          <p
            className={
              compact
                ? 'text-sm font-semibold leading-snug text-gray-50'
                : 'text-xl font-semibold leading-snug text-gray-50 sm:text-2xl sm:leading-snug'
            }
          >
            {data.question}
          </p>
        </blockquote>
      </section>

      <div className="space-y-1.5">
        {saveStatus === 'saved' && (
          <p className="text-xs font-medium text-green-400 sm:text-sm" role="status">
            ✓ Saved to Notion
          </p>
        )}
        {saveStatus === 'error' && (
          <div className="space-y-1" role="alert">
            <p className="text-xs font-medium text-red-300 sm:text-sm">Couldn’t save to Notion</p>
            <p className="line-clamp-5 text-xs leading-relaxed text-red-400/95 sm:text-sm">
              {saveErrorDetail ??
                'Sync failed — connect Notion in Composio (see hint below), then try again.'}
            </p>
          </div>
        )}
        {showNotionControls && (
          <details className="group rounded-lg border border-gray-800/80 bg-gray-950/50 open:border-indigo-900/30 open:bg-indigo-950/10">
            <summary className="cursor-pointer list-none px-3 py-2.5 text-xs font-medium text-gray-300 transition hover:text-white [&::-webkit-details-marker]:hidden">
              <span className="inline-flex w-full items-center justify-between gap-2">
                <span>Notion export</span>
                <span className="text-[10px] font-normal text-gray-500 group-open:text-indigo-300/80">
                  {saveStatus === 'saving' ? 'Saving…' : 'Open'}
                </span>
              </span>
            </summary>
            <div className="space-y-2 border-t border-gray-800/60 px-3 pb-3 pt-2">
              {(saveStatus === 'idle' || saveStatus === 'error') && (
                <p className="text-[10px] leading-relaxed text-gray-500 sm:text-xs">
                  <strong className="text-gray-400">Parent</strong> — page or database ID from its
                  Notion URL (or paste the full URL). Stored in this browser. Then save.
                </p>
              )}
              <div className="space-y-1">
                <label
                  htmlFor="lacuna-notion-parent"
                  className="sr-only"
                >
                  Notion parent page or database ID
                </label>
                <input
                  ref={notionParentRef}
                  id="lacuna-notion-parent"
                  type="text"
                  value={notionParentId}
                  onChange={(e) => setNotionParentId(e.target.value)}
                  onBlur={() => {
                    try {
                      writeNotionParentToStorage(notionParentId)
                    } catch {
                      /* ignore */
                    }
                  }}
                  placeholder="Notion URL or parent ID"
                  disabled={saveStatus === 'saving'}
                  autoComplete="off"
                  className={
                    saveStatus === 'error' && saveErrorDetail?.includes('Missing Notion parent')
                      ? 'w-full rounded-md border border-amber-600/70 bg-gray-900/90 px-2.5 py-2 font-mono text-[11px] text-gray-100 placeholder:text-gray-600 focus:border-amber-500 focus:outline-none focus:ring-1 focus:ring-amber-500 sm:text-xs'
                      : 'w-full rounded-md border border-gray-700/90 bg-gray-900/90 px-2.5 py-2 font-mono text-[11px] text-gray-200 placeholder:text-gray-600 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 sm:text-xs'
                  }
                />
              </div>
              <button
                type="button"
                onClick={handleSaveToNotion}
                disabled={saveStatus === 'saving'}
                className="w-full rounded-md border border-gray-700 bg-gray-800/60 px-3 py-2 text-xs font-medium text-gray-200 transition hover:border-indigo-600/50 hover:bg-indigo-950/40 hover:text-white focus:outline-none focus:ring-2 focus:ring-indigo-600 disabled:cursor-not-allowed disabled:opacity-50 sm:text-sm"
              >
                {saveStatus === 'saving' ? 'Saving…' : 'Save gap to Notion'}
              </button>
            </div>
          </details>
        )}
      </div>

      {data.hint.trim().length > 0 && (
        <section className="space-y-1.5" aria-label="Hint">
          <button
            type="button"
            onClick={() => setHintVisible((v) => !v)}
            className="text-xs font-medium text-indigo-400 underline-offset-4 hover:text-indigo-300 hover:underline focus:outline-none focus:ring-2 focus:ring-indigo-500 sm:text-sm"
          >
            {hintVisible ? 'Hide hint' : 'Show hint →'}
          </button>
          {hintVisible && (
            <p
              className={
                compact
                  ? 'border-l-2 border-gray-700 pl-2 text-xs italic leading-relaxed text-gray-400'
                  : 'border-l-2 border-gray-700 pl-3 text-sm italic leading-relaxed text-gray-400'
              }
            >
              {data.hint}
            </p>
          )}
        </section>
      )}

      {data.recurringPattern !== null && data.recurringPattern.trim().length > 0 && (
        <section
          className={
            compact
              ? 'rounded-lg border border-purple-800/80 bg-purple-950/60 p-3'
              : 'rounded-lg border border-purple-800 bg-purple-950 p-4'
          }
          aria-labelledby="pattern-heading"
        >
          <p
            id="pattern-heading"
            className="text-[10px] font-semibold uppercase tracking-wider text-purple-200/90 sm:text-xs"
          >
            Recurring pattern
          </p>
          <p
            className={
              compact
                ? 'mt-1 text-xs leading-relaxed text-purple-50'
                : 'mt-2 text-sm leading-relaxed text-purple-50'
            }
          >
            {data.recurringPattern}
          </p>
        </section>
      )}

    </div>
  )
}
