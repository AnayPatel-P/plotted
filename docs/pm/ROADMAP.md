# Plotted — Roadmap

**Stack (locked 2026-11-17):** Next.js + TypeScript + Tailwind (web) · TypeScript rule engine (in the browser) · Python scrapers (uv) · catalog data as versioned JSON · npm workspaces · Supabase Postgres + Auth (user plans) · Vercel. Reasons in DECISIONS.md.
**Riskiest assumption:** catalog requirement text can be encoded into our rule format with modest human review → tested in Phase 1: **validated** (see D11).
**Timeline:** about 8 weeks part-time; roughly one week per phase.

## Phase 1 — Data spike + walking skeleton (UT CS)
**Goal:** prove the data model on the hardest real case and show it end to end.
**Demo:** a web page shows UT CS's suggested plan in a semester grid with a live requirement checklist (read-only).
- [x] 1.1 Scaffold the repo (`web/`, `packages/engine/`, `scraper/`, `data/`, `docs/pm/`), lint/format/test tooling, `pnpm dev`
- [x] 1.2 Define the data schema (Course, prereq expression, RuleTree, SuggestedPlan) as zod + JSON Schema
- [x] 1.3 Python scraper: UT Austin course listings for the departments CS needs (C S, M, core) + the CS BS program page
- [x] 1.4 Encode UT CS requirements into a RuleTree (scraped + corrections file); list what couldn't be parsed
- [x] 1.5 Engine v0: evaluate a plan against the RuleTree and prereqs, with unit tests
- [x] 1.6 Minimal Next.js page: load data, render the grid + checklist
**Done when:**
- [x] `pnpm dev` runs the app; `pnpm test` passes
- [x] UT CS suggested plan evaluates correctly (checked by hand against the catalog)
- [x] A spike write-up in DECISIONS.md: share of requirements parsed automatically vs. by hand, and go / adjust decision

