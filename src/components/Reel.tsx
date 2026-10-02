import { useEffect, useState } from 'react'
import { Check, CheckCircle2, CirclePause, CirclePlay, CircleStop, ExternalLink, Plus, Timer, Trash2, Undo2 } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { formatDate, formatTime, timeAgo, type Task } from '../lib/tasks'
import {
  durationText, minutesText, STAGE_LABELS, stageAtLeast, STAGES, timer, totalSeconds, viewsText,
  type ReelStage, type TimeEntry,
} from '../lib/reels'
import { ConfirmDialog } from './ConfirmDialog'
import { CopyButton } from './CopyButton'

type Props = { task: Task; onChanged: () => void; onError: (m: string) => void }

/** Re-render every second while `on` (for a running timer). */
function useSecondTick(on: boolean) {
  const [, set] = useState(0)
  useEffect(() => {
    if (!on) return
    const id = window.setInterval(() => set((n) => n + 1), 1000)
    return () => window.clearInterval(id)
  }, [on])
}

/** ISO → value for <input type="datetime-local"> (this device's time). */
function toLocalInput(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}
const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null)
const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
const dateTime = (iso: string) => `${formatDate(iso)}, ${clock(iso)}`

/** "05-10-2026, 6:00 pm" (time only if set). */
export function uploadText(date: string | null | undefined, time: string | null | undefined) {
  if (!date) return ''
  return time ? `${formatDate(date)}, ${formatTime(time)}` : formatDate(date)
}

async function setStage(taskId: string, stage: ReelStage) {
  const { error } = await supabase.from('task_reels').update({ stage }).eq('task_id', taskId)
  return error?.message ?? null
}

/** Small "🎬 Reel · Editing" chip for lists and boards. */
export function stageChipText(task: Pick<Task, 'reel'>) {
  return task.reel?.stage ? `🎬 ${STAGE_LABELS[task.reel.stage]}` : '🎬 Reel'
}

// ------------------------------------------------------------------ stage bar

/** Scripting → Editing → Review → Posted. Anyone on the reel can move it (click a stage). */
export function StageBar({ task, onChanged, onError }: Props) {
  const current = task.reel?.stage ?? 'scripting'
  const [busy, setBusy] = useState(false)
  const move = async (s: ReelStage) => {
    if (s === current || busy) return
    setBusy(true)
    const err = await setStage(task.id, s)
    setBusy(false)
    if (err) onError(err); else onChanged()
  }
  const ci = STAGES.indexOf(current)
  return (
    <div className="stage-bar" role="tablist" aria-label="Reel stage">
      {STAGES.map((s, i) => (
        <button key={s} type="button" role="tab" aria-selected={s === current} disabled={busy}
          className={`stage ${s === current ? 'on' : i < ci ? 'past' : ''}`} onClick={() => move(s)}
          title={s === current ? 'Current stage' : `Move to ${STAGE_LABELS[s]}`}>
          <span className="stage-dot">{i < ci ? <Check size={12} /> : i + 1}</span>{STAGE_LABELS[s]}
        </button>
      ))}
    </div>
  )
}

// ------------------------------------------------------------------ overview (what to do now)

