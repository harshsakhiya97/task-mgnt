/** 2.2 Meetings: a task with kind 'meeting' (organiser = creator), plus its details and attendees. */

export type AttendeeResponse = 'pending' | 'going' | 'declined'
export const RESPONSE_LABELS: Record<AttendeeResponse, string> = { pending: 'No answer yet', going: 'Going', declined: "Can't make it" }

export interface MeetingInfo {
  task_id: string
  meeting_link: string | null
  notes: string | null
  notes_updated_at: string | null
  notes_updated_by: string | null
  remind_minutes: number | null
  reminded_at: string | null
}

export interface Attendee {
  user_id: string
  response: AttendeeResponse
  person?: { id: string; full_name: string } | null
}

/** "Remind everyone" choices (minutes before the start). */
export const MEETING_REMIND_OPTIONS: [number | null, string][] = [
  [null, 'No reminder'], [0, 'At the start'], [5, '5 min before'], [10, '10 min before'], [15, '15 min before'],
  [30, '30 min before'], [60, '1 hour before'],
]
