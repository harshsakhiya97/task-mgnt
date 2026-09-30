// Read (and write task numbers into) a private Google Sheet as a service account ("robot account").
// The sheet is shared with the service account's email: Viewer is enough to read; Editor lets the
// app write each row's task number into the "Task No" column.
// Secret: GOOGLE_SERVICE_ACCOUNT_JSON = the whole JSON key file from Google Cloud.

export interface ServiceAccount { client_email: string; private_key: string; token_uri?: string }

export function readServiceAccount(): ServiceAccount | null {
  const raw = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON')
  if (!raw) return null
  try {
    const sa = JSON.parse(raw)
    return sa.client_email && sa.private_key ? sa : null
  } catch { return null }
}

const b64url = (data: ArrayBuffer | Uint8Array | string) => {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data)
  let bin = ''
  bytes.forEach((b) => { bin += String.fromCharCode(b) })
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export async function signJwt(sa: ServiceAccount, scope: string) {
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = b64url(JSON.stringify({
    iss: sa.client_email, scope, aud: sa.token_uri ?? 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  }))
  const pem = sa.private_key.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '')
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0))
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claims}`))
  return `${header}.${claims}.${b64url(sig)}`
}

const tokens = new Map<string, string>()   // one token per run is enough (they last an hour)
async function accessToken(sa: ServiceAccount) {
  const cached = tokens.get(sa.client_email)
  if (cached) return cached
  const res = await fetch(sa.token_uri ?? 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: await signJwt(sa, 'https://www.googleapis.com/auth/spreadsheets'),
    }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok || !body.access_token) throw new Error(`Google sign-in failed: ${body.error_description ?? body.error ?? res.status}`)
  tokens.set(sa.client_email, body.access_token)
  return body.access_token as string
}

/** All cells of the tab with this gid (or the first tab), as a 2-D array, plus the tab's title. */
export async function readSheetValues(sa: ServiceAccount, sheetId: string, gid: string): Promise<{ tab: string; values: string[][] }> {
  const token = await accessToken(sa)
  const auth = { Authorization: `Bearer ${token}` }
  const meta = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}?fields=sheets.properties(sheetId,title)`, { headers: auth })
  const metaBody = await meta.json().catch(() => ({}))
  if (!meta.ok) {
    const msg = metaBody?.error?.message ?? meta.status
    if (meta.status === 403 || meta.status === 404) {
      throw new Error(`The robot account can't open the sheet. Share it with ${sa.client_email} as Editor. (${msg})`)
    }
    throw new Error(`Google Sheets: ${msg}`)
  }
  const tabs = (metaBody.sheets ?? []).map((s: { properties: { sheetId: number; title: string } }) => s.properties)
  const tab = tabs.find((t: { sheetId: number }) => String(t.sheetId) === String(gid)) ?? tabs[0]
  if (!tab) throw new Error('The sheet has no tabs')
  const range = encodeURIComponent(`'${tab.title.replace(/'/g, "''")}'`)
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values/${range}?valueRenderOption=FORMATTED_VALUE`, { headers: auth })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Google Sheets: ${body?.error?.message ?? res.status}`)
  return { tab: tab.title as string, values: (body.values ?? []) as string[][] }
}

/** "A", "B", … "Z", "AA", … for a 0-based column index. */
export function columnLetter(index: number): string {
  let n = index + 1, s = ''
  while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26) }
  return s
}

/**
 * Write single cells, e.g. [{ cell: 'H5', value: 'TM-165' }]. Needs the robot to be an Editor of the sheet.
 * Throws a friendly message if it's only a Viewer.
 */
export async function writeCells(sa: ServiceAccount, sheetId: string, tab: string, cells: { cell: string; value: string }[]) {
  if (!cells.length) return
  const token = await accessToken(sa)
  const q = `'${tab.replace(/'/g, "''")}'`
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(sheetId)}/values:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ valueInputOption: 'RAW', data: cells.map((c) => ({ range: `${q}!${c.cell}`, values: [[c.value]] })) }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    if (res.status === 403) throw new Error(`Task numbers can't be written to the sheet: give ${sa.client_email} Editor access (it's only a Viewer now).`)
    throw new Error(`Couldn't write task numbers to the sheet: ${body?.error?.message ?? res.status}`)
  }
}
