import { FunctionsHttpError } from '@supabase/supabase-js'
import { supabase } from './supabase'

type Action =
  | { action: 'create'; email: string; password: string; full_name: string; phone?: string; role_id: string; team_id?: string | null }
  | { action: 'update'; id: string; full_name?: string; phone?: string; role_id?: string; team_id?: string | null; email?: string }
  | { action: 'set_active'; id: string; active: boolean }
  | { action: 'set_password'; id: string; password: string }

/** Calls the admin-users Edge Function and turns its errors into readable messages. */
export async function adminUsers(body: Action): Promise<void> {
  const { error } = await supabase.functions.invoke('admin-users', { body })
  if (!error) return
  if (error instanceof FunctionsHttpError) {
    const detail = await error.context.json().catch(() => null)
    throw new Error(detail?.error ?? error.message)
  }
  throw new Error(error.message)
}
