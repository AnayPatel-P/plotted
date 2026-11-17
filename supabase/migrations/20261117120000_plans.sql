-- Plotted: saved degree plans (Phase 5).
-- One row per plan; a student can keep several plans per program.
-- Row-level security: a signed-in user can only see and change their own rows.

create table public.plans (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  school        text not null check (school ~ '^[a-z0-9-]{1,40}$'),
  catalog_year  text not null check (catalog_year ~ '^[0-9-]{4,12}$'),
  program_id    text not null check (program_id ~ '^[a-z0-9-]{1,60}$'),
  name          text not null default 'My plan' check (char_length(name) between 1 and 80),
  terms         jsonb not null check (jsonb_typeof(terms) = 'array'),
  extra_courses jsonb not null default '[]'::jsonb check (jsonb_typeof(extra_courses) = 'array'),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- Keep rows small: a 12-semester plan is ~10 KB.
  constraint plans_size check (octet_length(terms::text) + octet_length(extra_courses::text) < 262144)
);

comment on table public.plans is 'Student degree plans; private to each user (RLS).';

create index plans_user_program_idx on public.plans (user_id, school, catalog_year, program_id, updated_at desc);

-- updated_at bookkeeping
create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger plans_touch before update on public.plans
for each row execute function public.touch_updated_at();

-- A user can't move a plan to another user.
create function public.plans_keep_owner() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.user_id <> old.user_id then
    raise exception 'plans.user_id cannot change';
  end if;
  return new;
end;
$$;

create trigger plans_owner before update on public.plans
for each row execute function public.plans_keep_owner();

-- Row-level security
alter table public.plans enable row level security;

create policy "Users read their own plans" on public.plans
  for select to authenticated using ((select auth.uid()) = user_id);

create policy "Users create their own plans" on public.plans
  for insert to authenticated with check ((select auth.uid()) = user_id);

create policy "Users update their own plans" on public.plans
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "Users delete their own plans" on public.plans
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Anonymous visitors get no access at all.
revoke all on public.plans from anon;
grant select, insert, update, delete on public.plans to authenticated;
