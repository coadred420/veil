// URL rewriting utilities shared by the proxy route.
// Every URL is routed back through /api/proxy. When an encryptor is present the
// absolute target is encrypted into an opaque token (?u=<token>); otherwise it
// falls back to a plaintext ?url=<encoded> form.

export const PROXY_PATH = "/api/proxy"

// Threaded through every rewrite call so the encryption mode is decided once.
export type RewriteContext = {
  base: string
  encrypt: ((absoluteUrl: string) => string) | null
}

const SKIP_PREFIXES = ["data:", "blob:", "javascript:", "mailto:", "tel:", "about:", "#", "vbscript:"]

export function shouldSkip(value: string): boolean {
  const v = value.trim().toLowerCase()
  if (!v) return true
  return SKIP_PREFIXES.some((p) => v.startsWith(p))
}

// Resolve a possibly-relative URL against the page base, then wrap it in the proxy path.
export function proxify(value: string, ctx: RewriteContext): string {
  if (shouldSkip(value)) return value
  try {
    const absolute = new URL(value, ctx.base).href
    if (ctx.encrypt) {
      return `${PROXY_PATH}?u=${ctx.encrypt(absolute)}`
    }
    return `${PROXY_PATH}?url=${encodeURIComponent(absolute)}`
  } catch {
    return value
  }
}

// Rewrite a srcset attribute (comma separated "url descriptor" pairs).
export function proxifySrcset(value: string, ctx: RewriteContext): string {
  return value
    .split(",")
    .map((part) => {
      const trimmed = part.trim()
      if (!trimmed) return ""
      const [url, ...descriptors] = trimmed.split(/\s+/)
      const rewritten = proxify(url, ctx)
      return [rewritten, ...descriptors].join(" ")
    })
    .filter(Boolean)
    .join(", ")
}

// Rewrite url(...) and @import references inside CSS text.
export function rewriteCss(css: string, ctx: RewriteContext): string {
  let out = css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (_m, quote, url) => {
    return `url(${quote}${proxify(url, ctx)}${quote})`
  })
  out = out.replace(/@import\s+(['"])([^'"]+)\1/gi, (_m, quote, url) => {
    return `@import ${quote}${proxify(url, ctx)}${quote}`
  })
  return out
}

const URL_ATTRS = ["href", "src", "poster", "data-src", "data-href", "formaction", "action", "background"]

// Rewrite an HTML document string. Regex-based for portability across runtimes.
export function rewriteHtml(html: string, ctx: RewriteContext): string {
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
      return `${pre}${quote}${proxify(value, ctx)}${quote}`
    })
  }

  // srcset needs special handling.
  out = out.replace(/(\ssrcset\s*=\s*)("([^"]*)"|'([^']*)')/gi, (_m, pre, _q, dq, sq) => {
    const value = dq ?? sq ?? ""
    const quote = dq !== undefined ? '"' : "'"
    return `${pre}${quote}${proxifySrcset(value, ctx)}${quote}`
  })

  // Inline style="" url() references.
  out = out.replace(/(\sstyle\s*=\s*)("([^"]*)"|'([^']*)')/gi, (_m, pre, _q, dq, sq) => {
    const value = dq ?? sq ?? ""
    const quote = dq !== undefined ? '"' : "'"
    return `${pre}${quote}${rewriteCss(value, ctx)}${quote}`
  })

  // <style>...</style> blocks.
  out = out.replace(/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi, (_m, open, body, close) => {
    return `${open}${rewriteCss(body, ctx)}${close}`
  })

  // meta refresh redirects: <meta http-equiv="refresh" content="3; url=...">
  out = out.replace(
    /(<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*content\s*=\s*)("[^"]*"|'[^']*')/gi,
    (_m, pre, content) => {
      const rewritten = content.replace(/url\s*=\s*([^"';]+)/i, (_mm: string, url: string) => {
        return `url=${proxify(url.trim(), ctx)}`
      })
      return `${pre}${rewritten}`
    },
  )

  // Inject our client patch + runtime markers right after <head>. The client
  // reads the session key from the cookie itself; we only pass non-secret
  // markers here (target, path, and whether encryption is active).
  const inject =
    `<script>window.__PROXY_TARGET__=${JSON.stringify(ctx.base)};` +
    `window.__PROXY_PATH__=${JSON.stringify(PROXY_PATH)};` +
    `window.__PROXY_ENC__=${ctx.encrypt ? "true" : "false"};</script>`
  if (/<head[^>]*>/i.test(out)) {
    out = out.replace(/(<head[^>]*>)/i, `$1${inject}<script src="/proxy-client.js"></script>`)
  } else {
    out = `${inject}<script src="/proxy-client.js"></script>${out}`
  }

  return out
}
