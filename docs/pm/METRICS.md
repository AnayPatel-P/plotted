# Success metrics: how to read them

Events are anonymous (random per-browser id, no account link, no IP, no plan contents)
and write-only from the app. Read them in Supabase → SQL editor.

| PRD metric | Query |
|---|---|
| Early adoption (target: 50 students in month 1) | `select count(distinct anon_id) from events where name = 'plan_opened' and created_at > now() - interval '30 days';` |
| Time to first plan (target: median < 2 min) | `select percentile_cont(0.5) within group (order by value_ms) / 1000 as median_seconds from events where name = 'first_plan';` |
| Return use (target: 30% back within 30 days) | see below |
| Plans edited (not just viewed) | `select count(distinct anon_id) from events where name = 'plan_edited';` |
| Shares and PDFs | `select name, count(*) from events where name in ('share_created','shared_opened','pdf_printed') group by name;` |
| Sign-ins | `select count(distinct anon_id) from events where name = 'signed_in';` |
| By major | `select school, program_id, count(distinct anon_id) from events where name = 'plan_opened' group by 1, 2 order by 3 desc;` |

Return use (browsers that opened a plan again 1–30 days after their first visit):

```sql
with firsts as (
  select anon_id, min(created_at) as first_at from events where name = 'plan_opened' group by anon_id
)
select round(100.0 * count(*) filter (where exists (
         select 1 from events e
         where e.anon_id = f.anon_id and e.name = 'plan_opened'
           and e.created_at between f.first_at + interval '1 day' and f.first_at + interval '30 days'
       )) / nullif(count(*), 0), 1) as pct_returning
from firsts f
where f.first_at < now() - interval '30 days';
```

Caveats: a student on two devices counts twice; cleared browser storage looks like a new
student; browsers sending Do Not Track / Global Privacy Control aren't counted at all.
