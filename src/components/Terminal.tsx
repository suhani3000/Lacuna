'use client'

import { useEffect, useRef, useState } from 'react'

export interface TerminalProps {
  isStreaming: boolean
  concept: string
  explanation: string
  sessionId: string
  conversationId: string
  onComplete: (data: {
    gap: string
    question: string
    hint: string
    recurringPattern: string | null
    severity: string
  }) => void
  onError: (message: string) => void
}

type SSEMessage =
  | { step: 1 | 2 | 3 | 4; type: 'thinking'; status: string }
  | { step: 1 | 2 | 3 | 4; type: 'done'; label: string }
  | {
      type: 'complete'
      gap: string
      question: string
      hint: string
      recurringPattern: string | null
      severity: string
    }
  | { type: 'error'; message: string }

interface TerminalLine {
  id: number
  text: string
  variant: 'thinking' | 'done' | 'error' | 'system'
  step?: 1 | 2 | 3 | 4
}

function isStep(n: unknown): n is 1 | 2 | 3 | 4 {
  return n === 1 || n === 2 || n === 3 || n === 4
}

function parseSSEMessage(raw: unknown): SSEMessage | null {
  if (typeof raw !== 'object' || raw === null) return null
  const m = raw as Record<string, unknown>
  const t = m.type

  if (t === 'thinking') {
    if (!isStep(m.step) || typeof m.status !== 'string') return null
    return { type: 'thinking', step: m.step, status: m.status }
  }
  if (t === 'done') {
    if (!isStep(m.step) || typeof m.label !== 'string') return null
    return { type: 'done', step: m.step, label: m.label }
  }
  if (t === 'complete') {
    if (
      typeof m.gap !== 'string' ||
      typeof m.question !== 'string' ||
      typeof m.hint !== 'string' ||
      typeof m.severity !== 'string' ||
      !('recurringPattern' in m) ||
      (m.recurringPattern !== null && typeof m.recurringPattern !== 'string')
    ) {
      return null
    }
    return {
      type: 'complete',
      gap: m.gap,
      question: m.question,
      hint: m.hint,
      recurringPattern: m.recurringPattern as string | null,
      severity: m.severity,
    }
  }
  if (t === 'error') {
    if (typeof m.message !== 'string') return null
    return { type: 'error', message: m.message }
  }
  return null
}

