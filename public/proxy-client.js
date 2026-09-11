// Injected into every proxied page. Rewrites runtime URL usage (fetch, XHR,
// history, dynamic elements) so requests keep flowing through the proxy, and
// encrypts each target URL with the session key when encryption is active.
(function () {
  var PATH = window.__PROXY_PATH__ || "/api/proxy"
  var TARGET = window.__PROXY_TARGET__ || location.href
  var ENC = window.__PROXY_ENC__ === true

  // ---------------------------------------------------------------------------
  // ChaCha20 (RFC 8439) — standalone copy of lib/crypto.ts so encryption is
  // byte-for-byte identical to the server. Synchronous by necessity: the DOM
  // hooks below (setAttribute, MutationObserver) cannot await a Promise.
  // ---------------------------------------------------------------------------
  function rotl(a, b) {
    return ((a << b) | (a >>> (32 - b))) >>> 0
  }
  function readLE(u8, o) {
    return (u8[o] | (u8[o + 1] << 8) | (u8[o + 2] << 16) | (u8[o + 3] << 24)) >>> 0
  }
  function quarter(x, a, b, c, d) {
    x[a] = (x[a] + x[b]) >>> 0
    x[d] = rotl(x[d] ^ x[a], 16)
    x[c] = (x[c] + x[d]) >>> 0
    x[b] = rotl(x[b] ^ x[c], 12)
    x[a] = (x[a] + x[b]) >>> 0
    x[d] = rotl(x[d] ^ x[a], 8)
    x[c] = (x[c] + x[d]) >>> 0
    x[b] = rotl(x[b] ^ x[c], 7)
  }
  function chachaBlock(key, counter, nonce) {
    var s = new Uint32Array(16)
    s[0] = 0x61707865
    s[1] = 0x3320646e
    s[2] = 0x79622d32
    s[3] = 0x6b206574
    for (var i = 0; i < 8; i++) s[4 + i] = readLE(key, i * 4)
    s[12] = counter >>> 0
    s[13] = readLE(nonce, 0)
    s[14] = readLE(nonce, 4)
    s[15] = readLE(nonce, 8)
    var w = s.slice()
    for (var r = 0; r < 10; r++) {
      quarter(w, 0, 4, 8, 12)
      quarter(w, 1, 5, 9, 13)
      quarter(w, 2, 6, 10, 14)
      quarter(w, 3, 7, 11, 15)
      quarter(w, 0, 5, 10, 15)
      quarter(w, 1, 6, 11, 12)
      quarter(w, 2, 7, 8, 13)
      quarter(w, 3, 4, 9, 14)
    }
    var out = new Uint8Array(64)
    for (var j = 0; j < 16; j++) {
      var v = (w[j] + s[j]) >>> 0
      out[j * 4] = v & 0xff
      out[j * 4 + 1] = (v >>> 8) & 0xff
      out[j * 4 + 2] = (v >>> 16) & 0xff
      out[j * 4 + 3] = (v >>> 24) & 0xff
    }
    return out
  }
  function chacha20(key, nonce, data) {
    var out = new Uint8Array(data.length)
    var counter = 1
    for (var off = 0; off < data.length; off += 64) {
      var ks = chachaBlock(key, counter, nonce)
      var n = Math.min(64, data.length - off)
      for (var i = 0; i < n; i++) out[off + i] = data[off + i] ^ ks[i]
      counter = (counter + 1) >>> 0
    }
    return out
  }
  function b64urlEncode(u8) {
    var s = ""
    for (var i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i])
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
  }
  function b64urlDecode(str) {
    var norm = str.replace(/-/g, "+").replace(/_/g, "/")
    var bin = atob(norm)
    var u8 = new Uint8Array(bin.length)
    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
    return u8
  }
  var encoder = new TextEncoder()

  function readCookie(name) {
    var m = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"))
    return m ? decodeURIComponent(m[1]) : null
  }

  // Load the 32-byte session key from the cookie once.
  var KEY = null
  ;(function () {
    var k = readCookie("vk")
    if (k) {
      var raw = b64urlDecode(k)
      KEY = new Uint8Array(32)
      KEY.set(raw.subarray(0, 32))
    }
  })()

  function encryptUrl(plain) {
    var nonce = new Uint8Array(12)
    crypto.getRandomValues(nonce)
    var ct = chacha20(KEY, nonce, encoder.encode(plain))
    var packed = new Uint8Array(12 + ct.length)
    packed.set(nonce, 0)
    packed.set(ct, 12)
    return b64urlEncode(packed)
  }

  // ---------------------------------------------------------------------------
  // Error suppression for proxied third-party scripts (ad/analytics SDKs throw
  // internal exceptions when they can't reach a first-party origin). Genuine
  // app errors are left intact.
  // ---------------------------------------------------------------------------
  function fromProxiedScript(source) {
    return typeof source === "string" && (source.indexOf(PATH + "?url=") !== -1 || source.indexOf(PATH + "?u=") !== -1)
  }
  window.addEventListener(
    "error",
    function (e) {
      if (e && (fromProxiedScript(e.filename) || (e.target && fromProxiedScript(e.target.src)))) {
        e.stopImmediatePropagation()
        e.preventDefault()
        return true
      }
    },
    true,
  )
  window.addEventListener("unhandledrejection", function (e) {
    try {
      if (fromProxiedScript(e && e.reason && e.reason.stack)) e.preventDefault()
    } catch (_) {}
  })

  // ---------------------------------------------------------------------------
  // URL rewriting
  // ---------------------------------------------------------------------------
  function absolutize(url) {
    try {
      return new URL(url, TARGET).href
    } catch (e) {
      return null
    }
  }
  function isProxied(url) {
    return typeof url === "string" && (url.indexOf(PATH + "?url=") !== -1 || url.indexOf(PATH + "?u=") !== -1)
  }
  function wrap(abs) {
    if (ENC && KEY) return PATH + "?u=" + encryptUrl(abs)
    return PATH + "?url=" + encodeURIComponent(abs)
  }
  function proxify(url) {
    if (url == null) return url
    var s = String(url)
    var lower = s.trim().toLowerCase()
    if (
      !s ||
      isProxied(s) ||
      lower.indexOf("data:") === 0 ||
      lower.indexOf("blob:") === 0 ||
      lower.indexOf("javascript:") === 0 ||
      lower.indexOf("mailto:") === 0 ||
      lower.indexOf("tel:") === 0 ||
      lower.indexOf("#") === 0 ||
      lower.indexOf("about:") === 0
    ) {
      return s
    }
    var abs = absolutize(s)
    if (!abs) return s
    return wrap(abs)
  }

  // ---- fetch ----
  var origFetch = window.fetch
  if (origFetch) {
    window.fetch = function (input, init) {
      try {
        if (typeof input === "string") {
          input = proxify(input)
        } else if (input && input.url) {
          input = new Request(proxify(input.url), input)
        }
      } catch (e) {}
      return origFetch.call(this, input, init)
    }
  }

  // ---- XMLHttpRequest ----
  var origOpen = XMLHttpRequest.prototype.open
  XMLHttpRequest.prototype.open = function (method, url) {
    try {
      arguments[1] = proxify(url)
    } catch (e) {}
    return origOpen.apply(this, arguments)
  }

  // ---- history API (SPA navigation) ----
  function patchHistory(name) {
    var orig = history[name]
    history[name] = function (state, title, url) {
      if (url) {
        try {
          arguments[2] = proxify(url)
        } catch (e) {}
      }
      return orig.apply(this, arguments)
    }
  }
  try {
    patchHistory("pushState")
    patchHistory("replaceState")
  } catch (e) {}

  // ---- sendBeacon ----
  if (navigator.sendBeacon) {
    var origBeacon = navigator.sendBeacon.bind(navigator)
    navigator.sendBeacon = function (url, data) {
      return origBeacon(proxify(url), data)
    }
  }

  // ---- setAttribute for src/href on dynamically created elements ----
  var origSetAttr = Element.prototype.setAttribute
  Element.prototype.setAttribute = function (name, value) {
    if (name === "src" || name === "href" || name === "action") {
      try {
        value = proxify(value)
      } catch (e) {}
    }
    return origSetAttr.call(this, name, value)
  }

  // ---- rewrite nodes added after load (images, scripts, iframes) ----
  function fixNode(node) {
    if (node.nodeType !== 1) return
    ;["src", "href", "action"].forEach(function (attr) {
      var v = node.getAttribute && node.getAttribute(attr)
      if (v && !isProxied(v)) {
        var p = proxify(v)
        if (p !== v) origSetAttr.call(node, attr, p)
      }
    })
  }
  try {
    var mo = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var added = mutations[i].addedNodes
        for (var j = 0; j < added.length; j++) {
          fixNode(added[j])
          if (added[j].querySelectorAll) {
            var kids = added[j].querySelectorAll("[src],[href],[action]")
            for (var k = 0; k < kids.length; k++) fixNode(kids[k])
          }
        }
      }
    })
    mo.observe(document.documentElement, { childList: true, subtree: true })
  } catch (e) {}

  // ---------------------------------------------------------------------------
  // Report navigation to the parent shell so the address bar, tab title, and
  // history stay in sync with the real (decrypted) URL the user is viewing.
  // ---------------------------------------------------------------------------
  function report() {
    try {
      parent.postMessage({ source: "veil", type: "navigated", url: TARGET, title: document.title || TARGET }, "*")
    } catch (e) {}
  }
  report()
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", report)
  }
  window.addEventListener("load", report)
})()
