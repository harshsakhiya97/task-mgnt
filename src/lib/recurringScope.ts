import { supabase } from './supabase'

/** "Every day": change the schedule's time, plus this and any upcoming copies that aren't done yet. */
export async function applyTimeEveryDay(recurringId: string, fromDate: string, start: string | null, end: string | null) {
  const { error } = await supabase.from('recurring_tasks').update({ start_time: start, end_time: end }).eq('id', recurringId)
  if (error) throw new Error(error.message)
  const { error: e2 } = await supabase.from('tasks').update({ start_time: start, end_time: end })
    .eq('recurring_id', recurringId).gte('occurrence_date', fromDate).neq('status', 'done')
  if (e2) throw new Error(e2.message)
}

/** "Only this date" for a future day that has no task yet: create that day's copy now with the new time. */
export async function applyTimeOneFutureDay(recurringId: string, date: string, start: string | null, end: string | null, newDate?: string) {
  const { error } = await supabase.rpc('plan_recurring_day', {
    p_template: recurringId, p_date: date, p_start: start, p_end: end, p_new_date: newDate ?? null,
  })
  if (error) throw new Error(error.message)
}