export default function Terminal({
  isStreaming,
  concept,
  explanation,
  sessionId,
  conversationId,
  onComplete,
  onError,
}: TerminalProps) {
  const [lines, setLines] = useState<TerminalLine[]>([])
  const [isActive, setIsActive] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const linesRef = useRef<TerminalLine[]>([])
  const nextLineId = useRef(0)
  const onCompleteRef = useRef(onComplete)
  const onErrorRef = useRef(onError)

  useEffect(() => {
    onCompleteRef.current = onComplete
    onErrorRef.current = onError
  }, [onComplete, onError])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
  }, [lines])

  useEffect(() => {
    if (!isStreaming) return

    const controller = new AbortController()

    const bumpId = () => {
      nextLineId.current += 1
      return nextLineId.current
    }

    const syncLines = () => {
      setLines([...linesRef.current])
    }

    void (async () => {
      nextLineId.current = 0
      linesRef.current = [
        {
          id: bumpId(),
          text: 'Starting agent pipeline…',
          variant: 'system',
        },
      ]
      setIsActive(true)
      syncLines()

      const applyMessage = (msg: SSEMessage) => {
        if (msg.type === 'thinking') {
          linesRef.current = [
            ...linesRef.current,
            {
              id: bumpId(),
              text: `Step ${msg.step}: ${msg.status}`,
              variant: 'thinking',
              step: msg.step,
            },
          ]
          syncLines()
          return
        }

        if (msg.type === 'done') {
          const arr = [...linesRef.current]
          let lastIdx = -1
          for (let i = arr.length - 1; i >= 0; i--) {
            const line = arr[i]
            if (line.variant === 'thinking' && line.step === msg.step) {
              lastIdx = i
              break
            }
          }
          if (lastIdx === -1) {
            arr.push({
              id: bumpId(),
              text: `Step ${msg.step}: ${msg.label}`,
              variant: 'done',
              step: msg.step,
            })
          } else {
            arr[lastIdx] = {
              ...arr[lastIdx],
              text: `Step ${msg.step}: ${msg.label}`,
              variant: 'done',
            }
          }
          linesRef.current = arr
          syncLines()
          return
        }

        if (msg.type === 'complete') {
          onCompleteRef.current({
            gap: msg.gap,
            question: msg.question,
            hint: msg.hint,
            recurringPattern: msg.recurringPattern,
            severity: msg.severity,
          })
          return
        }

        if (msg.type === 'error') {
          linesRef.current = [
            ...linesRef.current,
            {
              id: bumpId(),
              text: msg.message,
              variant: 'error',
            },
          ]
          syncLines()
          onErrorRef.current(msg.message)
        }
      }

      const processDataLine = (jsonStr: string) => {
        const trimmed = jsonStr.trim()
        if (trimmed === '' || trimmed === '[DONE]') return
        let parsed: unknown
        try {
          parsed = JSON.parse(trimmed) as unknown
        } catch {
          return
        }
        const msg = parseSSEMessage(parsed)
        if (msg) applyMessage(msg)
      }

      const consumeBuffer = (buffer: string, flushFinal: boolean) => {
        const parts = buffer.split('\n')
        const rest = flushFinal ? '' : (parts.pop() ?? '')
        for (const part of parts) {
          const trimmed = part.replace(/\r$/, '').trim()
          if (!trimmed.startsWith('data:')) continue
          const payload = trimmed.startsWith('data: ')
            ? trimmed.slice(6)
            : trimmed.slice(5).trimStart()
          processDataLine(payload)
        }
        return rest
      }

      try {
        const response = await fetch('/api/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ concept, explanation, sessionId, conversationId }),
          signal: controller.signal,
        })

        if (!response.ok) {
          const errText = `Request failed (${response.status})`
          linesRef.current = [
            ...linesRef.current,
            { id: bumpId(), text: errText, variant: 'error' },
          ]
          syncLines()
          onErrorRef.current(errText)
          return
        }

        const reader = response.body?.getReader()
        if (!reader) {
          const errText = 'No response body from /api/analyze'
          linesRef.current = [
            ...linesRef.current,
            { id: bumpId(), text: errText, variant: 'error' },
          ]
          syncLines()
          onErrorRef.current(errText)
          return
        }

        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (value) {
            buffer += decoder.decode(value, { stream: !done })
          }
          buffer = consumeBuffer(buffer, done)
          if (done) break
        }

        if (buffer.trim()) {
          const t = buffer.trim()
          if (t.startsWith('data:')) {
            const payload = t.startsWith('data: ') ? t.slice(6) : t.slice(5).trimStart()
            processDataLine(payload)
          }
        }
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          return
        }
        const message =
          err instanceof Error ? err.message : 'Pipeline failed unexpectedly'
        linesRef.current = [
          ...linesRef.current,
          { id: bumpId(), text: message, variant: 'error' },
        ]
        syncLines()
        onErrorRef.current(message)
      } finally {
        setIsActive(false)
      }
    })()

    return () => {
      controller.abort()
    }
  }, [isStreaming, concept, explanation, sessionId, conversationId])

  return (
    <div className="overflow-hidden rounded-xl border border-gray-800 bg-gray-950">
      <div className="flex items-center gap-2 border-b border-gray-800 bg-gray-900 px-4 py-2">
        <span className="inline-block h-3 w-3 rounded-full bg-red-500" aria-hidden />
        <span className="inline-block h-3 w-3 rounded-full bg-yellow-500" aria-hidden />
        <span className="inline-block h-3 w-3 rounded-full bg-green-500" aria-hidden />
        <span className="pl-1 text-sm font-medium text-gray-200">● Agent Pipeline</span>
      </div>

      <div
        ref={scrollRef}
        className="max-h-80 min-h-48 space-y-1 overflow-y-auto p-4 font-mono text-sm"
      >
        {lines.map((line) => {
          if (line.variant === 'thinking') {
            return (
              <div key={line.id} className="text-gray-400">
                <span>► </span>
                <span>{line.text}</span>
                <span className="inline-block animate-pulse">…</span>
              </div>
            )
          }
          if (line.variant === 'done') {
            return (
              <div key={line.id} className="text-green-400">
                ✓ {line.text}
              </div>
            )
          }
          if (line.variant === 'error') {
            return (
              <div key={line.id} className="text-red-400">
                ✗ {line.text}
              </div>
            )
          }
          return (
            <div key={line.id} className="text-gray-600">
              {line.text}
            </div>
          )
        })}

        {isActive && (
          <div className="mt-1 flex items-center gap-1">
            <span
              className="inline-block h-4 w-2 animate-pulse rounded-sm bg-gray-400"
              aria-hidden
            />
          </div>
        )}
      </div>
    </div>
  )
}
