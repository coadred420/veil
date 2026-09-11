// Injected into every proxied page. Rewrites runtime URL usage (fetch, XHR,
// history, dynamic elements) so requests keep flowing through the proxy.
(function () {
  var PATH = window.__PROXY_PATH__ || "/api/proxy"
  var TARGET = window.__PROXY_TARGET__ || location.href

  // Third-party scripts loaded through the proxy (ad/analytics/SDK code) often
  // throw internal exceptions because they expect first-party origin access
  // they don't get when proxied. Those errors are harmless to the page but
  // pollute the console. Swallow errors that originate from a proxied script
  // URL so they don't surface, while leaving genuine app errors intact.
  function fromProxiedScript(source) {
    return typeof source === "string" && source.indexOf(PATH + "?url=") !== -1
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
      var stack = e && e.reason && e.reason.stack
      if (fromProxiedScript(stack)) {
        e.preventDefault()
      }
    } catch (_) {}
  })

  function absolutize(url) {
    try {
      return new URL(url, TARGET).href
    } catch (e) {
      return null
    }
  }

  function isProxied(url) {
    return typeof url === "string" && url.indexOf(PATH + "?url=") !== -1
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
    return PATH + "?url=" + encodeURIComponent(abs)
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
    ["src", "href", "action"].forEach(function (attr) {
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
})()
