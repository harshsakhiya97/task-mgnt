import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import type { Profile } from './types'

/** Active users, for "Assign to" pickers and filters. */
export function useActiveUsers() {
  const [users, setUsers] = useState<Profile[]>([])
  useEffect(() => {
    supabase.from('profiles').select('*').eq('is_active', true).order('full_name')
      .then(({ data }) => setUsers((data as Profile[]) ?? []))
  }, [])
  return users
}
