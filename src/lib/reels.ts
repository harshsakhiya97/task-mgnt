import { supabase } from './supabase'

/** What kind of work a task is. Meetings arrive in 2.1. */
export type TaskKind = 'task' | 'reel' | 'meeting'

export type Platform = 'instagram' | 'youtube'
export const PLATFORM_LABELS: Record<Platform, string> = { instagram: 'Instagram', youtube: 'YouTube' }

/** Reel sub-types (the kind of content work), picked when the reel is given. */
export const REEL_SUB_TYPES = [
  'Podcast Editing', 'Podcast Teaser', 'Podcast Reel', 'Reel / Short', 'Instagram Reel', 'Source Video Editing',
  'Ads Video Editing', 'Raw Cut', 'Shoot', 'PPT Creation', 'Thumbnail Design', 'Cover Photo', 'Social Media Post',
  'Script Writing', 'Publishing / SEO', 'Review / QC', 'Correction', 'Meeting', 'AI Audio / Video Generate',
  'Instagram Automation', 'Other',
] as const

/** The reel's own details (one row per reel task). */
export interface ReelInfo {
  task_id: string
  caption: string | null
  sub_type: string | null          // REEL_SUB_TYPES (or an older value)
  instagram_url: string | null
  youtube_url: string | null
  drive_url: string | null         // Google Drive link (edited video / files); not a post link
  posted_at: string | null
  upload_date: string | null       // day the reel should go up (set by whoever gives it)
  expected_views: number | null
  expected_minutes: number | null
  actual_views: number | null        // the one view count (typed in ~24 h after posting)
  views_counted_at: string | null
  views_counted_by: string | null
  updated_at: string
}

export interface ReelViews {
  id: number; task_id: string; platform: Platform; views: number; counted_at: string
  source: 'manual' | 'auto'; recorded_by: string | null; recorder?: { id: string; full_name: string } | null
}

export interface TimeEntry {
  id: number; task_id: string; user_id: string; started_at: string; ended_at: string | null; manual: boolean
  person?: { id: string; full_name: string } | null
}

/** Total seconds of the blocks (a running block counts up to now). */
export function totalSeconds(entries: Pick<TimeEntry, 'started_at' | 'ended_at'>[], now = Date.now()) {
  return entries.reduce((s, e) => s + Math.max(0, ((e.ended_at ? new Date(e.ended_at).getTime() : now) - new Date(e.started_at).getTime()) / 1000), 0)
}

/** 4500 → "1h 15m"; 59 → "0m"; with seconds → "1:15:00". */
export function durationText(seconds: number, clock = false) {
  const s = Math.max(0, Math.floor(seconds))
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60
  if (clock) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
  return h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m`
}
export const minutesText = (m: number | null | undefined) => (m == null ? '—' : durationText(m * 60))

/** 12500 → "12.5K" */
export function viewsText(n: number | null | undefined) {
  if (n == null) return '—'
  if (n >= 1_000_000) return `${+(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `${+(n / 1000).toFixed(1)}K`
  return n.toLocaleString('en-IN')
}

export async function timer(taskId: string, action: 'start' | 'pause' | 'stop') {
  const { error } = await supabase.rpc('task_timer', { p_task: taskId, p_action: action })
  return error?.message ?? null
}

/** Views at 24 h for one platform: the count recorded closest to 24 h after posting, within 18–48 h (same rule as the report). */
export function viewsAt24h(rows: ReelViews[], platform: Platform, postedAt: string | null) {
  if (!postedAt) return null
  const target = new Date(postedAt).getTime() + 24 * 3600e3
  const lo = target - 6 * 3600e3, hi = target + 24 * 3600e3
  let best: ReelViews | null = null
  for (const r of rows) {
    if (r.platform !== platform) continue
    const t = new Date(r.counted_at).getTime()
    if (t < lo || t > hi) continue
    if (!best || Math.abs(t - target) < Math.abs(new Date(best.counted_at).getTime() - target)) best = r
  }
  return best
}

/** The newest count per platform. */
export function latestViews(rows: ReelViews[], platform: Platform) {
  return rows.filter((r) => r.platform === platform).sort((a, b) => b.counted_at.localeCompare(a.counted_at))[0] ?? null
}

/** One reel's row in the Reels report (report_reels RPC). */
export interface ReelReportRow {
  task_id: string; task_no: number; title: string; editor_id: string | null; editor_name: string | null; team_name: string | null
  status: string; due_date: string; upload_date?: string | null; sub_type?: string | null; completed_at: string | null; posted_at: string | null
  instagram_url: string | null; youtube_url: string | null
  expected_views: number | null; views_24h: number | null; latest_views: number | null; latest_at: string | null
  expected_minutes: number | null; actual_minutes: number; timer_running: boolean
}
