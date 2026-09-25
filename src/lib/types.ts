export type Role = 'admin' | 'manager' | 'team_member'

/** A role from the Roles master list. Only the built-in Admin role gives admin access. */
export interface RoleRow {
  id: string
  name: string
  description: string | null
  is_admin: boolean
  is_system: boolean
}

/** Badge colour for a role: admin red, the default role blue, everything else amber. */
export function roleBadge(r?: Pick<RoleRow, 'name' | 'is_admin'> | null) {
  if (!r) return 'team_member'
  return r.is_admin ? 'admin' : r.name === 'Team Member' ? 'team_member' : 'manager'
}

export interface Team {
  id: string
  name: string
}

export interface Profile {
  id: string
  full_name: string
  email: string
  phone: string | null
  /** Legacy permission level, kept in sync by the database: 'admin' or 'team_member'. */
  role: Role
  role_id: string
  /** Joined role name (when selected with `role_info:roles(name, is_admin)`). */
  role_info?: { name: string; is_admin: boolean } | null
  team_id: string | null
  is_active: boolean
  created_at: string
}