/** The Overview card for a reel: the stage bar plus what this stage needs. */
export function ReelOverview({ task, entries, onChanged, onError }: Props & { entries: TimeEntry[] }) {
  const { profile } = useAuth()
  const stage = task.reel?.stage ?? 'scripting'
  const isAssignee = task.assigned_to === profile?.id
  const who = task.assignee?.full_name ?? 'Someone'
  const [busy, setBusy] = useState(false)
  const go = async (s: ReelStage) => {
    setBusy(true); const err = await setStage(task.id, s); setBusy(false)
    if (err) onError(err); else onChanged()
  }

  return (
    <div className="reel-overview">
      <StageBar task={task} onChanged={onChanged} onError={onError} />
      {stage === 'scripting' && (
        <div className="stage-card">
          <p><b>📝 Scripting.</b> {isAssignee ? 'Write the script' : `${who} is writing the script`}. When it's ready, reassign the reel to the editor and move it to Editing.</p>
          <div className="stage-actions">
            <button type="button" className="secondary" disabled={busy} onClick={() => go('editing')}>Move to Editing</button>
          </div>
        </div>
      )}
      {stage === 'editing' && <ReelTimer task={task} entries={entries} onChanged={onChanged} onError={onError} />}
      {stage === 'review' && (
        <div className="stage-card">
          <p><b>👀 In review.</b> Edited in {durationText(totalSeconds(entries))}
            {task.reel?.expected_minutes ? ` (expected ${minutesText(task.reel.expected_minutes)})` : ''}
            {task.reel?.expected_views != null ? ` · expected views ${viewsText(task.reel.expected_views)}` : ''}.
            {' '}Changes needed? Reassign it to the editor and move it back to Editing. Approved? Post it and save the links.</p>
          <PostLinks task={task} onChanged={onChanged} onError={onError} compact />
          <div className="stage-actions">
            <button type="button" className="link" disabled={busy} onClick={() => go('editing')}><Undo2 size={14} /> Back to Editing</button>
          </div>
        </div>
      )}
      {stage === 'posted' && (
        <div className="stage-card">
          <p><b>📢 Posted</b>{task.reel?.posted_at ? ` ${dateTime(task.reel.posted_at)}` : ''}.{' '}
            {task.reel?.instagram_url && <a href={task.reel.instagram_url} target="_blank" rel="noopener noreferrer" className="link-icon"><ExternalLink size={13} /> Instagram</a>}{' '}
            {task.reel?.youtube_url && <a href={task.reel.youtube_url} target="_blank" rel="noopener noreferrer" className="link-icon"><ExternalLink size={13} /> YouTube</a>}
          </p>
          <ActualViews task={task} onChanged={onChanged} onError={onError} />
          {task.status !== 'done' && <MarkDone task={task} onChanged={onChanged} onError={onError} />}
        </div>
      )}
    </div>
  )
}

function MarkDone({ task, onChanged, onError }: Props) {
  const [busy, setBusy] = useState(false)
  const done = async () => {
    setBusy(true)
    const { error } = await supabase.from('tasks').update({ status: 'done' }).eq('id', task.id)
    setBusy(false)
    if (error) onError(error.message); else onChanged()
  }
  return (
    <div className="stage-actions">
      <button type="button" className="secondary" disabled={busy} onClick={done}><CheckCircle2 size={16} /> Mark as Done</button>
    </div>
  )
}

// ------------------------------------------------------------------ timer (Editing)

/** Edit-time bar: "1h 10m of 2h expected". */
function TimeBar({ seconds, expected }: { seconds: number; expected: number | null }) {
  if (!expected) return null
  const pct = Math.round((seconds / 60 / expected) * 100)
  return (
    <div className={`reel-bar ${pct > 100 ? 'over' : ''}`}>
      <span className="reel-bar-track"><i style={{ width: `${Math.min(100, pct)}%` }} /></span>
      <span className="small">{pct}% of {minutesText(expected)} expected{pct > 100 && ` · ${durationText(seconds - expected * 60)} over`}</span>
    </div>
  )
}

/**
 * Editing stage: the editor's expected edit time, then Start / Pause, and "Editing done" (asks for the expected views)
 * → Review. Admins can pause or finish a timer that was left running.
 */
