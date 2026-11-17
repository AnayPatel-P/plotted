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
**Demo:** build a plan signed out → sign in with Google → open on another device → same plan.
- [x] 5.1 Supabase `plans` table, row-level security, ownership + size checks, migrations in `supabase/migrations/`; local stack via `npm run db:start`
- [x] 5.2 Google sign-in via Supabase Auth (PKCE, client-side); clear message if the provider isn't enabled
- [x] 5.3 Link local plan on sign-in (newer wins; untouched local loads the account plan; conflicting plans are both kept); debounced saves; sign-out clears plans from the browser
- [x] 5.4 Multiple plans per user: switch, save a copy, rename, delete
- [x] 5.5 Hosted project + Google OAuth client (your setup; schema pushed with `db push --remote`, anonymous access verified blocked, Google provider verified)
**Done when:**
- [x] F7 acceptance criteria pass on the local stack: plan survives reload; signing in uploads it; a second device (fresh browser storage) gets the same plan; access rules tested with two users (`npm run test:rls`)
- [x] Same flow checked with real Google sign-in on the hosted project (confirmed by you, 2026-11-17)

## Phase 6 — Share link + PDF
**Goal:** bring the plan to an advisor.
**Demo:** Plan menu → Share → link opens a read-only plan anywhere (no sign-in) → "Copy into my plan"; Plan menu → Print / Save as PDF → 2-page landscape plan.
- [x] 6.1 Share links: the plan is compressed into the URL fragment (`#p=…`, ~500 characters for a full plan); `/share/<school>/<year>/<program>` shows it read-only (no storage, no account sync, `noindex`), with "Copy into my plan" and a friendly error for broken links
- [x] 6.2 PDF via print stylesheet: letter landscape, all semesters in 4 columns, requirements summary with open items, timing problems, catalog source + date + disclaimer; ~400 KB
**Done when:**
- [x] F8 acceptance criteria pass — the PDF comes from the browser's print dialog ("Save as PDF") rather than a direct download

