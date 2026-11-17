-- Plotted: anonymous product analytics (Phase 7).
-- Write-only for the app: anyone may insert a well-formed event; nobody can read
-- events through the API (read them in the Supabase dashboard / SQL editor).
-- No user id, IP address, user agent, or plan contents are stored.

create table public.events (
  id          bigint generated always as identity primary key,
  name        text not null check (name in (
                'plan_opened',      -- a program's planner was opened
                'first_plan',       -- first planner open for this browser (value_ms = time since first visit)
                'plan_edited',      -- first edit in a page session
                'share_created',
                'shared_opened',
                'pdf_printed',
                'signed_in'
              )),
  anon_id     uuid not null,         -- random, per browser; not linked to accounts
  school      text check (school ~ '^[a-z0-9-]{1,40}$'),
  program_id  text check (program_id ~ '^[a-z0-9-]{1,60}$'),
  value_ms    integer check (value_ms between 0 and 2000000000),
  created_at  timestamptz not null default now()
);

comment on table public.events is 'Anonymous product events; insert-only from the app (RLS), no personal data.';

create index events_name_time_idx on public.events (name, created_at);
create index events_anon_idx on public.events (anon_id, created_at);

alter table public.events enable row level security;

create policy "Anyone can record an event" on public.events
  for insert to anon, authenticated with check (true);

-- No select/update/delete policies: events can't be read or changed through the API.
revoke all on public.events from anon, authenticated;
grant insert (name, anon_id, school, program_id, value_ms) on public.events to anon, authenticated;
