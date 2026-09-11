// Isomorphic ChaCha20 stream cipher (RFC 8439) used to encrypt target URLs so
// that nothing readable is exposed to any middleman, browser history, Referer
// header, or server access log. Only the client and the proxy hold the session
// key, so only they can recover the plaintext URL.
//
// ChaCha20 is chosen over AES-GCM because it is trivially portable and, most
// importantly, SYNCHRONOUS. The injected client patches URLs in places that
// cannot await a Promise (Element.setAttribute, MutationObserver callbacks),
// and WebCrypto only exposes async primitives. A single shared implementation
// here guarantees the server and every client encode/decode identically.

const CONSTANTS = [0x61707865, 0x3320646e, 0x79622d32, 0x6b206574]

function rotl(a: number, b: number): number {
  return ((a << b) | (a >>> (32 - b))) >>> 0
}

function readLE(u8: Uint8Array, o: number): number {
  return (u8[o] | (u8[o + 1] << 8) | (u8[o + 2] << 16) | (u8[o + 3] << 24)) >>> 0
}

function quarter(x: Uint32Array, a: number, b: number, c: number, d: number): void {
  x[a] = (x[a] + x[b]) >>> 0
  x[d] = rotl(x[d] ^ x[a], 16)
  x[c] = (x[c] + x[d]) >>> 0
  x[b] = rotl(x[b] ^ x[c], 12)
  x[a] = (x[a] + x[b]) >>> 0
  x[d] = rotl(x[d] ^ x[a], 8)
  x[c] = (x[c] + x[d]) >>> 0
  x[b] = rotl(x[b] ^ x[c], 7)
}

function block(key: Uint8Array, counter: number, nonce: Uint8Array): Uint8Array {
  const state = new Uint32Array(16)
  state[0] = CONSTANTS[0]
  state[1] = CONSTANTS[1]
  state[2] = CONSTANTS[2]
  state[3] = CONSTANTS[3]
  for (let i = 0; i < 8; i++) state[4 + i] = readLE(key, i * 4)
  state[12] = counter >>> 0
  state[13] = readLE(nonce, 0)
  state[14] = readLE(nonce, 4)
  state[15] = readLE(nonce, 8)

  const w = state.slice()
  for (let i = 0; i < 10; i++) {
    quarter(w, 0, 4, 8, 12)
    quarter(w, 1, 5, 9, 13)
    quarter(w, 2, 6, 10, 14)
    quarter(w, 3, 7, 11, 15)
    quarter(w, 0, 5, 10, 15)
    quarter(w, 1, 6, 11, 12)
    quarter(w, 2, 7, 8, 13)
    quarter(w, 3, 4, 9, 14)
  }

  const out = new Uint8Array(64)
  for (let i = 0; i < 16; i++) {
    const v = (w[i] + state[i]) >>> 0
    out[i * 4] = v & 0xff
    out[i * 4 + 1] = (v >>> 8) & 0xff
    out[i * 4 + 2] = (v >>> 16) & 0xff
    out[i * 4 + 3] = (v >>> 24) & 0xff
  }
  return out
}

function chacha20(key: Uint8Array, nonce: Uint8Array, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length)
  let counter = 1
  for (let off = 0; off < data.length; off += 64) {
    const ks = block(key, counter, nonce)
    const n = Math.min(64, data.length - off)
    for (let i = 0; i < n; i++) out[off + i] = data[off + i] ^ ks[i]
    counter = (counter + 1) >>> 0
  }
  return out
}

function b64urlEncode(u8: Uint8Array): string {
  let s = ""
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i])
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function b64urlDecode(str: string): Uint8Array {
  const norm = str.replace(/-/g, "+").replace(/_/g, "/")
  const bin = atob(norm)
  const u8 = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
  return u8
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

// Coerce an arbitrary base64url key string into exactly 32 bytes.
export function keyToBytes(keyB64: string): Uint8Array {
  const raw = b64urlDecode(keyB64)
  const key = new Uint8Array(32)
  key.set(raw.subarray(0, 32))
  return key
}

// Generate a fresh 256-bit session key as a base64url string.
export function generateKey(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return b64urlEncode(bytes)
}

// Encrypt a URL. Output layout: base64url( nonce(12) || ciphertext ).
export function encryptUrl(plain: string, key: Uint8Array): string {
  const nonce = new Uint8Array(12)
  crypto.getRandomValues(nonce)
  const ct = chacha20(key, nonce, encoder.encode(plain))
  const packed = new Uint8Array(nonce.length + ct.length)
  packed.set(nonce, 0)
  packed.set(ct, nonce.length)
  return b64urlEncode(packed)
}

// Decrypt a token produced by encryptUrl. Returns null on malformed input.
export function decryptUrl(token: string, key: Uint8Array): string | null {
  try {
    const packed = b64urlDecode(token)
    if (packed.length < 13) return null
    const nonce = packed.subarray(0, 12)
    const ct = packed.subarray(12)
    return decoder.decode(chacha20(key, nonce, ct))
  } catch {
    return null
  }
}
