'use client'

import { useCallback, useEffect, useState } from 'react'

import ConversationDrawer from '@/components/ConversationDrawer'
import type { ConversationRow } from '@/components/ConversationDrawer'
import FeynmanInput from '@/components/FeynmanInput'
import GapCard from '@/components/GapCard'
import History from '@/components/History'
import type { HistoryItem } from '@/components/History'
import MainCoachThread from '@/components/MainCoachThread'
import Terminal from '@/components/Terminal'
import { getOrCreateSessionId } from '@/lib/session'

export default function Page() {
  const [sessionId, setSessionId] = useState('')
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [listVersion, setListVersion] = useState(0)

  const [concept, setConcept] = useState('')
  const [explanation, setExplanation] = useState('')
  const [phase, setPhase] = useState<'input' | 'streaming'>('input')
  const [analysisResult, setAnalysisResult] = useState<null | {
    gap: string
    question: string
    hint: string
    recurringPattern: string | null
    severity: string
  }>(null)

  const [historyRefresh, setHistoryRefresh] = useState(0)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const coachContext =
    analysisResult && concept
      ? { concept, gap: analysisResult.gap, question: analysisResult.question }
      : null

  useEffect(() => {
    setSessionId(getOrCreateSessionId())
  }, [])

  const hydrateFromHistory = useCallback(
    async (cid: string) => {
      if (!sessionId) return
      const qs = new URLSearchParams({ sessionId, conversationId: cid })
      try {
        const res = await fetch(`/api/history?${qs.toString()}`)
        const data: unknown = await res.json()
        if (!res.ok || !Array.isArray(data) || data.length === 0) {
          setAnalysisResult(null)
          setConcept('')
          return
        }
        const latest = data[0] as HistoryItem
        setConcept(latest.concept)
        setAnalysisResult({
          gap: latest.gap,
          question: latest.question,
          hint: typeof latest.hint === 'string' ? latest.hint : '',
          recurringPattern:
            typeof latest.recurringPattern === 'string' ? latest.recurringPattern : null,
          severity: typeof latest.severity === 'string' ? latest.severity : 'minor',
        })
      } catch {
        setAnalysisResult(null)
        setConcept('')
      }
    },
    [sessionId],
  )

  const handleSelectConversation = useCallback(
    (id: string) => {
      setConversationId(id)
      setPhase('input')
      setExplanation('')
      setErrorMessage(null)
      void hydrateFromHistory(id)
      setHistoryRefresh((n) => n + 1)
    },
    [hydrateFromHistory],
  )

  const handleCreatedConversation = useCallback((row: ConversationRow) => {
    setConversationId(row.id)
    setPhase('input')
    setExplanation('')
    setConcept('')
    setAnalysisResult(null)
    setErrorMessage(null)
    setListVersion((n) => n + 1)
    setHistoryRefresh((n) => n + 1)
  }, [])

  function handleSubmit(payload: { concept: string; explanation: string }) {
    if (!conversationId) {
      setErrorMessage('Pick or create a topic from the menu first.')
      return
    }
    setConcept(payload.concept)
    setExplanation(payload.explanation)
    setPhase('streaming')
    setErrorMessage(null)
  }

  function handleComplete(data: {
    gap: string
    question: string
    hint: string
    recurringPattern: string | null
    severity: string
  }) {
    setAnalysisResult(data)
    setPhase('input')
    setHistoryRefresh((n) => n + 1)
    setListVersion((n) => n + 1)
  }

  function handleError(message: string) {
    setErrorMessage(message)
    setPhase('input')
  }

  const showFeynmanPanel = phase === 'input' && !analysisResult
  const showStreamingPanel = phase === 'streaming' && Boolean(conversationId)

  function clearSidePanel() {
    setAnalysisResult(null)
  }

  return (
    <div className="flex h-dvh flex-col bg-gray-950 text-gray-100">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-gray-800 bg-gray-950/95 px-2 sm:px-3">
        <button
          type="button"
          aria-expanded={drawerOpen}
          aria-controls="topic-drawer"
          onClick={() => setDrawerOpen((v) => !v)}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gray-800 bg-gray-900 text-gray-200 hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <span className="sr-only">Topics menu</span>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path
              d="M4 6h16M4 12h16M4 18h16"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
        </button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-bold tracking-tight text-white sm:text-lg">
            The Feynman Test
          </h1>
          <p className="hidden truncate text-xs text-gray-500 sm:block">
            Coach chat is the main thread; each new topic is a new conversation.
          </p>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <ConversationDrawer
          sessionId={sessionId}
          currentId={conversationId}
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          listVersion={listVersion}
          onSelect={handleSelectConversation}
          onCreated={handleCreatedConversation}
        />

        <main className="flex min-h-0 min-w-0 flex-1 flex-col border-gray-800 lg:border-l">
          {errorMessage && (
            <div
              className="mx-3 mt-3 flex shrink-0 items-start justify-between gap-3 rounded-lg border border-red-800 bg-red-950/60 px-3 py-2 text-sm text-red-100"
              role="alert"
            >
              <p className="min-w-0 flex-1">{errorMessage}</p>
              <button
                type="button"
                onClick={() => setErrorMessage(null)}
                className="shrink-0 rounded-md border border-red-700/80 px-2 py-0.5 text-xs font-medium text-red-100 transition hover:bg-red-900/80"
              >
                Dismiss
              </button>
            </div>
          )}

          {showStreamingPanel ? (
            <section
              className="flex min-h-0 flex-1 flex-col border-b border-gray-800/60 bg-linear-to-b from-gray-950 to-gray-950/80"
              aria-label="Analysis in progress"
            >
              <div className="flex shrink-0 items-center gap-2 border-b border-gray-800/80 px-4 py-2.5 sm:px-5">
                <span
                  className="inline-block size-2 animate-pulse rounded-full bg-indigo-400"
                  aria-hidden
                />
                <p className="text-xs font-medium text-gray-300 sm:text-sm">
                  Running Feynman check on your explanation…
                </p>
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">
                <Terminal
                  isStreaming={phase === 'streaming'}
                  concept={concept}
                  explanation={explanation}
                  sessionId={sessionId}
                  conversationId={conversationId!}
                  onComplete={handleComplete}
                  onError={handleError}
                />
              </div>
            </section>
          ) : (
            <>
              {showFeynmanPanel && (
                <section className="shrink-0 border-b border-gray-800/80 bg-gray-950/40 px-3 py-3 sm:px-5 sm:py-4">
                  <FeynmanInput
                    key={historyRefresh}
                    onSubmit={handleSubmit}
                    isDisabled={!sessionId || !conversationId}
                    compact
                  />
                </section>
              )}
              <MainCoachThread
                className="min-h-0 flex-1"
                sessionId={sessionId}
                conversationId={conversationId}
                coachContext={coachContext}
                refreshTrigger={historyRefresh}
                analysisReady={Boolean(analysisResult)}
              />
            </>
          )}
        </main>

        <aside className="flex max-h-[min(42vh,22rem)] w-full shrink-0 flex-col border-t border-gray-800/90 bg-gray-950 lg:max-h-none lg:min-h-0 lg:w-80 lg:max-w-[min(100vw,20rem)] lg:shrink-0 lg:border-l lg:border-t-0 xl:w-96">
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-y-contain p-3 sm:p-4">
            {analysisResult && concept ? (
              <GapCard
                concept={concept}
                data={analysisResult}
                variant="compact"
                showFooter
                onReset={clearSidePanel}
              />
            ) : (
              <div className="rounded-xl border border-dashed border-gray-800/90 bg-gray-900/30 px-3 py-6 text-center text-xs leading-relaxed text-gray-500 sm:text-sm">
                After a Feynman check, your gap and follow-up land here. Use the menu to pick a
                topic first.
              </div>
            )}

            <History
              sessionId={sessionId}
              conversationId={conversationId}
              refreshTrigger={historyRefresh}
            />
          </div>
        </aside>
      </div>
    </div>
  )
}
