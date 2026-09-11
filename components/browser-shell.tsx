"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ArrowLeft, ArrowRight, RotateCw, Plus, X, Settings, Lock, LockOpen, Globe, Search } from "lucide-react"
import {
  type VeilSettings,
  DEFAULT_SETTINGS,
  SETTINGS_STORAGE,
  KEY_STORAGE,
  encodeSettingsCookie,
} from "@/lib/settings"
import { generateKey, keyToBytes, encryptUrl } from "@/lib/crypto"
import { SettingsPanel } from "@/components/settings-panel"

type Tab = {
  id: string
  entries: string[] // real (decrypted) URLs, oldest -> newest
  idx: number // pointer into entries
  title: string
  input: string // current address-bar text
  reload: number // bump to force iframe reload
}

const QUICK_LINKS = [
  { label: "Wikipedia", url: "https://en.wikipedia.org" },
  { label: "DuckDuckGo", url: "https://duckduckgo.com" },
  { label: "Hacker News", url: "https://news.ycombinator.com" },
  { label: "MDN", url: "https://developer.mozilla.org" },
  { label: "Example", url: "https://example.com" },
]

let counter = 0
const uid = () => `tab-${Date.now()}-${counter++}`

function newTab(url = ""): Tab {
  return { id: uid(), entries: url ? [url] : [], idx: url ? 0 : -1, title: url || "New Tab", input: url, reload: 0 }
}

