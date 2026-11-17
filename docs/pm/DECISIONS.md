# Decisions log

| # | Date | Decision | Why | Alternatives considered |
|---|------|----------|-----|-------------------------|
| D1 | 2026-11-17 | v1's core job is requirement tracking + prereq checks | The hard, valuable part; a plain semester grid is just a spreadsheet | Semester layout only; auto-generate; what-if comparison |
| D2 | 2026-11-17 | Auto-generate and what-if comparison go to the backlog (v2) | User wants them later; both reuse the v1 rule engine | Building them in v1 |
| D3 | 2026-11-17 | Catalog data comes from scrapers, with a human review/overrides step | Hand-curating doesn't scale past a few schools; requirement prose is too messy to trust a parser blindly | Hand-curated JSON only; student-contributed; official APIs (none available) |
| D4 | 2026-11-17 | Launch schools/majors: UT Austin Math BS + CS BS, TAMU Data Engineering BS | User's choice; mix of two catalog sites tests the adapter design early | 3 majors per school; all majors best-effort |
| D5 | 2026-11-17 | Optional sign-in: browser storage by default, Google sign-in to sync | No friction to try; sync for phone + laptop | Required sign-in; no accounts |
| D6 | 2026-11-17 | Adopted: start from suggested plan, prereq "unlocks" view, share link + PDF | Pre-filled start, a feature the official tools lack, advisor-meeting use | Manual AP/transfer credit → backlog (v1.1) |
| D7 | 2026-11-17 | Out of v1: class times/sections, transcript import, native app | UT Planner / registrar tools own scheduling; keeps scope to ~2 months | — |
| D8 | 2026-11-17 | Plans pinned to a catalog year | Students are held to the catalog in effect when they enter (TAMU states this explicitly) | Always use the latest catalog |
| D9 | 2026-11-17 | Proposed stack: Next.js + TS + Tailwind, TS rule engine in the browser, Python scrapers, catalog as versioned JSON, Supabase (auth + plans), Vercel. Final lock in Build C0 | Matches what the user knows; engine in the browser makes signed-out use instant; JSON in git makes data review a diff | FastAPI backend for the engine; catalog in Postgres |
| D10 | 2026-11-17 | Working name: Plotted | Short, fits "plot your degree" | — |
