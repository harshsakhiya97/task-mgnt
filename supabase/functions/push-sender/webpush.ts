// Web Push without libraries (WebCrypto only): VAPID (RFC 8292) + aes128gcm payload encryption (RFC 8291 / 8188).

const enc = new TextEncoder()
type Bytes = Uint8Array<ArrayBuffer>
export const b64u = (b: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
export const unb64u = (s: string): Bytes => {
  const t = s.replace(/-/g, '+').replace(/_/g, '/'); const p = t + '='.repeat((4 - (t.length % 4)) % 4)
  return Uint8Array.from(atob(p), (c) => c.charCodeAt(0))
}
const concat = (...parts: Uint8Array[]): Bytes => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0
  for (const p of parts) { out.set(p, o); o += p.length }
  return out
}

/** A new VAPID key pair: public = raw P-256 point (base64url), private = JWK (JSON). */
export async function generateVapidKeys() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey))
  const jwk = await crypto.subtle.exportKey('jwk', kp.privateKey)
  return { publicKey: b64u(pub), privateJwk: JSON.stringify(jwk) }
}

/** "Authorization: vapid t=…, k=…" for one push service. */
export async function vapidHeader(endpoint: string, publicKey: string, privateJwk: string, subject: string) {
  const key = await crypto.subtle.importKey('jwk', JSON.parse(privateJwk), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign'])
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })))
  const body = b64u(enc.encode(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })))
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${head}.${body}`))   // raw r||s, as JWS wants
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${publicKey}`
}

const hkdf = async (salt: Bytes, ikm: Bytes, info: Bytes, bytes: number) => {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, k, bytes * 8))
}

/** Encrypt a payload for one subscription (keys from PushSubscription: p256dh + auth). Returns the request body. */
export async function encryptPayload(payload: string, p256dh: string, auth: string, saltIn?: Bytes, serverKeys?: CryptoKeyPair) {
  const uaPublic = unb64u(p256dh)
  const authSecret = unb64u(auth)
  const as = serverKeys ?? await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', as.publicKey))
  const uaKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, as.privateKey, 256))
  const ikm = await hkdf(authSecret, ecdh, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32)
  const salt = saltIn ?? crypto.getRandomValues(new Uint8Array(16))
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12)
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt'])
  const plain = concat(enc.encode(payload), new Uint8Array([2]))   // 0x02 = last (only) record
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plain))
  const rs = new Uint8Array(4); new DataView(rs.buffer).setUint32(0, 4096)
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher)
}

export interface Sub { endpoint: string; p256dh: string; auth: string }
export interface Vapid { publicKey: string; privateJwk: string; subject: string }

/** Send one push. ok = delivered to the push service; gone = this subscription no longer exists (remove it). */
export async function sendPush(sub: Sub, payload: string, vapid: Vapid, ttlSeconds = 3600) {
  const body = await encryptPayload(payload, sub.p256dh, sub.auth)
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: await vapidHeader(sub.endpoint, vapid.publicKey, vapid.privateJwk, vapid.subject),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(ttlSeconds),
      Urgency: 'high',
    },
    body,
  })
  const text = res.ok ? '' : (await res.text().catch(() => '')).slice(0, 200)
  return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410, error: res.ok ? null : `${res.status} ${text}`.trim() }
}
