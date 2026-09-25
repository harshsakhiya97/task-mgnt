-- =====================================================================
-- Roles become a master list (Users & Roles → Roles tab).
-- * public.roles: name + description. The built-in "Admin" role is the only
--   one with admin access; every other role is a label (like Manager).
-- * profiles.role_id points at a role. The old profiles.role enum is kept in
--   sync automatically ('admin' for the Admin role, 'team_member' otherwise),
--   so every permission check (private.is_admin etc.) keeps working.
-- * Built-in roles (Admin, Team Member) can't be deleted; Admin can't be renamed.
--   A role that people still have can't be deleted.
-- =====================================================================

create table public.roles (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  is_admin boolean not null default false,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index roles_name_key on public.roles (lower(name));

insert into public.roles (name, description, is_admin, is_system) values
  ('Admin', 'Full access: manages users, roles, teams and sees every task.', true, true),
  ('Manager', 'Label only – same access as a team member.', false, false),
  ('Team Member', 'Default role for new users.', false, true);

alter table public.roles enable row level security;
create policy "roles read" on public.roles for select to authenticated using (true);
create policy "roles admin insert" on public.roles for insert to authenticated with check ((select private.is_admin()));
create policy "roles admin update" on public.roles for update to authenticated using ((select private.is_admin())) with check ((select private.is_admin()));
create policy "roles admin delete" on public.roles for delete to authenticated using ((select private.is_admin()));
revoke all on public.roles from anon;
grant select, insert, update, delete on public.roles to authenticated;

-- Guard the built-in roles and the admin flag.
create or replace function private.roles_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.is_system then raise exception 'Built-in role "%" cannot be deleted', old.name; end if;
    if exists (select 1 from public.profiles where role_id = old.id) then
      raise exception 'Role "%" is still given to % user(s). Move them to another role first.',
        old.name, (select count(*) from public.profiles where role_id = old.id);
    end if;
    return old;
  end if;

  new.name := btrim(new.name);
  if new.name = '' then raise exception 'Role name is required'; end if;
  if tg_op = 'INSERT' then
    new.is_admin := false;           -- only the built-in Admin role has admin access
    new.is_system := false;
  else
    new.is_admin := old.is_admin;
    new.is_system := old.is_system;
    new.created_at := old.created_at;
    if old.is_admin and new.name <> old.name then raise exception 'The Admin role cannot be renamed'; end if;
    new.updated_at := now();
  end if;
  return new;
end $$;

create trigger roles_guard before insert or update or delete on public.roles
  for each row execute function private.roles_guard();

-- profiles.role_id
alter table public.profiles add column role_id uuid references public.roles(id);
update public.profiles p set role_id = r.id from public.roles r
 where r.name = case p.role when 'admin' then 'Admin' when 'manager' then 'Manager' else 'Team Member' end;
alter table public.profiles alter column role_id set not null;
create index profiles_role_id_idx on public.profiles (role_id);

-- Keep role_id and the legacy enum in sync. Callers may send either
-- (role_id preferred; a bare enum 'role' still works for older code).
create or replace function private.profiles_role_sync() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  admin_role boolean;
begin
  if new.role_id is null
     or (tg_op = 'UPDATE' and new.role_id is not distinct from old.role_id and new.role is distinct from old.role) then
    select id into new.role_id from public.roles
     where name = case new.role when 'admin' then 'Admin' when 'manager' then 'Manager' else 'Team Member' end;
    if new.role_id is null then
      select id into new.role_id from public.roles where is_system and not is_admin order by created_at limit 1;
    end if;
  end if;
  select is_admin into admin_role from public.roles where id = new.role_id;
  if admin_role is null then raise exception 'Unknown role'; end if;
  new.role := case when admin_role then 'admin' else 'team_member' end::public.user_role;
  return new;
end $$;

create trigger profiles_role_sync before insert or update on public.profiles
  for each row execute function private.profiles_role_sync();

-- Re-derive the legacy enum for existing users (Manager → 'team_member').
update public.profiles set role_id = role_id;
