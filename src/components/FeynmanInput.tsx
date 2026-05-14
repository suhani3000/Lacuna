'use client'

import { useState, type FormEvent } from 'react'

export interface FeynmanInputProps {
  onSubmit: (data: { concept: string; explanation: string }) => void
  isDisabled: boolean
  compact?: boolean
}

export default function FeynmanInput({
  onSubmit,
  isDisabled,
  compact = false,
}: FeynmanInputProps) {
  const [concept, setConcept] = useState('')
  const [explanation, setExplanation] = useState('')

  const trimmedConcept = concept.trim()
  const trimmedExplanation = explanation.trim()
  const explanationLen = trimmedExplanation.length
  const meetsMinLength = explanationLen >= 50
  const submitDisabled =
    isDisabled || trimmedConcept.length === 0 || explanationLen < 50

  function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (submitDisabled) return
    onSubmit({
      concept: trimmedConcept,
      explanation: trimmedExplanation,
    })
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={
        compact
          ? 'rounded-xl border border-gray-800 bg-gray-900/90 p-4 shadow-sm'
          : 'rounded-xl border border-gray-800 bg-gray-900 p-6 shadow-sm'
      }
    >
      <div className={compact ? 'space-y-4' : 'space-y-6'}>
        <div className="space-y-2">
          <label htmlFor="feynman-concept" className="block text-sm font-medium text-gray-200">
            Concept or topic
          </label>
          <input
            id="feynman-concept"
            type="text"
            value={concept}
            onChange={(e) => setConcept(e.target.value)}
            disabled={isDisabled}
            placeholder="e.g. Load Balancers, TCP Handshake, Binary Search Trees"
            className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-gray-100 placeholder:text-gray-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="feynman-explanation" className="block text-sm font-medium text-gray-200">
            Explain it in plain English, no notes
          </label>
          <textarea
            id="feynman-explanation"
            value={explanation}
            onChange={(e) => setExplanation(e.target.value)}
            disabled={isDisabled}
            rows={compact ? 4 : 5}
            placeholder="Write what you understand without looking anything up. Include how it works, why it exists, and any edge cases you know..."
            className="w-full resize-y rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-gray-100 placeholder:text-gray-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-60"
          />
          <p
            className={`text-sm ${meetsMinLength ? 'text-green-500' : 'text-gray-500'}`}
            aria-live="polite"
          >
            {explanationLen} / 50 minimum
          </p>
        </div>

        <button
          type="submit"
          disabled={submitDisabled}
          className={
            compact
              ? 'w-full rounded-lg bg-indigo-600 px-3 py-2.5 text-center text-sm font-semibold text-white shadow transition hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2 focus:ring-offset-gray-900 disabled:cursor-not-allowed disabled:opacity-50'
              : 'w-full rounded-lg bg-indigo-600 px-4 py-3 text-center text-sm font-semibold text-white shadow transition hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-400 focus:ring-offset-2 focus:ring-offset-gray-900 disabled:cursor-not-allowed disabled:opacity-50'
          }
        >
          Run Feynman check →
        </button>
      </div>
    </form>
  )
}