## Phase 2 — Data pipeline for all 3 majors
**Goal:** repeatable scrape → normalize → review → publish for UT and TAMU.
**Demo:** `npm run data` regenerates validated JSON for UT Math, UT CS and TAMU Data Engineering; a report lists flagged items.
- [x] 2.1 Refactor the scraper into per-catalog adapters (UT, TAMU); page caching + rate limiting already done in Phase 1
- [x] 2.2 Prereq text parser (and/or, concurrent enrollment, "consent of instructor") with tests on real samples
- [x] 2.3 Requirement parser + `overrides/*.yaml` for manual fixes; flagged-items report
- [x] 2.4 Add UT Math BS and TAMU Data Engineering BS (+ the Texas core curriculum)
- [x] 2.5 Validation (`npm run validate`): schema check, every required course exists, suggested plans evaluated with gaps listed (the catalogs' own plans are not complete; gaps are documented in the sample-plan tests)
- [x] 2.6 Snapshot tests on saved catalog HTML
- [x] 2.7 Split course data into per-subject files + index (largest file 189 KB); the app reads only the subjects a program needs
- [x] 2.8 (added) Cross-listed courses treated as equivalent in prerequisites and requirements
- [x] 2.9 (added) Simple program list + `/plan/<school>/<year>/<program>` route so all three majors can be viewed
**Done when:**
- [x] All 3 majors pass validation; 5 sample plans per major checked by hand
- [x] Re-running the pipeline is one command and produces no unexpected changes

## Phase 3 — UI design (original-ui) + interactive planner
**Goal:** pick the visual direction and make the planner fully editable on desktop and phone.
**Demo:** pick school/major/year → suggested plan loads → drag or tap to move courses, search and add, requirements update live.
- [x] 3.1 Run original-ui with the PRD handoff; concept "Riso Route" recorded in DECISIONS.md (D26) and PRD §14 Design
- [x] 3.2 School / major picker (catalog edition shown; each school has one edition so there's nothing to choose yet); start from suggested plan, start empty, or continue a saved plan
- [x] 3.3 Editable grid: add semesters (incl. summer after a spring), remove empty ones, drag (mouse; long-press on touch) + tap/keyboard "Move to…" menu
- [x] 3.4 Course search (code, number or title) and slot filling (only courses that satisfy the slot, slot-sized ones first)
- [ ] 3.4b Moved to Phase 4: a slot that overlaps a requirement (e.g. "Natural Science (030)" vs. the major's science sequence) suggests courses that satisfy both
- [x] 3.5 Live requirement panel (stamps, hours bars, hover to see which courses count) + inline prereq warnings; per-term credits and heavy-load warning
- [x] 3.6 Save to browser storage; responsive layout (375px →)
- [x] 3.7 (pulled from 4.3) Prerequisite route highlight: tap a course to light up what it builds on and leads to
**Done when:**
- [x] F1–F5, F9 acceptance criteria pass (PRD §6), except F1's catalog-year switch (only one edition per school exists yet)
- [x] Checked by eye in a desktop browser (1440px, light + dark) and at phone width (375px)

## Phase 4 — Unlocks view + graduation-delay warnings
**Goal:** the feature the official tools don't have.
**Demo:** tap a course → its whole route lights up with its slack; move MATH 151 to spring at TAMU → "Graduation slips: MATH 151 → MATH 152 → … → DAEN 460 needs 7 more semesters, but only 6 remain."
- [x] 4.1 Engine: prereq graph, downstream closure, critical path, slack (`analyzeSchedule`)
- [x] 4.2 Delay detection: a chain that can't finish by the last planned term warns once, at its head
- [x] 4.3 UI: "◆ no slack" marks, delay warnings on the course + banner, "Finishes" term and longest-chain shortcut in the masthead, timing line in the route summary; large routes draw only direct links + the critical chain
- [x] 4.4 Tests on real chains from all 3 majors (TAMU's 8-semester zero-slack chain, UT CS's early-finishing chain, delay scenarios)
- [x] 4.5 Overlap suggestions: the course picker ranks courses named by open requirements first and labels each with what it completes or counts toward
**Done when:**
- [x] F6 acceptance criteria pass (highlight prereqs + unlocks, delay warning naming the chain, critical courses marked)
- [x] No noticeable lag: evaluation + schedule analysis ≈0.1 ms per change; picker labels re-evaluate ≤30 candidates (~3 ms)

## Phase 5 — Accounts + sync
**Goal:** optional sign-in that syncs plans across devices.
**Demo:** build a plan signed out → sign in with Google → open on phone → same plan.
- [ ] 5.1 Supabase project, `plans` table, row-level security policies, migrations in the repo
- [ ] 5.2 Google sign-in via Supabase Auth
- [ ] 5.3 Merge local plan into the account on sign-in; save changes to the server (debounced)
- [ ] 5.4 Multiple saved plans per user
**Done when:**
- [ ] F7 acceptance criteria pass, including an access-rule test with two users

## Phase 6 — Share link + PDF
**Goal:** bring the plan to an advisor.
**Demo:** click Share → link opens a read-only plan in a private window; click PDF → printable plan.
- [ ] 6.1 Share IDs + read-only plan route
- [ ] 6.2 PDF export (print stylesheet or server-rendered PDF) with requirement status + disclaimer
**Done when:**
- [ ] F8 acceptance criteria pass

## Phase 7 — Ship
- [ ] Disclaimer, catalog source links, about/FAQ page
- [ ] Accessibility pass (keyboard, screen reader labels, contrast); performance check against PRD §8
- [ ] Privacy-friendly analytics for the success metrics
- [ ] Playwright smoke test of the core flow; CI on GitHub
- [ ] Deploy to Vercel + Supabase production; README (run, configure, deploy, update data)
- [ ] Final acceptance check against the PRD; small beta with students at both schools

## Later (post-v1)
- See PRD §13 Future add-ons (top: AP/transfer credit, auto-generate, what-if comparison)
