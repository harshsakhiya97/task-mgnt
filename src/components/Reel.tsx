import { useEffect, useState } from 'react'
import { Check, CirclePause, CirclePlay, CircleStop, ExternalLink, Plus, Timer, Trash2 } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { formatDate, timeAgo, type Task } from '../lib/tasks'
import {
  durationText, minutesText, REEL_SUB_TYPES, timer, totalSeconds, viewsText, type TimeEntry,
} from '../lib/reels'
import { ConfirmDialog } from './ConfirmDialog'
import { CopyButton } from './CopyButton'

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

function clock(iso: string) {
  return new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
}
function dateTime(iso: string) {
  return `${formatDate(iso)}, ${clock(iso)}`
}

/** Edit-time bar: "1h 10m of 2h expected". */
function TimeBar({ seconds, expected }: { seconds: number; expected: number | null }) {
  if (!expected) return <div className="muted small">No expected edit time set.</div>
  const pct = Math.round((seconds / 60 / expected) * 100)
  return (
    <div className={`reel-bar ${pct > 100 ? 'over' : ''}`}>
      <span className="reel-bar-track"><i style={{ width: `${Math.min(100, pct)}%` }} /></span>
      <span className="small">{pct}% of {minutesText(expected)} expected{pct > 100 && ` · ${durationText(seconds - expected * 60)} over`}</span>
    </div>
  )
}

/**
 * Start / Pause / Stop for the editor (the task's assignee). Start → In Progress; every Start → Pause is a time block;
 * Stop = editing finished → Done. Admins can pause or stop a timer that was left running.
 */
export function ReelTimer({ task, entries, onChanged, onError }: {
  task: Task; entries: TimeEntry[]; onChanged: () => void; onError: (m: string) => void
}) {
  const { profile } = useAuth()
  const running = entries.find((e) => !e.ended_at)
  useSecondTick(!!running)
  const [busy, setBusy] = useState(false)
  const [confirmStop, setConfirmStop] = useState(false)
  const isAssignee = !!profile && task.assigned_to === profile.id
  const canControl = isAssignee || profile?.role === 'admin'
  const seconds = totalSeconds(entries)
  const done = task.status === 'done'

  const act = async (a: 'start' | 'pause' | 'stop') => {
    setBusy(true)
    const err = await timer(task.id, a)
    setBusy(false); setConfirmStop(false)
    if (err) onError(err); else onChanged()
  }

  return (
    <div className={`reel-timer ${running ? 'running' : ''}`}>
      <div className="reel-timer-main">
        <Timer size={22} />
        <div>
          <div className="reel-timer-clock">{durationText(seconds, true)}</div>
          <div className="muted small">
            {running ? <><span className="live-dot" /> {isAssignee ? 'Editing now' : `${task.assignee?.full_name ?? 'Editor'} is editing now`} · since {clock(running.started_at)}</>
              : done ? 'Editing finished' : seconds > 0 ? 'Paused' : 'Not started'}
          </div>
        </div>
        <span className="spacer" />
        <div className="reel-timer-btns">
          {!running && !done && isAssignee && (
            <button type="button" className="go" disabled={busy} onClick={() => act('start')}><CirclePlay size={17} /> {seconds > 0 ? 'Resume' : 'Start'}</button>
          )}
          {running && canControl && (
            <button type="button" className="secondary" disabled={busy} onClick={() => act('pause')}><CirclePause size={17} /> Pause</button>
          )}
          {!done && canControl && (running || seconds > 0) && (
            <button type="button" className="stop" disabled={busy} onClick={() => setConfirmStop(true)}><CircleStop size={17} /> Stop</button>
          )}
        </div>
      </div>
      <TimeBar seconds={seconds} expected={task.reel?.expected_minutes ?? null} />
      {!isAssignee && !running && !done && seconds === 0 && <div className="muted small">The editor starts the timer from their own login.</div>}
      {confirmStop && (
        <ConfirmDialog icon={<CircleStop size={30} />} title="Finish editing?"
          message={`The timer stops at ${durationText(seconds)} and ${task.title ? `"${task.title}"` : 'the reel'} moves to Done. You can still add the post links and views afterwards.`}
          confirmLabel="Yes, Finished" busy={busy} onConfirm={() => act('stop')} onCancel={() => setConfirmStop(false)} />
      )}
    </div>
  )
}

