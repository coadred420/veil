// URL rewriting utilities shared by the proxy route.
// Everything is routed back through /api/proxy?url=<absolute encoded url>.

export const PROXY_PATH = "/api/proxy"

const SKIP_PREFIXES = ["data:", "blob:", "javascript:", "mailto:", "tel:", "about:", "#", "vbscript:"]

export function shouldSkip(value: string): boolean {
  const v = value.trim().toLowerCase()
  if (!v) return true
  return SKIP_PREFIXES.some((p) => v.startsWith(p))
}

// Resolve a possibly-relative URL against the page base, then wrap it in the proxy path.
export function proxify(value: string, base: string): string {
  if (shouldSkip(value)) return value
  try {
    const absolute = new URL(value, base).href
    return `${PROXY_PATH}?url=${encodeURIComponent(absolute)}`
  } catch {
    return value
  }
}

// Rewrite a srcset attribute (comma separated "url descriptor" pairs).
export function proxifySrcset(value: string, base: string): string {
  return value
    .split(",")
    .map((part) => {
      const trimmed = part.trim()
      if (!trimmed) return ""
      const [url, ...descriptors] = trimmed.split(/\s+/)
      const rewritten = proxify(url, base)
      return [rewritten, ...descriptors].join(" ")
    })
    .filter(Boolean)
    .join(", ")
}

// Rewrite url(...) and @import references inside CSS text.
export function rewriteCss(css: string, base: string): string {
  let out = css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (_m, quote, url) => {
    return `url(${quote}${proxify(url, base)}${quote})`
  })
  out = out.replace(/@import\s+(['"])([^'"]+)\1/gi, (_m, quote, url) => {
    return `@import ${quote}${proxify(url, base)}${quote}`
  })
  return out
}

const URL_ATTRS = ["href", "src", "poster", "data-src", "data-href", "formaction", "action", "background"]

// Rewrite an HTML document string. Regex-based for portability across runtimes.
export function rewriteHtml(html: string, base: string): string {
  let out = html

  // Remove <base> tags so our own base resolution wins.
  out = out.replace(/<base\b[^>]*>/gi, "")

  // Strip SRI/crossorigin because rewritten bytes won't match original hashes.
  out = out.replace(/\sintegrity\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
  out = out.replace(/\scrossorigin\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")

  // Rewrite standard URL-bearing attributes.
  for (const attr of URL_ATTRS) {
    const re = new RegExp(`(\\s${attr}\\s*=\\s*)("([^"]*)"|'([^']*)')`, "gi")
    out = out.replace(re, (_m, pre, _q, dq, sq) => {
      const value = dq ?? sq ?? ""
      const quote = dq !== undefined ? '"' : "'"
      return `${pre}${quote}${proxify(value, base)}${quote}`
    })
  }

  // srcset needs special handling.
  out = out.replace(/(\ssrcset\s*=\s*)("([^"]*)"|'([^']*)')/gi, (_m, pre, _q, dq, sq) => {
    const value = dq ?? sq ?? ""
    const quote = dq !== undefined ? '"' : "'"
    return `${pre}${quote}${proxifySrcset(value, base)}${quote}`
  })

  // Inline style="" url() references.
  out = out.replace(/(\sstyle\s*=\s*)("([^"]*)"|'([^']*)')/gi, (_m, pre, _q, dq, sq) => {
    const value = dq ?? sq ?? ""
    const quote = dq !== undefined ? '"' : "'"
    return `${pre}${quote}${rewriteCss(value, base)}${quote}`
  })

  // <style>...</style> blocks.
  out = out.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (_m, open, body, close) => {
    return `${open}${rewriteCss(body, base)}${close}`
  })

  // meta refresh redirects: <meta http-equiv="refresh" content="3; url=...">
  out = out.replace(
    /(<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*content\s*=\s*)("[^"]*"|'[^']*')/gi,
    (_m, pre, content) => {
      const rewritten = content.replace(/url\s*=\s*([^"';]+)/i, (_mm: string, url: string) => {
        return `url=${proxify(url.trim(), base)}`
      })
      return `${pre}${rewritten}`
    },
  )

  // Inject our client patch + base marker right after <head>.
  const inject = `<script>window.__PROXY_TARGET__=${JSON.stringify(base)};window.__PROXY_PATH__=${JSON.stringify(PROXY_PATH)};</script>`
  if (/<head[^>]*>/i.test(out)) {
    out = out.replace(/(<head[^>]*>)/i, `$1${inject}<script src="/proxy-client.js"></script>`)
  } else {
    out = `${inject}<script src="/proxy-client.js"></script>${out}`
  }

  return out
}
