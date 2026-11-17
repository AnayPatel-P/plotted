-- Plotted v2: a plan's first semester (e.g. 'Fall 2025'), used to show real term names
-- and which semesters are completed. Nullable: v1 plans have none.
alter table public.plans
  add column start_term text check (start_term ~ '^(Spring|Summer|Fall) [0-9]{4}$');
