import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isConfigured = Boolean(url && anonKey)

// The anon key is safe to ship in the browser; access is controlled by RLS policies.
export const supabase = createClient(url ?? 'http://localhost', anonKey ?? 'missing')