/** The Reel tab: caption, post links, views (at 24 h and latest) and the edit-time blocks. */
export function ReelPanel({ task, entries, onChanged, onError }: {
  task: Task; entries: TimeEntry[]; onChanged: () => void; onError: (m: string) => void
}) {
  const reel = task.reel
  if (!reel) return <p className="muted">Reel details are loading…</p>
  return (
    <>
      <SubTypePicker task={task} onChanged={onChanged} onError={onError} />
      <PostDetails task={task} onChanged={onChanged} onError={onError} />
      <ViewsSection task={task} onChanged={onChanged} onError={onError} />
      <TimeSection task={task} entries={entries} onChanged={onChanged} onError={onError} />
    </>
  )
}

/** Sub-type, changeable by anyone on the reel (the editor too); saves as soon as it's picked. */
function SubTypePicker({ task, onChanged, onError }: { task: Task; onChanged: () => void; onError: (m: string) => void }) {
  const cur = task.reel?.sub_type ?? ''
  const [value, setValue] = useState(cur)
  const [saved, setSaved] = useState(false)
  useEffect(() => { setValue(cur) }, [cur])
  const change = async (v: string) => {
    setValue(v)
    const { error } = await supabase.from('task_reels').update({ sub_type: v || null }).eq('task_id', task.id)
    if (error) { setValue(cur); return onError(error.message) }
    setSaved(true); window.setTimeout(() => setSaved(false), 1500)
    onChanged()
  }
  return (
    <div className="reel-subtype">
      <label className="reel-field">
        <span>Sub-type {saved && <span className="saved-tick"><Check size={14} /> Saved</span>}</span>
        <select value={value} onChange={(e) => change(e.target.value)}>
          <option value="">Select…</option>
          {REEL_SUB_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          {value && !(REEL_SUB_TYPES as readonly string[]).includes(value) && <option value={value}>{value}</option>}
        </select>
      </label>
    </div>
  )
}

function PostDetails({ task, onChanged, onError }: { task: Task; onChanged: () => void; onError: (m: string) => void }) {
  const reel = task.reel!
  const [caption, setCaption] = useState(reel.caption ?? '')
  const [ig, setIg] = useState(reel.instagram_url ?? '')
  const [yt, setYt] = useState(reel.youtube_url ?? '')
  const [drive, setDrive] = useState(reel.drive_url ?? '')
  const [posted, setPosted] = useState(toLocalInput(reel.posted_at))
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    setCaption(reel.caption ?? ''); setIg(reel.instagram_url ?? ''); setYt(reel.youtube_url ?? ''); setDrive(reel.drive_url ?? ''); setPosted(toLocalInput(reel.posted_at))
  }, [reel.caption, reel.instagram_url, reel.youtube_url, reel.drive_url, reel.posted_at])

  const dirty = caption.trim() !== (reel.caption ?? '') || ig.trim() !== (reel.instagram_url ?? '') || yt.trim() !== (reel.youtube_url ?? '') || drive.trim() !== (reel.drive_url ?? '')
    || posted !== toLocalInput(reel.posted_at)
  const badUrl = [ig, yt, drive].some((u) => u.trim() && !/^https?:\/\/\S+$/i.test(u.trim()))

  const save = async () => {
    if (badUrl) return onError('Links should start with https://')
    if (posted && new Date(posted).getTime() > Date.now() + 5 * 60e3) return onError('Posted time can\'t be in the future')
    setBusy(true)
    const { error } = await supabase.from('task_reels').update({
      caption: caption.trim() || null, instagram_url: ig.trim() || null, youtube_url: yt.trim() || null, drive_url: drive.trim() || null, posted_at: fromLocalInput(posted),
    }).eq('task_id', task.id)
    setBusy(false)
    if (error) return onError(error.message)
    setSaved(true); window.setTimeout(() => setSaved(false), 1500)
    onChanged()
  }

  return (
    <>
      <div className="form-section">Post</div>
      <div className="reel-form">
        <label className="reel-field">
          <span>Caption {caption.trim() && <CopyButton text={caption.trim()} />}</span>
          <textarea rows={3} placeholder="Caption for the post" value={caption} onChange={(e) => setCaption(e.target.value)} />
        </label>
        <div className="form-grid three">
          <label className="reel-field">
            <span>Instagram link {reel.instagram_url && <a href={reel.instagram_url} target="_blank" rel="noopener noreferrer" className="link-icon"><ExternalLink size={13} /> Open</a>}</span>
            <input type="url" inputMode="url" placeholder="https://www.instagram.com/reel/…" value={ig} onChange={(e) => setIg(e.target.value)} />
          </label>
          <label className="reel-field">
            <span>YouTube link {reel.youtube_url && <a href={reel.youtube_url} target="_blank" rel="noopener noreferrer" className="link-icon"><ExternalLink size={13} /> Open</a>}</span>
            <input type="url" inputMode="url" placeholder="https://youtube.com/shorts/…" value={yt} onChange={(e) => setYt(e.target.value)} />
          </label>
          <label className="reel-field">
            <span>Drive link {reel.drive_url && <a href={reel.drive_url} target="_blank" rel="noopener noreferrer" className="link-icon"><ExternalLink size={13} /> Open</a>}</span>
            <input type="url" inputMode="url" placeholder="https://drive.google.com/…" value={drive} onChange={(e) => setDrive(e.target.value)} />
          </label>
        </div>
        {reel.upload_date && <div className="small">Upload date: <b>{formatDate(reel.upload_date)}</b></div>}
        <label className="reel-field">
          <span>Posted at</span>
          <input type="datetime-local" value={posted} onChange={(e) => setPosted(e.target.value)} />
          <small className="muted">Set automatically when the first link is added.</small>
        </label>
        <div className="inline-edit">
          <button type="button" disabled={!dirty || busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
          {saved && <span className="saved-tick"><Check size={14} /> Saved</span>}
        </div>
      </div>
    </>
  )
}

