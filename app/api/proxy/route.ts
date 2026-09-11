import type { NextRequest } from "next/server"
import { rewriteHtml, rewriteCss, proxify } from "@/lib/rewrite"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

// Headers we must not forward upstream (hop-by-hop or environment specific).
const STRIP_REQUEST_HEADERS = new Set([
  "host",
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "content-length",
  "accept-encoding",
])

// Response headers that would block embedding or leak upstream transport details.
const STRIP_RESPONSE_HEADERS = new Set([
  "content-security-policy",
  "content-security-policy-report-only",
  "x-frame-options",
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
  "keep-alive",
  "strict-transport-security",
  "cross-origin-embedder-policy",
  "cross-origin-opener-policy",
  "cross-origin-resource-policy",
])

function bad(message: string, status = 400) {
  return new Response(message, { status, headers: { "content-type": "text/plain; charset=utf-8" } })
}

// Ad, analytics, and tracker hosts. These scripts assume a first-party origin
// with cross-frame access and throw internal errors when run through any proxy
// (e.g. adsbygoogle.js). They never function proxied, so we short-circuit them
// with a benign empty stub — this also removes their console noise and cuts
// unnecessary round-trips, improving page-load latency.
const BLOCKED_HOST_PATTERNS = [
  /(^|\.)googlesyndication\.com$/,
  /(^|\.)doubleclick\.net$/,
  /(^|\.)googletagmanager\.com$/,
  /(^|\.)googletagservices\.com$/,
  /(^|\.)google-analytics\.com$/,
  /(^|\.)adservice\.google\.[a-z.]+$/,
  /(^|\.)adnxs\.com$/,
  /(^|\.)amazon-adsystem\.com$/,
  /(^|\.)scorecardresearch\.com$/,
  /(^|\.)quantserve\.com$/,
]

function isBlockedHost(host: string) {
  return BLOCKED_HOST_PATTERNS.some((re) => re.test(host))
}

// A blocked resource resolves to an inert 204/empty asset instead of erroring.
function blockedResponse() {
  return new Response("", {
    status: 200,
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "access-control-allow-origin": "*",
      "cache-control": "public, max-age=86400",
    },
  })
}

async function handle(req: NextRequest) {
  const target = req.nextUrl.searchParams.get("url")
  if (!target) return bad("Missing ?url= parameter")

  let targetUrl: URL
  try {
    targetUrl = new URL(target)
  } catch {
    return bad("Invalid target URL")
  }
  if (targetUrl.protocol !== "http:" && targetUrl.protocol !== "https:") {
    return bad("Only http and https are supported")
  }

  // Short-circuit ad/tracker hosts with an inert stub so their scripts never
  // run (and never throw) inside the proxied page.
  if (isBlockedHost(targetUrl.host)) {
    return blockedResponse()
  }

  // Build upstream request headers.
  const headers = new Headers()
  req.headers.forEach((value, key) => {
    if (!STRIP_REQUEST_HEADERS.has(key.toLowerCase())) headers.set(key, value)
  })
  headers.set("host", targetUrl.host)
  if (!headers.has("user-agent")) {
    headers.set(
      "user-agent",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36",
    )
  }
  // Present ourselves to the origin as if we came from its own site.
  headers.set("referer", targetUrl.href)
  headers.set("origin", targetUrl.origin)

  const method = req.method.toUpperCase()
  const body = method === "GET" || method === "HEAD" ? undefined : await req.arrayBuffer()

  let upstream: Response
  try {
    upstream = await fetch(targetUrl.href, {
      method,
      headers,
      body,
      redirect: "manual",
      // @ts-expect-error node fetch duplex needed when a body is present
      duplex: body ? "half" : undefined,
    })
  } catch (err) {
    return bad(`Upstream fetch failed: ${(err as Error).message}`, 502)
  }

  // Handle redirects ourselves so the Location stays inside the proxy.
  if (upstream.status >= 300 && upstream.status < 400) {
    const location = upstream.headers.get("location")
    if (location) {
      const proxied = proxify(location, targetUrl.href)
      return new Response(null, {
        status: upstream.status,
        headers: { location: proxied },
      })
    }
  }

  const resHeaders = new Headers()
  upstream.headers.forEach((value, key) => {
    const lower = key.toLowerCase()
    if (STRIP_RESPONSE_HEADERS.has(lower)) return
    if (lower === "location") {
      resHeaders.set(key, proxify(value, targetUrl.href))
      return
    }
    if (lower === "set-cookie") {
      // Re-scope cookies to our own domain so they persist across proxied requests.
      resHeaders.append("set-cookie", value.replace(/;\s*domain=[^;]+/gi, "").replace(/;\s*secure/gi, ""))
      return
    }
    resHeaders.set(key, value)
  })
  resHeaders.set("access-control-allow-origin", "*")

  const contentType = (upstream.headers.get("content-type") || "").toLowerCase()

  // Rewrite text formats; stream everything else through untouched.
  if (contentType.includes("text/html")) {
    const html = await upstream.text()
    const rewritten = rewriteHtml(html, targetUrl.href)
    resHeaders.set("content-type", "text/html; charset=utf-8")
    return new Response(rewritten, { status: upstream.status, headers: resHeaders })
  }

  if (contentType.includes("css")) {
    const css = await upstream.text()
    const rewritten = rewriteCss(css, targetUrl.href)
    resHeaders.set("content-type", contentType || "text/css; charset=utf-8")
    return new Response(rewritten, { status: upstream.status, headers: resHeaders })
  }

  // Binary / other: pass the body straight through for lowest latency.
  return new Response(upstream.body, { status: upstream.status, headers: resHeaders })
}

export const GET = handle
export const POST = handle
export const PUT = handle
export const DELETE = handle
export const PATCH = handle
export const HEAD = handle
export const OPTIONS = handle
