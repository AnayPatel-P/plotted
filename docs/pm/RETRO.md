# Plotted v1 — retrospective and v2 pitch

_2026-11-17 · v1 live at https://plotted-cyan.vercel.app_

## What shipped
UT Austin CS + Math and Texas A&M Data Engineering, scraped from the live catalogs and reviewed
to zero open items; a visual planner (Riso Route design) with live requirement checks,
prerequisite warnings, prerequisite routes, critical-path / graduation-delay warnings, course
suggestions that "count twice"; optional Google sign-in with sync and multiple plans; read-only
share links; print/PDF; anonymous analytics; accessibility (axe 0 violations) and Lighthouse 100.

## What went well
- **Testing the riskiest assumption first.** The Phase 1 spike proved catalog requirements could
  be parsed with ~45 lines of hand overrides per major, before any UI existed.
- **Hand-checked sample plans as tests.** They caught real engine mistakes (allocation order,
  cross-listings) and real catalog mistakes (duplicated courses, missing prerequisites, retired
  course codes) that no unit test would have.
- **One engine, many features.** The same rule engine powers checking, the route view, delay
  warnings and "Completes / Counts toward" suggestions — and is ready for what-if and auto-generate.
- **Security checked against a real database.** Row-level security was tested with two users
  locally and in CI, and verified on the hosted project before launch.

## What was harder than expected
- **Catalog quirks** dominated the data work: "registration in / for / therein", cross-listed
  codes, multi-number courses ("CH 301, 401"), and TAMU publishing requirements only as a
  semester grid with footnotes.
- **Next.js 16 specifics** cost the most rework: stale Tailwind dev CSS, Cache Components rules
  (a single `new Date()` made a page stream instead of prerender), and route-type generation in CI.
- **Performance needed a redesign late.** The client-only planner (Phase 3) missed the 2.5 s
  first-load target on 4G (LCP 4.2 s); server-rendering it in Phase 7 fixed it (0.9 s).

## What I'd do differently
- Measure first-load performance on a throttled phone in the phase that introduces a page, not
  at ship time.
- Pin dependency versions from `npm view` rather than memory (three packages had to be bumped).
- Write the setup guide's commands against the exact CLI version (the `db push --remote` miss).
- Ask for the deploy target (Vercel + Supabase project) at the start of Build, so infrastructure
  steps run in parallel with feature work.

## Before the beta (small, do first)
1. Test on Safari / iOS and Firefox (only Chromium was tested).
2. One screen-reader pass (VoiceOver on iPhone + Mac).
3. A feedback link (e.g. a short form) — the About page asks people to report mistakes but has no
   channel yet.

## v2 pitch — re-ranked with what we learned
| Rank | Feature | Why now | Size |
|---|---|---|---|
| 1 | **AP / transfer / completed credit** | Every real student has some; without it, plans for sophomores and up are wrong from term one. The engine already treats any planned course as taken. | S |
| 2 | **Which semesters a course is offered** | Delay warnings assume any course can go in any term; many upper-division courses are fall- or spring-only. Makes the signature "graduation slips" warning trustworthy. Needs class-schedule scraping. | M |
| 3 | **What-if major comparison** | You asked for it at the start. The engine can evaluate a plan against any program today; this is mostly UI ("how far am I from Math if I switch?"). | M |
| 4 | Auto-generate a plan | Also requested up front; builds on 2 (offering terms) and the critical-path analysis. | L |
| 5 | More majors at UT and TAMU | Adoption scales with coverage; each major is ~1 review session now. | S each |
| 6 | Previous catalog editions | Current juniors/seniors follow older catalogs. | M |

Recommended v2 scope: **1 + 2 + 3**, plus a few high-demand majors chosen from the beta's
`plan_opened` data.