/** Views: the editor's expected views and the actual views (added once, ~24 h after posting) side by side, one Save. */
function ViewsSection({ task, onChanged, onError }: { task: Task; onChanged: () => void; onError: (m: string) => void }) {
  const { profile } = useAuth()
  const reel = task.reel!
  const isEditor = !!profile && task.assigned_to === profile.id
  const str = (n: number | null) => (n != null ? String(n) : '')
  const [exp, setExp] = useState(str(reel.expected_views))
  const [act, setAct] = useState(str(reel.actual_views))
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  useEffect(() => { setExp(str(reel.expected_views)); setAct(str(reel.actual_views)) }, [reel.expected_views, reel.actual_views])
  const num = (v: string) => (v.trim() === '' ? null : Math.round(Number(v)))
  const nextExp = num(exp), nextAct = num(act)
  const patch: Record<string, number | null> = {}
  if (isEditor && nextExp !== reel.expected_views) patch.expected_views = nextExp
  if (nextAct !== reel.actual_views) patch.actual_views = nextAct
  const dirty = Object.keys(patch).length > 0
  const hoursSincePost = reel.posted_at ? (Date.now() - new Date(reel.posted_at).getTime()) / 3600e3 : null
  const pct = reel.actual_views != null && reel.expected_views ? Math.round((reel.actual_views / reel.expected_views) * 100) : null

  const save = async () => {
    if (Object.values(patch).some((v) => v != null && (!Number.isFinite(v) || v < 0))) return onError('Views should be a number')
    setBusy(true)
    const { error } = await supabase.from('task_reels').update(patch).eq('task_id', task.id)
    setBusy(false)
    if (error) return onError(error.message)
    setSaved(true); window.setTimeout(() => setSaved(false), 1500)
    onChanged()
  }

  return (
    <>
      <div className="form-section">Views</div>
      <div className="reel-pair">
        <label className="reel-field">
          <span>Expected views</span>
          <input type="number" inputMode="numeric" min={0} step={100} placeholder={isEditor ? 'e.g. 10000' : 'The editor sets this'}
            value={exp} disabled={!isEditor} onChange={(e) => setExp(e.target.value)} />
        </label>
        <label className="reel-field">
          <span>Actual views {reel.instagram_url && reel.youtube_url ? '(Instagram + YouTube)' : ''}</span>
          <input type="number" inputMode="numeric" min={0} placeholder="e.g. 12500" value={act} onChange={(e) => setAct(e.target.value)} />
        </label>
        <button type="button" disabled={!dirty || busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
      <p className="muted small">
        {saved ? <span className="saved-tick"><Check size={14} /> Saved</span>
          : pct != null ? <b className={pct >= 100 ? 'ok-text' : 'overdue-text'}>{pct}% of expected</b>
          : hoursSincePost != null && hoursSincePost < 24 && reel.actual_views == null ? <>Add the actual views {durationText((24 - hoursSincePost) * 3600)} from now</>
          : <>Add the actual views once, 24 hours after posting</>}
        {reel.actual_views != null && reel.views_counted_at ? ` · saved ${dateTime(reel.views_counted_at)}` : ''}
      </p>
    </>
  )
}

/** Edit time: the editor's expected time next to the actual time from the timer. */
function TimeSection({ task, entries, onChanged, onError }: {
  task: Task; entries: TimeEntry[]; onChanged: () => void; onError: (m: string) => void
}) {
  const { profile } = useAuth()
  const reel = task.reel!
  const isEditor = !!profile && task.assigned_to === profile.id
  const cur = reel.expected_minutes
  const [h, setH] = useState(cur ? String(Math.floor(cur / 60)) : '')
  const [m, setM] = useState(cur ? String(cur % 60) : '')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  useEffect(() => { setH(cur ? String(Math.floor(cur / 60)) : ''); setM(cur ? String(cur % 60) : '') }, [cur])
  const seconds = totalSeconds(entries)
  const next = ((Number(h) || 0) * 60 + (Number(m) || 0)) || null
  const dirty = isEditor && next !== cur
  const pct = cur && seconds ? Math.round((seconds / 60 / cur) * 100) : null

  const save = async () => {
    if (Number(h) < 0 || Number(m) < 0) return onError('Time can\'t be negative')
    setBusy(true)
    const { error } = await supabase.from('task_reels').update({ expected_minutes: next }).eq('task_id', task.id)
    setBusy(false)
    if (error) return onError(error.message)
    setSaved(true); window.setTimeout(() => setSaved(false), 1500)
    onChanged()
  }

  return (
    <>
      <div className="form-section">Edit Time</div>
      <div className="reel-pair">
        <label className="reel-field">
          <span>Expected edit time</span>
          {isEditor ? (
            <div className="duration-input">
              <input type="number" inputMode="numeric" min={0} max={168} placeholder="0" value={h} onChange={(e) => setH(e.target.value)} aria-label="Hours" /><span>h</span>
              <input type="number" inputMode="numeric" min={0} max={59} step={5} placeholder="0" value={m} onChange={(e) => setM(e.target.value)} aria-label="Minutes" /><span>m</span>
            </div>
          ) : <input disabled value={cur ? minutesText(cur) : ''} placeholder="The editor sets this" />}
        </label>
        <label className="reel-field">
          <span>Actual edit time</span>
          <input disabled value={durationText(seconds)} />
        </label>
        <button type="button" disabled={!dirty || busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
      <p className="muted small">
        {saved ? <span className="saved-tick"><Check size={14} /> Saved</span>
          : pct != null ? <b className={pct <= 100 ? 'ok-text' : 'overdue-text'}>{pct}% of expected</b>
          : 'Actual time comes from the timer on the Overview tab.'}
      </p>
    </>
  )
}