export function ReelTimer({ task, entries, onChanged, onError }: Props & { entries: TimeEntry[] }) {
  const { profile } = useAuth()
  const running = entries.find((e) => !e.ended_at)
  useSecondTick(!!running)
  const [busy, setBusy] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [expViews, setExpViews] = useState(task.reel?.expected_views != null ? String(task.reel.expected_views) : '')
  const isAssignee = !!profile && task.assigned_to === profile.id
  const canControl = isAssignee || profile?.role === 'admin'
  const seconds = totalSeconds(entries)

  const act = async (a: 'start' | 'pause' | 'stop') => {
    setBusy(true)
    if (a === 'stop' && isAssignee) {
      const v = expViews.trim() === '' ? null : Math.round(Number(expViews))
      if (v != null && (!Number.isFinite(v) || v < 0)) { setBusy(false); return onError('Expected views should be a number') }
      if (v !== (task.reel?.expected_views ?? null)) {
        const { error } = await supabase.from('task_reels').update({ expected_views: v }).eq('task_id', task.id)
        if (error) { setBusy(false); return onError(error.message) }
      }
    }
    const err = await timer(task.id, a)
    setBusy(false); setFinishing(false)
    if (err) onError(err); else onChanged()
  }

  return (
    <div className={`reel-timer ${running ? 'running' : ''}`}>
      {isAssignee && <ExpectedField task={task} kind="time" onChanged={onChanged} onError={onError} label="How long will this edit take?" quiet />}
      <div className="reel-timer-main">
        <Timer size={22} />
        <div>
          <div className="reel-timer-clock">{durationText(seconds, true)}</div>
          <div className="muted small">
            {running ? <><span className="live-dot" /> {isAssignee ? 'Editing now' : `${task.assignee?.full_name ?? 'Editor'} is editing now`} · since {clock(running.started_at)}</>
              : seconds > 0 ? 'Paused' : isAssignee ? 'Tap Start when you begin editing' : 'Editing not started yet'}
          </div>
        </div>
        <span className="spacer" />
        <div className="reel-timer-btns">
          {!running && isAssignee && (
            <button type="button" className="go" disabled={busy} onClick={() => act('start')}><CirclePlay size={17} /> {seconds > 0 ? 'Resume' : 'Start'}</button>
          )}
          {running && canControl && (
            <button type="button" className="secondary" disabled={busy} onClick={() => act('pause')}><CirclePause size={17} /> Pause</button>
          )}
          {canControl && (running || seconds > 0) && (
            <button type="button" className="stop" disabled={busy} onClick={() => setFinishing(true)}><CircleStop size={17} /> Editing done</button>
          )}
        </div>
      </div>
      <TimeBar seconds={seconds} expected={task.reel?.expected_minutes ?? null} />
      {finishing && (
        <ConfirmDialog icon={<CircleStop size={30} />} title="Editing done?" tone="info"
          message={`The timer stops at ${durationText(seconds)} and the reel moves to Review.`}
          confirmLabel="Yes, send to Review" busy={busy} onConfirm={() => act('stop')} onCancel={() => setFinishing(false)}>
          {isAssignee && (
            <label className="reel-field dialog-field">
              <span>Your expected views (optional)</span>
              <input type="number" inputMode="numeric" min={0} step={100} placeholder="e.g. 10000" value={expViews} onChange={(e) => setExpViews(e.target.value)} autoFocus />
              <small className="muted">How many views you think it'll get in 24 hours.</small>
            </label>
          )}
        </ConfirmDialog>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ Reel tab

/** The Reel tab: everything about the reel, showing only what its stage has reached. */
export function ReelPanel({ task, entries, onChanged, onError }: Props & { entries: TimeEntry[] }) {
  const reel = task.reel
  if (!reel) return <p className="muted">Reel details are loading…</p>
  const st = reel.stage
  return (
    <>
      <div className="reel-head">
        <StageBar task={task} onChanged={onChanged} onError={onError} />
        {reel.upload_date && <div className="small">Upload: <b>{uploadText(reel.upload_date, reel.upload_time)}</b></div>}
      </div>
      <Caption task={task} onChanged={onChanged} onError={onError} />
      {(stageAtLeast(st, 'editing') || entries.length > 0) && <TimeSection task={task} entries={entries} onChanged={onChanged} onError={onError} />}
      {stageAtLeast(st, 'review') && <ViewsSection task={task} onChanged={onChanged} onError={onError} />}
      {stageAtLeast(st, 'review') && (
        <>
          <div className="form-section">Post</div>
          <PostLinks task={task} onChanged={onChanged} onError={onError} />
        </>
      )}
      {!stageAtLeast(st, 'review') && <p className="muted small">Post links and views appear once the reel reaches Review.</p>}
    </>
  )
}

function Caption({ task, onChanged, onError }: Props) {
  const reel = task.reel!
  const [caption, setCaption] = useState(reel.caption ?? '')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  useEffect(() => { setCaption(reel.caption ?? '') }, [reel.caption])
  const dirty = caption.trim() !== (reel.caption ?? '')
  const save = async () => {
    setBusy(true)
    const { error } = await supabase.from('task_reels').update({ caption: caption.trim() || null }).eq('task_id', task.id)
    setBusy(false)
    if (error) return onError(error.message)
    setSaved(true); window.setTimeout(() => setSaved(false), 1500); onChanged()
  }
  return (
    <>
      <div className="form-section with-action">Caption {reel.caption && <CopyButton text={reel.caption} />}</div>
      <div className="reel-form">
        <textarea rows={3} placeholder="Caption for the post" value={caption} onChange={(e) => setCaption(e.target.value)} />
        {(dirty || saved) && (
          <div className="inline-edit">
            <button type="button" disabled={!dirty || busy} onClick={save}>{busy ? 'Saving…' : 'Save caption'}</button>
            {saved && <span className="saved-tick"><Check size={14} /> Saved</span>}
          </div>
        )}
      </div>
    </>
  )
}

/** Instagram / YouTube links + posted date & time. Saving the first link moves the reel to Posted. */
function PostLinks({ task, onChanged, onError, compact }: Props & { compact?: boolean }) {
  const reel = task.reel!
  const [ig, setIg] = useState(reel.instagram_url ?? '')
  const [yt, setYt] = useState(reel.youtube_url ?? '')
  const [posted, setPosted] = useState(toLocalInput(reel.posted_at))
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  useEffect(() => { setIg(reel.instagram_url ?? ''); setYt(reel.youtube_url ?? ''); setPosted(toLocalInput(reel.posted_at)) },
    [reel.instagram_url, reel.youtube_url, reel.posted_at])

  const dirty = ig.trim() !== (reel.instagram_url ?? '') || yt.trim() !== (reel.youtube_url ?? '') || posted !== toLocalInput(reel.posted_at)
  const badUrl = [ig, yt].some((u) => u.trim() && !/^https?:\/\/\S+$/i.test(u.trim()))

  const save = async () => {
    if (badUrl) return onError('Links should start with https://')
    if (posted && new Date(posted).getTime() > Date.now() + 5 * 60e3) return onError('Posted time can\'t be in the future')
    setBusy(true)
    const { error } = await supabase.from('task_reels').update({
      instagram_url: ig.trim() || null, youtube_url: yt.trim() || null, posted_at: fromLocalInput(posted),
    }).eq('task_id', task.id)
    setBusy(false)
    if (error) return onError(error.message)
    setSaved(true); window.setTimeout(() => setSaved(false), 1500)
    onChanged()
  }
  const open = (url: string | null) => url && <a href={url} target="_blank" rel="noopener noreferrer" className="link-icon"><ExternalLink size={13} /> Open</a>

  return (
    <div className={`reel-form ${compact ? 'compact' : ''}`}>
      <div className="form-grid">
        <label className="reel-field">
          <span>Instagram link {open(reel.instagram_url)}</span>
          <input type="url" inputMode="url" placeholder="https://www.instagram.com/reel/…" value={ig} onChange={(e) => setIg(e.target.value)} />
        </label>
        <label className="reel-field">
          <span>YouTube link {open(reel.youtube_url)}</span>
          <input type="url" inputMode="url" placeholder="https://youtube.com/shorts/…" value={yt} onChange={(e) => setYt(e.target.value)} />
        </label>
      </div>
      <label className="reel-field">
        <span>Posted date & time</span>
        <input type="datetime-local" value={posted} onChange={(e) => setPosted(e.target.value)} />
        <small className="muted">Leave empty to use the time you save the first link.</small>
      </label>
      <div className="inline-edit">
        <button type="button" disabled={!dirty || busy} onClick={save}>{busy ? 'Saving…' : reel.stage === 'posted' ? 'Save' : 'Save & mark Posted'}</button>
        {saved && <span className="saved-tick"><Check size={14} /> Saved</span>}
      </div>
    </div>
  )
}

/** The one actual view count (added ~24 h after posting). */
function ActualViews({ task, onChanged, onError }: Props) {
  const reel = task.reel!
  const [value, setValue] = useState(reel.actual_views != null ? String(reel.actual_views) : '')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  useEffect(() => { setValue(reel.actual_views != null ? String(reel.actual_views) : '') }, [reel.actual_views])
  const next = value.trim() === '' ? null : Math.round(Number(value))
  const dirty = next !== reel.actual_views
  const hoursSincePost = reel.posted_at ? (Date.now() - new Date(reel.posted_at).getTime()) / 3600e3 : null

  const save = async () => {
    if (next != null && (!Number.isFinite(next) || next < 0)) return onError('Views should be a number')
    setBusy(true)
    const { error } = await supabase.from('task_reels').update({ actual_views: next }).eq('task_id', task.id)
    setBusy(false)
    if (error) return onError(error.message)
    setSaved(true); window.setTimeout(() => setSaved(false), 1500)
    onChanged()
  }
  return (
    <>
      <div className="reel-add-views">
        <label className="reel-field">
          <span>Actual views {reel.instagram_url && reel.youtube_url ? '(Instagram + YouTube)' : ''}
            {hoursSincePost != null && hoursSincePost < 24 && reel.actual_views == null && <span className="req-dot"> · due in {durationText((24 - hoursSincePost) * 3600)}</span>}</span>
          <input type="number" inputMode="numeric" min={0} placeholder="e.g. 12500" value={value} onChange={(e) => setValue(e.target.value)} />
        </label>
        <button type="button" disabled={!dirty || busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
        {saved && <span className="saved-tick"><Check size={14} /> Saved</span>}
      </div>
      <p className="muted small">Add the views once, 24 hours after posting{reel.actual_views != null && reel.views_counted_at ? ` · saved ${dateTime(reel.views_counted_at)}` : ''}.</p>
    </>
  )
}

/** One "expected" value (views or edit time) — the editor's own estimate, only the editor sets it (any time). */
function ExpectedField({ task, kind, onChanged, onError, label, quiet }: Props & { kind: 'views' | 'time'; label?: string; quiet?: boolean }) {
  const { profile } = useAuth()
  const reel = task.reel!
  const cur = kind === 'views' ? reel.expected_views : reel.expected_minutes
  const [views, setViews] = useState('')
  const [h, setH] = useState('')
  const [m, setM] = useState('')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    if (kind === 'views') setViews(cur != null ? String(cur) : '')
    else { setH(cur ? String(Math.floor(cur / 60)) : ''); setM(cur ? String(cur % 60) : '') }
  }, [cur, kind])
  if (!profile || task.assigned_to !== profile.id) return cur == null && !quiet ? <p className="muted small">The editor sets this.</p> : null
  // On the timer card, once set, the bar shows it — no need to keep the input there.
  if (quiet && cur != null) return null
  const next = kind === 'views' ? (views.trim() === '' ? null : Math.round(Number(views))) : ((Number(h) || 0) * 60 + (Number(m) || 0)) || null
  const dirty = next !== cur

  const save = async () => {
    if (next != null && (!Number.isFinite(next) || next < 0)) return onError('Please type a number')
    setBusy(true)
    const { error } = await supabase.from('task_reels').update(kind === 'views' ? { expected_views: next } : { expected_minutes: next }).eq('task_id', task.id)
    setBusy(false)
    if (error) return onError(error.message)
    setSaved(true); window.setTimeout(() => setSaved(false), 1500)
    onChanged()
  }

  return (
    <div className="reel-add-views">
      <label className="reel-field">
        <span>{label ?? (kind === 'views' ? 'Your expected views' : 'Your expected edit time')}</span>
        {kind === 'views'
          ? <input type="number" inputMode="numeric" min={0} step={100} placeholder="e.g. 10000" value={views} onChange={(e) => setViews(e.target.value)} />
          : (
            <div className="duration-input">
              <input type="number" inputMode="numeric" min={0} max={168} placeholder="0" value={h} onChange={(e) => setH(e.target.value)} aria-label="Hours" /><span>h</span>
              <input type="number" inputMode="numeric" min={0} max={59} step={5} placeholder="0" value={m} onChange={(e) => setM(e.target.value)} aria-label="Minutes" /><span>m</span>
            </div>
          )}
      </label>
      <button type="button" className="secondary" disabled={!dirty || busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
      {saved && <span className="saved-tick"><Check size={14} /> Saved</span>}
    </div>
  )
}

function ViewsSection({ task, onChanged, onError }: Props) {
  const reel = task.reel!
  const exp = reel.expected_views
  const actual = reel.actual_views
  return (
    <>
      <div className="form-section">Views</div>
      <div className="reel-stats two">
        <div><span>Expected</span><b>{viewsText(exp)}</b></div>
        <div>
          <span>Actual</span>
          <b>{viewsText(actual)}</b>
          {actual != null && exp ? <small className={actual >= exp ? 'ok-text' : 'overdue-text'}>{Math.round((actual / exp) * 100)}% of expected</small>
            : actual != null && reel.views_counted_at ? <small className="muted">counted {timeAgo(reel.views_counted_at)}</small> : null}
        </div>
      </div>
      <ExpectedField task={task} kind="views" onChanged={onChanged} onError={onError} />
      {reel.stage === 'posted'
        ? <ActualViews task={task} onChanged={onChanged} onError={onError} />
        : <p className="muted small">The actual views can be added once the reel is Posted.</p>}
    </>
  )
}

function TimeSection({ task, entries, onChanged, onError }: Props & { entries: TimeEntry[] }) {
  const { profile } = useAuth()
  const [h, setH] = useState('')
  const [m, setM] = useState('')
  const [busy, setBusy] = useState(false)
  const isAssignee = task.assigned_to === profile?.id
  const seconds = totalSeconds(entries)
  const list = [...entries].sort((a, b) => b.started_at.localeCompare(a.started_at))

  const addTime = async () => {
    const mins = (Number(h) || 0) * 60 + (Number(m) || 0)
    if (mins <= 0) return onError('Type the hours / minutes to add')
    setBusy(true)
    const end = new Date()
    const { error } = await supabase.from('task_time_entries').insert({
      task_id: task.id, user_id: profile!.id, manual: true,
      started_at: new Date(end.getTime() - mins * 60e3).toISOString(), ended_at: end.toISOString(),
    })
    setBusy(false)
    if (error) return onError(error.message)
    setH(''); setM(''); onChanged()
  }
  const remove = async (id: number) => {
    const { error } = await supabase.from('task_time_entries').delete().eq('id', id)
    if (error) onError(error.message); else onChanged()
  }

  return (
    <>
      <div className="form-section">Edit Time</div>
      <div className="reel-stats">
        <div><span>Expected</span><b>{minutesText(task.reel?.expected_minutes)}</b></div>
        <div><span>Actual</span><b>{durationText(seconds)}</b></div>
        <div><span>Blocks</span><b>{entries.length}</b></div>
      </div>
      <ExpectedField task={task} kind="time" onChanged={onChanged} onError={onError} />
      {list.length === 0 ? <p className="muted">No time yet. The editor's Start / Pause on the Overview tab adds a block.</p> : (
        <ul className="reel-history">
          {list.map((e) => (
            <li key={e.id}>
              <b>{durationText(totalSeconds([e]))}</b>
              <span className="muted">{formatDate(e.started_at)} · {e.manual ? 'added by hand' : `${clock(e.started_at)} – ${e.ended_at ? clock(e.ended_at) : 'now'}`}</span>
              <small className="muted">{e.person?.full_name ?? ''}{!e.ended_at && ' · running'}</small>
              {e.ended_at && (e.user_id === profile?.id || profile?.role === 'admin') && (
                <button className="icon" title="Delete this block" onClick={() => remove(e.id)}><Trash2 size={15} /></button>
              )}
            </li>
          ))}
        </ul>
      )}
      {isAssignee && (
        <div className="reel-add-time">
          <span className="small">Forgot the timer? Add time:</span>
          <div className="duration-input">
            <input type="number" inputMode="numeric" min={0} max={24} placeholder="0" value={h} onChange={(e) => setH(e.target.value)} aria-label="Hours" /><span>h</span>
            <input type="number" inputMode="numeric" min={0} max={59} step={5} placeholder="0" value={m} onChange={(e) => setM(e.target.value)} aria-label="Minutes" /><span>m</span>
          </div>
          <button type="button" className="secondary" disabled={busy} onClick={addTime}><Plus size={16} /> Add</button>
        </div>
      )}
      <p className="muted small">A timer still running at 11:59 pm is paused automatically. Delete a wrong block and add the right time by hand.</p>
    </>
  )
}
