// Pure helpers for perisclaw-sync (no network, easy to test).

/** RFC 4180 CSV → rows of cells. Handles quotes, "" escapes, commas and new lines inside quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], cell = '', inQuotes = false
  const s = text.replace(/^﻿/, '')
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') { cell += '"'; i++ } else inQuotes = false
      } else cell += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') { row.push(cell); cell = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += c
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows
}

export interface SheetRow { rowNumber: number; data: Record<string, string>; text: string }

/** First row = headers. Empty rows are dropped. Row numbers match the sheet (header = row 1). */
export function sheetRows(csv: string): SheetRow[] {
  const all = parseCsv(csv)
  if (!all.length) return []
  const headers = all[0].map((h, i) => h.trim() || `Column ${i + 1}`)
  const out: SheetRow[] = []
  all.slice(1).forEach((cells, idx) => {
    const data: Record<string, string> = {}
    headers.forEach((h, i) => { const v = (cells[i] ?? '').trim(); if (v) data[h] = v })
    if (!Object.keys(data).length) return
    const text = Object.entries(data).map(([k, v]) => `${k}: ${v}`).join('\n')
    out.push({ rowNumber: idx + 2, data, text })
  })
  return out
}

/** Sheets API values (2-D array, first row = headers) → same row objects as sheetRows(). */
export function valuesToRows(values: string[][]): SheetRow[] {
  if (!values?.length) return []
  const headers = values[0].map((h, i) => String(h ?? '').trim() || `Column ${i + 1}`)
  const out: SheetRow[] = []
  values.slice(1).forEach((cells, idx) => {
    const data: Record<string, string> = {}
    headers.forEach((h, i) => { const v = String(cells?.[i] ?? '').trim(); if (v) data[h] = v })
    if (!Object.keys(data).length) return
    const text = Object.entries(data).map(([k, v]) => `${k}: ${v}`).join('\n')
    out.push({ rowNumber: idx + 2, data, text })
  })
  return out
}

export async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Same content → same hash, whatever the row position. */
export const rowKey = (r: SheetRow) => JSON.stringify(Object.entries(r.data).sort(([a], [b]) => a.localeCompare(b)))

export interface Person { id: string; full_name: string; team: string | null; role: string | null }

export interface AiResult {
  is_task: boolean
  assignee_number: number
  assignee_text: string
  title: string
  description: string
  due_date: string
  start_time: string
  end_time: string
  priority: 'low' | 'medium' | 'high' | 'urgent'
  confidence: number
  note: string
}

/** JSON schema Gemini must answer in (OpenAPI subset used by responseSchema). */
export const GEMINI_SCHEMA = {
  type: 'OBJECT',
  properties: {
    is_task: { type: 'BOOLEAN', description: 'true if this row asks someone to do something' },
    assignee_number: { type: 'INTEGER', description: 'number of the person from the team list; 0 if none or unsure' },
    assignee_text: { type: 'STRING', description: 'the assignee exactly as written in the row' },
    title: { type: 'STRING', description: 'short task title, max 80 characters, imperative' },
    description: { type: 'STRING', description: 'other useful details from the row, with line breaks and one list item per line; empty if none' },
    due_date: { type: 'STRING', description: 'YYYY-MM-DD; empty if no date can be worked out' },
    start_time: { type: 'STRING', description: 'HH:MM 24-hour; empty if no time' },
    end_time: { type: 'STRING', description: 'HH:MM 24-hour; empty if no end time' },
    priority: { type: 'STRING', enum: ['low', 'medium', 'high', 'urgent'] },
    confidence: { type: 'NUMBER', description: '0 to 1: how sure you are about assignee AND date' },
    note: { type: 'STRING', description: 'short reason if anything is unclear; empty otherwise' },
  },
  required: ['is_task', 'assignee_number', 'assignee_text', 'title', 'description', 'due_date', 'start_time', 'end_time', 'priority', 'confidence', 'note'],
}