function normalizeInput(raw: string): string | null {
  const s = raw.trim()
  if (!s) return null
  if (/^https?:\/\//i.test(s)) return s
  const looksLikeDomain = /^[^\s/]+\.[^\s/]{2,}(\/.*)?$/.test(s)
  if (looksLikeDomain) return `https://${s}`
  return `https://duckduckgo.com/?q=${encodeURIComponent(s)}`
}

export function BrowserShell() {
  const [settings, setSettings] = useState<VeilSettings>(DEFAULT_SETTINGS)
  const [keyB64, setKeyB64] = useState<string | null>(null)
  const [tabs, setTabs] = useState<Tab[]>([newTab()])
  const [activeId, setActiveId] = useState<string>(tabs[0].id)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [hydrated, setHydrated] = useState(false)

  const iframeRefs = useRef<Record<string, HTMLIFrameElement | null>>({})
  const selfLoad = useRef<Record<string, boolean>>({})
  const tabsRef = useRef(tabs)
  tabsRef.current = tabs

  // ---- init: load settings + session key from storage, write cookies ----
  useEffect(() => {
    let loaded = DEFAULT_SETTINGS
    try {
      const raw = localStorage.getItem(SETTINGS_STORAGE)
      if (raw) loaded = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
    } catch {}
    let key = null as string | null
    try {
      key = localStorage.getItem(KEY_STORAGE)
    } catch {}
    if (!key) {
      key = generateKey()
      try {
        localStorage.setItem(KEY_STORAGE, key)
      } catch {}
    }
    setSettings(loaded)
    setKeyB64(key)
    setHydrated(true)
  }, [])

  // ---- persist settings + mirror to cookies the server route reads ----
  useEffect(() => {
    if (!hydrated || !keyB64) return
    try {
      localStorage.setItem(SETTINGS_STORAGE, JSON.stringify(settings))
    } catch {}
    const oneYear = 60 * 60 * 24 * 365
    document.cookie = `vk=${keyB64}; path=/; SameSite=Lax; max-age=${oneYear}`
    document.cookie = `veil-settings=${encodeSettingsCookie(settings)}; path=/; SameSite=Lax; max-age=${oneYear}`
  }, [settings, keyB64, hydrated])

  const keyBytes = useMemo(() => (keyB64 ? keyToBytes(keyB64) : null), [keyB64])

  const buildSrc = useCallback(
    (realUrl: string) => {
      if (settings.encryptUrls && keyBytes) return `/api/proxy?u=${encryptUrl(realUrl, keyBytes)}`
      return `/api/proxy?url=${encodeURIComponent(realUrl)}`
    },
    [settings.encryptUrls, keyBytes],
  )

  const activeTab = tabs.find((t) => t.id === activeId) ?? tabs[0]

  const updateTab = useCallback((id: string, patch: Partial<Tab> | ((t: Tab) => Partial<Tab>)) => {
    setTabs((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...(typeof patch === "function" ? patch(t) : patch) } : t)),
    )
  }, [])

  // Navigate the active tab to a new URL (pushes a history entry).
  const navigate = useCallback(
    (id: string, rawUrl: string) => {
      const url = normalizeInput(rawUrl)
      if (!url) return
      selfLoad.current[id] = true
      updateTab(id, (t) => {
        const entries = t.entries.slice(0, t.idx + 1)
        entries.push(url)
        return { entries, idx: entries.length - 1, input: url, title: url, reload: t.reload + 1 }
      })
    },
    [updateTab],
  )

  const goBack = useCallback(
    (id: string) => {
      selfLoad.current[id] = true
      updateTab(id, (t) => (t.idx > 0 ? { idx: t.idx - 1, input: t.entries[t.idx - 1], reload: t.reload + 1 } : {}))
    },
    [updateTab],
  )
  const goForward = useCallback(
    (id: string) => {
      selfLoad.current[id] = true
      updateTab(id, (t) =>
        t.idx < t.entries.length - 1 ? { idx: t.idx + 1, input: t.entries[t.idx + 1], reload: t.reload + 1 } : {},
      )
    },
    [updateTab],
  )
  const reload = useCallback(
    (id: string) => {
      selfLoad.current[id] = true
      updateTab(id, (t) => ({ reload: t.reload + 1 }))
    },
    [updateTab],
  )

  // ---- listen for navigation reports from proxied pages ----
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      const data = e.data
      if (!data || data.source !== "veil" || data.type !== "navigated") return
      // Identify which tab's iframe sent this.
      const entry = Object.entries(iframeRefs.current).find(([, el]) => el && el.contentWindow === e.source)
      if (!entry) return
      const id = entry[0]
      const reportedUrl: string = data.url
      const title: string = data.title || reportedUrl
      const tab = tabsRef.current.find((t) => t.id === id)
      if (!tab) return

      if (selfLoad.current[id]) {
        // Our own programmatic load finished. Sync title; if a redirect changed
        // the final URL, replace the current entry rather than pushing.
        selfLoad.current[id] = false
        updateTab(id, (t) => {
          const entries = t.entries.slice()
          if (entries[t.idx] !== reportedUrl && t.idx >= 0) entries[t.idx] = reportedUrl
          return { entries, title, input: reportedUrl }
        })
      } else {
        // An in-page link/redirect navigated the iframe: record new history.
        updateTab(id, (t) => {
          if (t.entries[t.idx] === reportedUrl) return { title }
          const entries = t.entries.slice(0, t.idx + 1)
          entries.push(reportedUrl)
          return { entries, idx: entries.length - 1, title, input: reportedUrl }
        })
      }
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [updateTab])

  const addTab = useCallback(() => {
    const t = newTab()
    setTabs((prev) => [...prev, t])
    setActiveId(t.id)
  }, [])

  const closeTab = useCallback(
    (id: string) => {
      setTabs((prev) => {
        if (prev.length === 1) {
          const fresh = newTab()
          setActiveId(fresh.id)
          return [fresh]
        }
        const idx = prev.findIndex((t) => t.id === id)
        const next = prev.filter((t) => t.id !== id)
        if (id === activeId) {
          const neighbor = next[Math.max(0, idx - 1)]
          setActiveId(neighbor.id)
        }
        delete iframeRefs.current[id]
        return next
      })
    },
    [activeId],
  )

  const canBack = activeTab.idx > 0
  const canForward = activeTab.idx < activeTab.entries.length - 1
  const encrypting = settings.encryptUrls

  return (
    <div
      className={`veil-root theme-${settings.theme} flex h-dvh w-full flex-col overflow-hidden bg-[var(--veil-bg)] text-[var(--veil-fg)]`}
      style={{ ["--accent" as string]: settings.accent }}
    >
      {/* Tab strip */}
      <div className="flex items-center gap-1 bg-[var(--veil-bg)] px-2 pt-2">
        <div className="flex items-center gap-1.5 pr-2">
          <span className="grid h-6 w-6 place-items-center rounded-md" style={{ backgroundColor: "var(--accent)" }}>
            <Globe className="h-3.5 w-3.5 text-black" />
          </span>
          <span className="text-sm font-semibold tracking-wide">Veil</span>
        </div>
        <div className="flex min-w-0 flex-1 items-end gap-1 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setActiveId(t.id)}
              className={`group flex h-9 min-w-0 max-w-[200px] items-center gap-2 rounded-t-lg px-3 text-sm transition-colors ${
                t.id === activeId
                  ? "bg-[var(--veil-panel)] text-[var(--veil-fg)]"
                  : "bg-[var(--veil-panel-2)]/40 text-[var(--veil-muted)] hover:bg-[var(--veil-panel-2)]"
              }`}
            >
              <Globe className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{t.title || "New Tab"}</span>
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation()
                  closeTab(t.id)
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.stopPropagation()
                    closeTab(t.id)
                  }
                }}
                aria-label="Close tab"
                className="grid h-4 w-4 shrink-0 place-items-center rounded opacity-0 hover:bg-[var(--veil-border)] group-hover:opacity-100"
              >
                <X className="h-3 w-3" />
              </span>
            </button>
          ))}
          <button
            onClick={addTab}
            aria-label="New tab"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-[var(--veil-muted)] hover:bg-[var(--veil-panel-2)] hover:text-[var(--veil-fg)]"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex items-center gap-2 bg-[var(--veil-panel)] px-3 py-2">
        <div className="flex items-center gap-1">
          <IconButton disabled={!canBack} onClick={() => goBack(activeId)} label="Back">
            <ArrowLeft className="h-4 w-4" />
          </IconButton>
          <IconButton disabled={!canForward} onClick={() => goForward(activeId)} label="Forward">
            <ArrowRight className="h-4 w-4" />
          </IconButton>
          <IconButton disabled={activeTab.idx < 0} onClick={() => reload(activeId)} label="Reload">
            <RotateCw className="h-4 w-4" />
          </IconButton>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            navigate(activeId, activeTab.input)
          }}
          className="flex flex-1 items-center gap-2 rounded-full border border-[var(--veil-border)] bg-[var(--veil-bg)] px-3 py-1.5"
        >
          <span title={encrypting ? "URL encryption on" : "URL encryption off"}>
            {encrypting ? (
              <Lock className="h-4 w-4" style={{ color: "var(--accent)" }} />
            ) : (
              <LockOpen className="h-4 w-4 text-[var(--veil-muted)]" />
            )}
          </span>
          <input
            value={activeTab.input}
            onChange={(e) => updateTab(activeId, { input: e.target.value })}
            onFocus={(e) => e.currentTarget.select()}
            placeholder="Search or enter a URL"
            spellCheck={false}
            autoComplete="off"
            className="min-w-0 flex-1 bg-transparent text-sm text-[var(--veil-fg)] placeholder:text-[var(--veil-muted)] focus:outline-none"
          />
        </form>

        <IconButton onClick={() => setSettingsOpen(true)} label="Settings">
          <Settings className="h-4 w-4" />
        </IconButton>
      </div>

      {/* Viewport */}
      <div className="relative flex-1 bg-[var(--veil-bg)]">
        {tabs.map((t) => {
          const url = t.idx >= 0 ? t.entries[t.idx] : null
          const isActive = t.id === activeId
          if (!url) {
            return isActive ? <StartScreen key={t.id} onGo={(u) => navigate(t.id, u)} /> : null
          }
          return (
            <iframe
              key={`${t.id}-${t.reload}`}
              ref={(el) => {
                iframeRefs.current[t.id] = el
              }}
              src={buildSrc(url)}
              title={t.title}
              className="absolute inset-0 h-full w-full border-0 bg-white"
              style={{ display: isActive ? "block" : "none" }}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals"
            />
          )
        })}
      </div>

      <SettingsPanel
        open={settingsOpen}
        settings={settings}
        onClose={() => setSettingsOpen(false)}
        onChange={setSettings}
      />
    </div>
  )
}

