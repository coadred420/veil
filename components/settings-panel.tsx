"use client"

import { X, ShieldCheck, Lock, EyeOff, UserRound, Ban } from "lucide-react"
import { type VeilSettings, type ThemeId, THEMES, ACCENT_PRESETS } from "@/lib/settings"

type ToggleKey = "encryptUrls" | "blockTrackers" | "stripReferer" | "spoofUserAgent" | "doNotTrack"

const TOGGLES: { key: ToggleKey; label: string; help: string; Icon: typeof Lock }[] = [
  {
    key: "encryptUrls",
    label: "URL encryption",
    help: "Encrypt every target URL with your session key. Nothing readable appears in history, Referer headers, or server logs.",
    Icon: Lock,
  },
  {
    key: "blockTrackers",
    label: "Block ads & trackers",
    help: "Short-circuit known ad, analytics, and tracker hosts with an inert stub. Faster loads, no tracking beacons.",
    Icon: Ban,
  },
  {
    key: "stripReferer",
    label: "Strip Referer",
    help: "Never tell the destination which page you came from.",
    Icon: EyeOff,
  },
  {
    key: "spoofUserAgent",
    label: "Spoof user agent",
    help: "Present a generic desktop Chrome user agent to every site.",
    Icon: UserRound,
  },
  {
    key: "doNotTrack",
    label: "Do Not Track / GPC",
    help: "Send DNT and Global Privacy Control signals with every request.",
    Icon: ShieldCheck,
  },
]

function Switch({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={onClick}
      className="relative h-6 w-11 shrink-0 rounded-full border border-[var(--veil-border)] transition-colors"
      style={{ backgroundColor: on ? "var(--accent)" : "var(--veil-panel-2)" }}
    >
      <span
        className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all"
        style={{ left: on ? "calc(100% - 1.125rem)" : "0.125rem" }}
      />
    </button>
  )
}

export function SettingsPanel({
  open,
  settings,
  onClose,
  onChange,
}: {
  open: boolean
  settings: VeilSettings
  onClose: () => void
  onChange: (next: VeilSettings) => void
}) {
  return (
    <>
      <div
        aria-hidden={!open}
        onClick={onClose}
        className={`fixed inset-0 z-40 bg-black/60 transition-opacity ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      <aside
        role="dialog"
        aria-label="Proxy settings"
        aria-modal={open}
        className={`fixed right-0 top-0 z-50 flex h-full w-[360px] max-w-[90vw] flex-col border-l border-[var(--veil-border)] bg-[var(--veil-panel)] text-[var(--veil-fg)] shadow-2xl transition-transform duration-200 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <header className="flex items-center justify-between border-b border-[var(--veil-border)] px-5 py-4">
          <h2 className="text-sm font-semibold tracking-wide">Settings</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="rounded-md p-1 text-[var(--veil-muted)] hover:bg-[var(--veil-panel-2)] hover:text-[var(--veil-fg)]"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 space-y-6 overflow-y-auto px-5 py-5">
          <section>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--veil-muted)]">
              Privacy &amp; transport
            </h3>
            <div className="space-y-1">
              {TOGGLES.map(({ key, label, help, Icon }) => (
                <div
                  key={key}
                  className="flex items-start gap-3 rounded-lg px-2 py-3 hover:bg-[var(--veil-panel-2)]"
                >
                  <Icon className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "var(--accent)" }} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{label}</div>
                    <p className="mt-0.5 text-xs leading-relaxed text-[var(--veil-muted)]">{help}</p>
                  </div>
                  <Switch on={settings[key]} onClick={() => onChange({ ...settings, [key]: !settings[key] })} />
                </div>
              ))}
            </div>
          </section>

          <section>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--veil-muted)]">Theme</h3>
            <div className="grid grid-cols-5 gap-2">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => onChange({ ...settings, theme: t.id as ThemeId })}
                  className={`flex flex-col items-center gap-1.5 rounded-lg border p-2 transition-colors ${
                    settings.theme === t.id ? "border-[var(--accent)]" : "border-[var(--veil-border)]"
                  }`}
                  aria-pressed={settings.theme === t.id}
                >
                  <span className="h-7 w-7 rounded-full border border-[var(--veil-border)]" style={{ backgroundColor: t.swatch }} />
                  <span className="text-[10px] text-[var(--veil-muted)]">{t.label}</span>
                </button>
              ))}
            </div>
          </section>

          <section>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-[var(--veil-muted)]">Accent</h3>
            <div className="flex items-center gap-2">
              {ACCENT_PRESETS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => onChange({ ...settings, accent: c })}
                  aria-label={`Accent ${c}`}
                  aria-pressed={settings.accent === c}
                  className={`h-7 w-7 rounded-full border-2 transition-transform hover:scale-110 ${
                    settings.accent === c ? "border-white" : "border-transparent"
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
              <label className="ml-1 inline-flex h-7 w-7 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-[var(--veil-border)]">
                <input
                  type="color"
                  value={settings.accent}
                  onChange={(e) => onChange({ ...settings, accent: e.target.value })}
                  className="h-10 w-10 cursor-pointer border-0 bg-transparent p-0"
                  aria-label="Custom accent color"
                />
              </label>
            </div>
          </section>
        </div>

        <footer className="border-t border-[var(--veil-border)] px-5 py-3 text-[11px] leading-relaxed text-[var(--veil-muted)]">
          Traffic between you and the proxy is TLS-encrypted; URL encryption keeps targets unreadable to any middleman or
          log. The proxy itself must decrypt to fetch pages.
        </footer>
      </aside>
    </>
  )
}