export function buildPrompt(row: SheetRow, people: Person[], nowIst: { date: string; weekday: string; time: string }) {
  const list = people.map((p, i) =>
    `${i + 1}. ${p.full_name}${p.team ? ` (team: ${p.team})` : ''}${p.role ? ` [${p.role}]` : ''}`).join('\n')
  return `You turn rows from a to-do sheet into tasks for Pride Educare's task app.
Today is ${nowIst.weekday}, ${nowIst.date}; the time now is ${nowIst.time} (India, IST).

Team members (pick the assignee by number):
${list}

Sheet row:
${row.text}

Rules:
- assignee_number: the team member the task is for. Match nicknames, first names, short forms and small spelling mistakes. Use 0 if nobody matches or two people match equally.
- description: the useful details from the row. Keep it readable: keep the row's line breaks, and put each numbered or bulleted point on its own line. Write symbols like ₹ as they are, not as \\u codes. Don't repeat the title, assignee or date.
- title: short and clear (e.g. "Prepare TVS weekly report"). Don't put the person's name or the date in the title.
- due_date: resolve words like "today", "tomorrow", "Friday", "next Monday", "by 5th" to a real date on or after today. If no date is given at all, use today's date and lower confidence.
- start_time / end_time: only if a time is given. "by 5 pm" means end_time 17:00 with no start_time. "at 3 pm" means start_time 15:00. "3-4 pm" gives both.
- priority: urgent/asap/immediately = urgent; important/high = high; low/whenever = low; otherwise medium.
- confidence: below 0.75 if the person or the date is a guess.`
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/

export interface Decision {
  ok: boolean
  reason: string
  task?: {
    assigned_to: string; title: string; description: string; due_date: string
    start_time: string | null; end_time: string | null; priority: AiResult['priority']
  }
}

const addHour = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  return h >= 23 ? '23:59' : `${String(h + 1).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}
const subHour = (t: string) => {
  const [h, m] = t.split(':').map(Number)
  return h < 1 ? '00:00' : `${String(h - 1).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** Put numbered points ("1. … 2. …") on their own lines if the AI ran them together. */
export function tidyDescription(text: string): string {
  const t = text
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))   // "\u20b9" -> ₹
    .replace(/\\n/g, '\n').replace(/\r\n/g, '\n').trim()
  if (t.includes('\n') || (t.match(/(^|\s)\d{1,2}[.)]\s/g) ?? []).length < 2) return t
  return t.replace(/\s+(?=\d{1,2}[.)]\s)/g, '\n')
}

/** Decide whether the AI's answer is safe to turn into a task automatically. */
export function decide(ai: AiResult, people: Person[], today: string): Decision {
  const problems: string[] = []
  if (!ai.is_task) problems.push("doesn't look like a task")
  const person = ai.assignee_number >= 1 && ai.assignee_number <= people.length ? people[ai.assignee_number - 1] : null
  if (!person) problems.push(ai.assignee_text ? `couldn't match "${ai.assignee_text}" to a team member` : 'no assignee found')
  const title = (ai.title ?? '').trim().slice(0, 200)
  if (!title) problems.push('no task text')
  const due = (ai.due_date ?? '').trim()
  if (!DATE.test(due) || isNaN(Date.parse(due))) problems.push('no clear due date')
  else if (due < today) problems.push(`due date ${due} is in the past`)
  let start = TIME.test(ai.start_time ?? '') ? ai.start_time : null
  let end = TIME.test(ai.end_time ?? '') ? ai.end_time : null
  if (start && !end) end = addHour(start)
  if (end && !start) start = subHour(end)                   // "by 5 pm": last hour before the deadline, expires at 5 pm
  if (start && end && end <= start) end = addHour(start)
  if (!(ai.confidence >= 0.75)) problems.push(`AI wasn't sure (${Math.round((ai.confidence || 0) * 100)}%)${ai.note ? `: ${ai.note}` : ''}`)
  const priority = (['low', 'medium', 'high', 'urgent'] as const).includes(ai.priority) ? ai.priority : 'medium'

  const description = tidyDescription(ai.description ?? '')
  return {
    ok: problems.length === 0,
    reason: problems.join('; '),
    task: person && title ? {
      assigned_to: person.id, title, description, due_date: due,
      start_time: start, end_time: end, priority,
    } : undefined,
  }
}

/** Today's date, weekday and time in India. */
export function nowInIndia(d = new Date()) {
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', ...o }).format(d)
  return {
    date: f({ year: 'numeric', month: '2-digit', day: '2-digit' }),
    weekday: new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', weekday: 'long' }).format(d),
    time: new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }).format(d),
  }
}