function IconButton({
  children,
  onClick,
  disabled,
  label,
}: {
  children: React.ReactNode
  onClick?: () => void
  disabled?: boolean
  label: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="grid h-8 w-8 place-items-center rounded-md text-[var(--veil-fg)] transition-colors hover:bg-[var(--veil-panel-2)] disabled:cursor-not-allowed disabled:opacity-30"
    >
      {children}
    </button>
  )
}

function StartScreen({ onGo }: { onGo: (url: string) => void }) {
  const [value, setValue] = useState("")
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-8 bg-[var(--veil-bg)] px-6">
      <div className="flex flex-col items-center gap-3">
        <span className="grid h-14 w-14 place-items-center rounded-2xl" style={{ backgroundColor: "var(--accent)" }}>
          <Globe className="h-7 w-7 text-black" />
        </span>
        <h1 className="text-2xl font-semibold tracking-tight">Veil</h1>
        <p className="max-w-md text-center text-sm text-[var(--veil-muted)]">
          Private browsing proxy. Targets are encrypted end-to-end between you and the proxy — unreadable to any
          middleman or log.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          onGo(value)
        }}
        className="flex w-full max-w-xl items-center gap-2 rounded-full border border-[var(--veil-border)] bg-[var(--veil-panel)] px-4 py-3"
      >
        <Search className="h-4 w-4 text-[var(--veil-muted)]" />
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Search or enter a URL"
          spellCheck={false}
          autoComplete="off"
          className="min-w-0 flex-1 bg-transparent text-sm text-[var(--veil-fg)] placeholder:text-[var(--veil-muted)] focus:outline-none"
        />
        <button
          type="submit"
          className="rounded-full px-4 py-1.5 text-sm font-medium text-black"
          style={{ backgroundColor: "var(--accent)" }}
        >
          Go
        </button>
      </form>

      <div className="flex flex-wrap items-center justify-center gap-2">
        {QUICK_LINKS.map((l) => (
          <button
            key={l.url}
            onClick={() => onGo(l.url)}
            className="rounded-full border border-[var(--veil-border)] bg-[var(--veil-panel)] px-4 py-2 text-sm text-[var(--veil-muted)] transition-colors hover:border-[var(--accent)] hover:text-[var(--veil-fg)]"
          >
            {l.label}
          </button>
        ))}
      </div>
    </div>
  )
}