## Phase 7 — Ship
- [x] 7.1 About & FAQ page (what's checked and not, catalogs, privacy); disclaimer + catalog links in planner, picker, print
- [x] 7.2 Accessibility: axe WCAG 2.1 AA on every page type, light + dark, desktop + phone (16 checks, 0 violations); keyboard-only flow tested; fixed accessible names (WCAG 2.5.3), muted-text contrast, heading order
- [x] 7.3 Performance: planner pages server-rendered and fully static → Lighthouse mobile/slow-4G 100/100/100, LCP 0.9 s (was 4.2 s), CLS 0.003 (was 0.161); plan page ≈16 KB gzipped incl. catalog data; display font trimmed 129 → 78 KB
- [x] 7.4 Anonymous first-party analytics (`events` table, write-only, honors Do Not Track / GPC) + `docs/pm/METRICS.md` queries for every PRD success metric
- [x] 7.5 Playwright smoke tests (core flow, keyboard flow, reload persistence, share in a fresh browser, no console errors) + GitHub Actions CI (checks + database security job)
- [x] 7.6 Deploy prep: data file tracing for `/api/courses`, `docs/DEPLOY.md`
- [x] 7.7 Deployed: https://plotted-cyan.vercel.app (Vercel, auto-deploys `main`); events migration pushed; private GitHub repo with CI; production Google sign-in confirmed by you
- [ ] 7.8 Small beta with students at both schools

### Final acceptance check (PRD §6, §8)
| | Status | Evidence |
|---|---|---|
| F1 pick school/major/year | ✅ (year switch n/a: one edition per school) | picker; smoke test |
| F2 + F9 edit semesters, search, credit totals, 375px | ✅ | smoke tests desktop + phone; a11y phone |
| F3 requirement tracking, no double counting, <100 ms | ✅ | 15 hand-checked sample plans; ~0.1 ms per change |
| F4 prerequisites (and/or, concurrent, names missing) | ✅ | parser + engine tests; smoke test |
| F5 suggested-plan start, eligible courses for slots | ✅ | picker; slot dialog |
| F6 unlocks highlight, delay warning naming the chain, critical marks | ✅ | schedule tests on real plans; browser check |
| F7 browser storage + Google sync, RLS | ✅ | RLS tests; hosted Google sign-in confirmed by you |
| F8 read-only share link + PDF | ✅ (PDF via print dialog) | smoke test; PDF inspected |
| F10 disclaimer + catalog source links | ✅ | header, About, print footer, Plan menu |
| NFR performance (first load < 2.5 s on 4G) | ✅ | Lighthouse LCP 0.9 s |
| NFR browsers | ⚠️ Chromium tested (desktop + Android emulation); Safari/iOS and Firefox not yet tested | — |
| NFR accessibility WCAG 2.1 AA | ✅ automated + keyboard; ⚠️ no screen-reader session yet | axe suite |
| NFR cost (free tiers) | ✅ | Vercel Hobby + Supabase Free fit |
| NFR data integrity (source links) | ✅ per program (not per course) | Plan menu → catalog page |
| Success metrics | ⏳ instrumented; measurable after launch | METRICS.md |

# v2 roadmap (see PRD-v2.md)

**Riskiest assumption:** public HB 2504 class listings can be scraped into offering patterns → tested first (Phase 8).
**Timeline:** ~5–6 weeks part-time; release after each phase.

## Phase 8 — Offerings data spike + pipeline
**Goal:** prove and build offering patterns from public class listings.
**Demo:** `npm run data` writes `offerings.json` for both schools; `npm run validate` reports coverage and where the catalogs' own plans clash with real offerings.
- [x] 8.1 Spike: UT — HB 2504 "Syllabi & CVs" listing (public, HTML, one request per semester + department). TAMU — the public class search is behind a bot challenge (not bypassed); used the Registrar's public grade-distribution reports instead (PDF per semester + college, every graded section)
- [x] 8.2 Scraped Fall 2023 – Fall 2026 (UT: 10 terms; TAMU: 9 published terms) for every subject the 3 majors' rules, plans and prerequisites use; cached, 1 request/s
- [x] 8.3 Pattern (fall-spring / fall / spring / irregular) + confidence (high / medium / low) + summer flag per course; source URL and date in the data; schema in the engine
- [x] 8.4 Validation: coverage UT 82% (113/137), TAMU 92% (76/83) of program courses; spot-checked core sequences at both schools
**Done when:**
- [x] Coverage ≥80% at both schools; spot-checks match expectations
**Findings:** UT Math's catalog plan puts M 365D (spring-only recently) in a fall and lists M 321M / M 365G, which haven't run in 3 years; UT CS lists C S 103F in a fall (spring-only recently, medium confidence); new DAEN capstones have run once (irregular → no warnings yet); TAMU grade reports omit ungraded sections (e.g. 0-credit DAEN 399) → "unknown", never a warning.

## Phase 9 — Where you are now (real terms + credit column)
**Goal:** plans start from the student's real position.
**Demo:** set "Started Fall 2025" → Fall 2025 / Spring 2026 ✓ Completed, Fall 2026 ● Now, "Finishes Spring 2029"; ＋ Credit → M 408C moves from Fall 2025 into "Credit before college".
- [x] 9.1 Schema: optional `startTerm` (state, storage, share link, `plans.start_term` column) and term `kind: "credit"`; v1 plans parse unchanged (tests on a real v1 share link, v1 browser data, v1 account rows)
- [x] 9.2 Engine: `termCalendar` (real names, completed / in progress / future), credit counts and satisfies prerequisites without using a semester, delay / no-slack warnings only for changeable terms
- [x] 9.3 UI: "Started" picker, real term names + status badges, settled completed semesters (still editable), credit column (add by code; a planned course moves into credit instead of duplicating; kept on "Reset to suggested"), mobile + print
**Done when:**
- [x] F13 acceptance criteria pass; v1 plans unaffected
**Note for shipping:** the `start_term` column must be pushed to the hosted database before this code deploys.

## Phase 10 — Credit sources (AP + TCCNS)
**Goal:** automatic credit from AP scores and Texas community-college courses.
**Demo:** pick AP Calculus BC = 5 → M 408C + M 408D appear in the credit column; enter HIST 1301 → HIS 315K.
- [ ] 10.1 Scrape + review AP tables (UT Testing Services; TAMU equivalent) per catalog edition
- [ ] 10.2 Spike + scrape TCCNS equivalencies for both schools
- [ ] 10.3 Credit picker UI (exam + score, TCCNS code, any course); sources shown
- [ ] 10.4 Tests: ≥10 exams per school checked against the source
**Done when:** F11 + F12 acceptance criteria pass.

## Phase 11 — Offering-aware planning
**Goal:** trustworthy timing.
**Demo:** move a fall-only course to spring → "Usually offered in fall"; the delay banner accounts for the year it slips.
- [ ] 11.1 Engine: offering-aware earliest-feasible term in `analyzeSchedule`
- [ ] 11.2 UI: "Usually: Fall only" on chips and in search; warnings; unknown never warns
- [ ] 11.3 Tests on real chains (e.g. TAMU's 8-semester chain with offerings)
**Done when:** F14 + F15 acceptance criteria pass.

## Phase 12 — What-if switch cost
**Goal:** answer "what if I switch?".
**Demo:** UT CS plan → "Compare with Math" → "11 courses still count · 23 hours of new requirements · finish Spring 2029 (+1 semester)".
- [ ] 12.1 Engine: `compareProgram()` (carry-over, new requirements, estimated finish)
- [ ] 12.2 UI: compare view, headline, side-by-side requirements; "Switch to this major" copy
- [ ] 12.3 Sample-plan tests for CS↔Math
**Done when:** F16 acceptance criteria pass.

## Phase 13 — Fill my remaining semesters
**Goal:** a complete, valid, editable draft in one action.
**Demo:** a half-empty plan → "Fill remaining" → every requirement met, no prerequisite/offering warnings, ~15 hrs/term, suggested courses marked; undo restores.
- [ ] 13.1 Engine: `fillRemaining()` scheduler (prereqs, offerings, load, only future terms, never move student-placed courses)
- [ ] 13.2 UI: action, load setting, "suggested" marks, keep/swap, undo
- [ ] 13.3 Tests: all 3 majors from (a) empty, (b) a typical sophomore, (c) a credit-heavy freshman
**Done when:** F17 acceptance criteria pass; < 1 s on a mid-range phone.

## Phase 14 — Ship v2
- [ ] Pre-beta checks: Safari/iOS, Firefox, VoiceOver; feedback link
- [ ] Accessibility + performance re-check; e2e for new flows
- [ ] Docs (README, About/FAQ, METRICS for new events), deploy, beta

## Later (post-v1)
- See PRD §13 Future add-ons (top: AP/transfer credit, auto-generate, what-if comparison)
