"use client"

import type React from "react"
import { useState } from "react"

function normalizeUrl(raw: string): string | null {
  let value = raw.trim()
  if (!value) return null
  if (!/^https?:\/\//i.test(value)) {
    // Treat a bare "example.com" as https, but a search phrase as a query.
    if (/^[\w-]+(\.[\w-]+)+/.test(value)) {
      value = "https://" + value
    } else {
      value = "https://duckduckgo.com/?q=" + encodeURIComponent(value)
    }
  }
  try {
    return new URL(value).href
  } catch {
    return null
  }
}

export function ProxyForm() {
  const [input, setInput] = useState("")
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const url = normalizeUrl(input)
    if (!url) {
      setError("Enter a valid URL or search term.")
      return
    }
    setError(null)
    window.location.href = `/api/proxy?url=${encodeURIComponent(url)}`
  }

  return (
    <form onSubmit={handleSubmit} className="flex w-full flex-col gap-3">
      <div className="flex w-full items-center gap-2 rounded-xl border border-border bg-card p-1.5 shadow-sm focus-within:ring-2 focus-within:ring-ring">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center text-muted-foreground">
          <svg
            aria-hidden="true"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="m21 21-4.34-4.34" />
            <circle cx="11" cy="11" r="8" />
          </svg>
        </div>
        <input
          type="text"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Enter a URL or search…"
          aria-label="URL to proxy"
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
        />
        <button
          type="submit"
          className="shrink-0 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
        >
          Browse
        </button>
      </div>
      {error ? (
        <p role="alert" className="text-center text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </form>
  )
}
