import { useEffect, useState } from 'react'
import { Check, CirclePause, CirclePlay, CircleStop, ExternalLink, Plus, Timer, Trash2 } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { formatDate, timeAgo, type Task } from '../lib/tasks'
import {
  durationText, latestViews, minutesText, PLATFORM_LABELS, timer, totalSeconds, viewsAt24h, viewsText,
  type Platform, type ReelViews, type TimeEntry,
} from '../lib/reels'
import { ConfirmDialog } from './ConfirmDialog'
import { CopyButton } from './CopyButton'

const PLATFORMS: Platform[] = ['instagram', 'youtube']

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
export function ReelTimer({ task, entries, onChanged, onError, onOpenReel }: {
  task: Task; entries: TimeEntry[]; onChanged: () => void; onError: (m: string) => void; onOpenReel?: () => void
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
      {isAssignee && !done && (task.reel?.expected_minutes == null || task.reel?.expected_views == null) ? (
        <div className="reel-nudge small">
          Set your expected views and edit time first.
          {onOpenReel && <button type="button" className="link" onClick={onOpenReel}>Set them in the 🎬 Reel tab</button>}
        </div>
      ) : <TimeBar seconds={seconds} expected={task.reel?.expected_minutes ?? null} />}
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
export function ReelPanel({ task, entries, views, onChanged, onError }: {
  task: Task; entries: TimeEntry[]; views: ReelViews[]; onChanged: () => void; onError: (m: string) => void
}) {
  const reel = task.reel
  if (!reel) return <p className="muted">Reel details are loading…</p>
  return (
    <>
      <Targets task={task} onChanged={onChanged} onError={onError} />
      <PostDetails task={task} onChanged={onChanged} onError={onError} />
      <ViewsSection task={task} views={views} onChanged={onChanged} onError={onError} />
      <TimeSection task={task} entries={entries} onChanged={onChanged} onError={onError} />
    </>
  )
}

/** Expected views and edit time — set by the editor (or whoever gave the reel); locked for non-admins once it's Done. */
function Targets({ task, onChanged, onError }: { task: Task; onChanged: () => void; onError: (m: string) => void }) {
  const { profile } = useAuth()
  const reel = task.reel!
  const isAdmin = profile?.role === 'admin'
  const mine = !!profile && [task.assigned_to, task.created_by, task.assigned_by].includes(profile.id)
  const canEdit = isAdmin || (mine && task.status !== 'done')
  const [views, setViews] = useState(reel.expected_views != null ? String(reel.expected_views) : '')
  const [h, setH] = useState(reel.expected_minutes ? String(Math.floor(reel.expected_minutes / 60)) : '')
  const [m, setM] = useState(reel.expected_minutes ? String(reel.expected_minutes % 60) : '')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    setViews(reel.expected_views != null ? String(reel.expected_views) : '')
    setH(reel.expected_minutes ? String(Math.floor(reel.expected_minutes / 60)) : '')
    setM(reel.expected_minutes ? String(reel.expected_minutes % 60) : '')
  }, [reel.expected_views, reel.expected_minutes])

  const minutes = (Number(h) || 0) * 60 + (Number(m) || 0)
  const nextViews = views.trim() === '' ? null : Math.round(Number(views))
  const dirty = nextViews !== reel.expected_views || (minutes || null) !== reel.expected_minutes

  const save = async () => {
    if (nextViews != null && (!Number.isFinite(nextViews) || nextViews < 0)) return onError('Expected views should be a number')
    if (Number(h) < 0 || Number(m) < 0) return onError('Edit time can\'t be negative')
    setBusy(true)
    const { error } = await supabase.from('task_reels').update({ expected_views: nextViews, expected_minutes: minutes || null }).eq('task_id', task.id)
    setBusy(false)
    if (error) return onError(error.message)
    setSaved(true); window.setTimeout(() => setSaved(false), 1500)
    onChanged()
  }

  return (
    <>
      <div className="form-section">Expected</div>
      {canEdit ? (
        <div className="reel-add-views">
          <label className="reel-field">
            <span>Expected views (at 24 h)</span>
            <input type="number" inputMode="numeric" min={0} step={100} placeholder="e.g. 10000" value={views} onChange={(e) => setViews(e.target.value)} />
          </label>
          <label className="reel-field">
            <span>Expected edit time</span>
            <div className="duration-input">
              <input type="number" inputMode="numeric" min={0} max={168} placeholder="0" value={h} onChange={(e) => setH(e.target.value)} aria-label="Hours" /><span>h</span>
              <input type="number" inputMode="numeric" min={0} max={59} step={5} placeholder="0" value={m} onChange={(e) => setM(e.target.value)} aria-label="Minutes" /><span>m</span>
            </div>
          </label>
          <button type="button" disabled={!dirty || busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
          {saved && <span className="saved-tick"><Check size={14} /> Saved</span>}
        </div>
      ) : (
        <div className="reel-stats two">
          <div><span>Expected views</span><b>{viewsText(reel.expected_views)}</b></div>
          <div><span>Expected edit time</span><b>{minutesText(reel.expected_minutes)}</b></div>
        </div>
      )}
      <p className="muted small">{task.status === 'done' && !isAdmin ? 'The reel is done, so only an admin can change these.' : 'Set by the editor before starting. Used in Reports → Reels.'}</p>
    </>
  )
}

function PostDetails({ task, onChanged, onError }: { task: Task; onChanged: () => void; onError: (m: string) => void }) {
  const reel = task.reel!
  const [caption, setCaption] = useState(reel.caption ?? '')
  const [ig, setIg] = useState(reel.instagram_url ?? '')
  const [yt, setYt] = useState(reel.youtube_url ?? '')
  const [posted, setPosted] = useState(toLocalInput(reel.posted_at))
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    setCaption(reel.caption ?? ''); setIg(reel.instagram_url ?? ''); setYt(reel.youtube_url ?? ''); setPosted(toLocalInput(reel.posted_at))
  }, [reel.caption, reel.instagram_url, reel.youtube_url, reel.posted_at])

  const dirty = caption.trim() !== (reel.caption ?? '') || ig.trim() !== (reel.instagram_url ?? '') || yt.trim() !== (reel.youtube_url ?? '')
    || posted !== toLocalInput(reel.posted_at)
  const badUrl = [ig, yt].some((u) => u.trim() && !/^https?:\/\/\S+$/i.test(u.trim()))

  const save = async () => {
    if (badUrl) return onError('Links should start with https://')
    if (posted && new Date(posted).getTime() > Date.now() + 5 * 60e3) return onError('Posted time can\'t be in the future')
    setBusy(true)
    const { error } = await supabase.from('task_reels').update({
      caption: caption.trim() || null, instagram_url: ig.trim() || null, youtube_url: yt.trim() || null, posted_at: fromLocalInput(posted),
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
        <div className="form-grid">
          <label className="reel-field">
            <span>Instagram link {reel.instagram_url && <a href={reel.instagram_url} target="_blank" rel="noopener noreferrer" className="link-icon"><ExternalLink size={13} /> Open</a>}</span>
            <input type="url" inputMode="url" placeholder="https://www.instagram.com/reel/…" value={ig} onChange={(e) => setIg(e.target.value)} />
          </label>
          <label className="reel-field">
            <span>YouTube link {reel.youtube_url && <a href={reel.youtube_url} target="_blank" rel="noopener noreferrer" className="link-icon"><ExternalLink size={13} /> Open</a>}</span>
            <input type="url" inputMode="url" placeholder="https://youtube.com/shorts/…" value={yt} onChange={(e) => setYt(e.target.value)} />
          </label>
        </div>
        {reel.upload_date && <div className="small">Upload date: <b>{formatDate(reel.upload_date)}</b></div>}
        <label className="reel-field">
          <span>Posted at</span>
          <input type="datetime-local" value={posted} onChange={(e) => setPosted(e.target.value)} />
          <small className="muted">Set automatically when the first link is added. Views at 24 h are counted from this time.</small>
        </label>
        <div className="inline-edit">
          <button type="button" disabled={!dirty || busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
          {saved && <span className="saved-tick"><Check size={14} /> Saved</span>}
        </div>
      </div>
    </>
  )
}

function ViewsSection({ task, views, onChanged, onError }: {
  task: Task; views: ReelViews[]; onChanged: () => void; onError: (m: string) => void
}) {
  const { profile } = useAuth()
  const reel = task.reel!
  const [counts, setCounts] = useState<Record<Platform, string>>({ instagram: '', youtube: '' })
  const [at, setAt] = useState('')
  const [busy, setBusy] = useState(false)
  const [showAll, setShowAll] = useState(false)
  // Platforms with a link (or both when none is added yet).
  const shown = PLATFORMS.filter((p) => (p === 'instagram' ? reel.instagram_url : reel.youtube_url))
  const platforms = shown.length ? shown : PLATFORMS

  const at24 = platforms.map((p) => viewsAt24h(views, p, reel.posted_at))
  const latest = platforms.map((p) => latestViews(views, p))
  const sum = (xs: (ReelViews | null)[]) => (xs.some(Boolean) ? xs.reduce((s, x) => s + (x?.views ?? 0), 0) : null)
  const total24 = sum(at24), totalLatest = sum(latest)
  const exp = reel.expected_views
  const hoursSincePost = reel.posted_at ? (Date.now() - new Date(reel.posted_at).getTime()) / 3600e3 : null

  const add = async () => {
    const rows = platforms.filter((p) => counts[p].trim() !== '').map((p) => ({
      task_id: task.id, platform: p, views: Math.round(Number(counts[p])), counted_at: fromLocalInput(at) ?? new Date().toISOString(),
    }))
    if (!rows.length) return onError('Type the view count first')
    if (rows.some((r) => !Number.isFinite(r.views) || r.views < 0)) return onError('Views should be a number')
    setBusy(true)
    const { error } = await supabase.from('reel_views').insert(rows)
    setBusy(false)
    if (error) return onError(error.message)
    setCounts({ instagram: '', youtube: '' }); setAt('')
    onChanged()
  }

  const remove = async (id: number) => {
    const { error } = await supabase.from('reel_views').delete().eq('id', id)
    if (error) onError(error.message); else onChanged()
  }

  const list = [...views].sort((a, b) => b.counted_at.localeCompare(a.counted_at))

  return (
    <>
      <div className="form-section">Views</div>
      <div className="reel-stats">
        <div><span>Expected</span><b>{viewsText(exp)}</b></div>
        <div>
          <span>At 24 hours</span>
          <b>{viewsText(total24)}</b>
          {total24 != null && exp ? <small className={total24 >= exp ? 'ok-text' : 'overdue-text'}>{Math.round((total24 / exp) * 100)}% of expected</small>
            : !reel.posted_at ? <small className="muted">Add the post link first</small>
            : hoursSincePost != null && hoursSincePost < 18 ? <small className="muted">Count it {durationText((24 - hoursSincePost) * 3600)} from now</small>
            : total24 == null ? <small className="muted">No count between 18–48 h</small> : null}
        </div>
        <div><span>Latest</span><b>{viewsText(totalLatest)}</b>{latest.some(Boolean) && <small className="muted">{timeAgo(latest.filter(Boolean).map((x) => x!.counted_at).sort().pop()!)}</small>}</div>
      </div>
      {platforms.length > 1 && (at24.some(Boolean) || latest.some(Boolean)) && (
        <div className="muted small reel-split">
          {platforms.map((p, i) => <span key={p}>{PLATFORM_LABELS[p]}: {viewsText(at24[i]?.views)} at 24 h · {viewsText(latest[i]?.views)} latest</span>)}
        </div>
      )}

      <div className="reel-add-views">
        {platforms.map((p) => (
          <label key={p} className="reel-field">
            <span>{PLATFORM_LABELS[p]} views</span>
            <input type="number" inputMode="numeric" min={0} placeholder="e.g. 12500" value={counts[p]}
              onChange={(e) => setCounts((c) => ({ ...c, [p]: e.target.value }))} />
          </label>
        ))}
        <label className="reel-field">
          <span>Counted at</span>
          <input type="datetime-local" value={at} onChange={(e) => setAt(e.target.value)} />
        </label>
        <button type="button" disabled={busy} onClick={add}><Plus size={16} /> Add count</button>
      </div>
      <p className="muted small">Leave "Counted at" empty to use the current time. Views at 24 h = the count recorded closest to 24 hours after posting.</p>

      {list.length > 0 && (
        <ul className="reel-history">
          {(showAll ? list : list.slice(0, 4)).map((v) => (
            <li key={v.id}>
              <b>{v.views.toLocaleString('en-IN')}</b> <span className="muted">on {PLATFORM_LABELS[v.platform]}</span>
              <small className="muted">{dateTime(v.counted_at)}{v.source === 'auto' ? ' · auto' : v.recorder ? ` · ${v.recorder.full_name}` : ''}</small>
              {(v.recorded_by === profile?.id || profile?.role === 'admin') && (
                <button className="icon" title="Delete" onClick={() => remove(v.id)}><Trash2 size={15} /></button>
              )}
            </li>
          ))}
          {list.length > 4 && <li><button type="button" className="link" onClick={() => setShowAll((s) => !s)}>{showAll ? 'Show less' : `Show all ${list.length}`}</button></li>}
        </ul>
      )}
    </>
  )
}

function TimeSection({ task, entries, onChanged, onError }: {
  task: Task; entries: TimeEntry[]; onChanged: () => void; onError: (m: string) => void
}) {
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
      {list.length === 0 ? <p className="muted">No time yet. The editor's Start → Pause / Stop on the Overview tab adds a block.</p> : (
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
