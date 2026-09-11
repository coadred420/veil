// Shared settings model for the proxy. The client persists these to
// localStorage for its own UI and mirrors the privacy-relevant fields into a
// cookie so the server route can honor them on every upstream request.

export type ThemeId = "midnight" | "aurora" | "matrix" | "sunset" | "mono"

export type VeilSettings = {
  // Privacy / transport (read by the server route via cookie)
  encryptUrls: boolean
  blockTrackers: boolean
  stripReferer: boolean
  spoofUserAgent: boolean
  doNotTrack: boolean
  // Appearance (client only)
  theme: ThemeId
  accent: string
}

export const DEFAULT_SETTINGS: VeilSettings = {
  encryptUrls: true,
  blockTrackers: true,
  stripReferer: false,
  spoofUserAgent: true,
  doNotTrack: true,
  theme: "midnight",
  accent: "#34d399",
}

export const KEY_COOKIE = "vk"
export const SETTINGS_COOKIE = "veil-settings"
export const SETTINGS_STORAGE = "veil:settings"
export const KEY_STORAGE = "veil:key"

export const THEMES: { id: ThemeId; label: string; swatch: string }[] = [
  { id: "midnight", label: "Midnight", swatch: "#0b1220" },
  { id: "aurora", label: "Aurora", swatch: "#0e2a2a" },
  { id: "matrix", label: "Matrix", swatch: "#04140a" },
  { id: "sunset", label: "Sunset", swatch: "#2a1526" },
  { id: "mono", label: "Mono", swatch: "#131313" },
]

export const ACCENT_PRESETS = ["#34d399", "#60a5fa", "#f472b6", "#f59e0b", "#a78bfa", "#f87171"]

// Only the fields the server needs, encoded compactly into a cookie value.
export function encodeSettingsCookie(s: VeilSettings): string {
  const payload = {
    e: s.encryptUrls ? 1 : 0,
    b: s.blockTrackers ? 1 : 0,
    r: s.stripReferer ? 1 : 0,
    u: s.spoofUserAgent ? 1 : 0,
    d: s.doNotTrack ? 1 : 0,
  }
  return encodeURIComponent(JSON.stringify(payload))
}

export type ServerSettings = {
  blockTrackers: boolean
  stripReferer: boolean
  spoofUserAgent: boolean
  doNotTrack: boolean
}

export function decodeSettingsCookie(value: string | undefined): ServerSettings {
  const fallback: ServerSettings = {
    blockTrackers: DEFAULT_SETTINGS.blockTrackers,
    stripReferer: DEFAULT_SETTINGS.stripReferer,
    spoofUserAgent: DEFAULT_SETTINGS.spoofUserAgent,
    doNotTrack: DEFAULT_SETTINGS.doNotTrack,
  }
  if (!value) return fallback
  try {
    const p = JSON.parse(decodeURIComponent(value))
    return {
      blockTrackers: p.b !== 0,
      stripReferer: p.r === 1,
      spoofUserAgent: p.u !== 0,
      doNotTrack: p.d !== 0,
    }
  } catch {
    return fallback
  }
}
