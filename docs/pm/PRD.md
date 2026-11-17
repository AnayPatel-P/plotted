# Plotted — PRD

_Version 1.0 · 2026-11-17 · Status: Draft_

## 1. Vision
Every college student can see their whole degree on one screen, semester by semester, checked live against their school's real requirements, and can see how each choice affects their graduation date. Plotted starts at UT Austin and Texas A&M. It is built so each new school costs less to add than the last.

**One-liner:** Plotted helps college students plan their whole degree by laying it out visually against their school's real catalog requirements. The official audit tools are login-gated, form-heavy and built for checking work after the fact, not for planning ahead.

## 2. Problem
- **Who has it:** undergraduates choosing courses for future semesters, especially those with long prerequisite chains (CS, math, engineering).
- **What they do today:** a mix of the official degree audit (UT's Interactive Degree Audit; TAMU's required yearly Undergraduate Degree Planner), the PDF or catalog "suggested arrangement", a personal spreadsheet, and advisor meetings.
- **Why that's painful:** the official tools show what's done, not what happens if you move a course. Prerequisite chains are invisible until a course is blocked. Spreadsheets don't know the rules. None of it works well on a phone.

## 3. Target users
| Persona | Description | Key need |
|---------|-------------|----------|
| Planner Priya | UT CS sophomore mapping out junior and senior years | See which requirements are left and fit them into the semesters she has |
| Switching Sam | Freshman at UT, deciding between Math and CS | Quickly see what a 4-year plan for a major looks like (full what-if comes in v2) |
| Required-plan Riley | TAMU Data Engineering student who must submit a yearly degree plan | Build a valid plan fast and bring it to an advisor (share link or PDF) |

## 4. Goals and non-goals
**Goals (v1):**
- Correct requirement tracking for 3 majors: UT Austin Math BS, UT Austin CS BS, TAMU Data Engineering BS.
- A student goes from opening the site to having an editable, checked plan in under 2 minutes, with no sign-up.
- Works well on a phone and a laptop.
- A data pipeline (scraper → rule format → human review) that makes the next major or school cheaper to add.

**Non-goals (v1):**
- Being an official degree audit. Plotted always shows a "not official" disclaimer.
- Class times, sections or registration (UT Planner and the registrars' tools cover this).
- Auto-generating plans, what-if major comparison, AP/transfer credit entry, transcript import.
- Schools or majors beyond the three above; a native mobile app.

## 5. Features (MoSCoW)
| # | Feature | Priority | Notes |
|---|---------|----------|-------|
| F1 | Pick school → major → catalog year | Must | Plan is pinned to a catalog year |
| F2 | Semester planner grid (add, move, remove courses) | Must | Drag on desktop; tap-to-move on mobile |
| F3 | Live requirement tracking (met / partial / missing) | Must | Powered by the rule engine |
| F4 | Prerequisite checks with inline warnings | Must | Warns when a course is placed before its prereqs |
| F5 | Start from the catalog's suggested plan | Must | Adopted suggestion; empty plan also available |
| F6 | "Unlocks" view and graduation-delay warnings | Must | Adopted suggestion |
| F7 | Saved in the browser by default; optional Google sign-in to sync | Must | Local plan merges into the account on sign-in |
| F8 | Read-only share link and PDF export | Should | Adopted suggestion (the one Should in v1) |
| F9 | Course search within the selected catalog | Must | Needed by F2 |
| F10 | "Not an official audit" disclaimer and catalog source links | Must | Trust and liability |
| F11 | Auto-generate plan | Won't (v1) | v2; uses the same engine |
| F12 | What-if major comparison | Won't (v1) | v2; uses the same engine |
| F13 | AP / transfer / completed-credit entry | Won't (v1) | v1.1; small |

## 6. User stories and acceptance criteria
### F1 — Choose school, major, catalog year
- **As a** student **I want** to pick my school, major and catalog year **so that** the rules match the catalog I'm held to.
- **Done when:**
  - [ ] The three majors are selectable; catalog year defaults to the current one (2026-27).
  - [ ] Changing the catalog year reloads the rules without losing the courses already placed.

### F2 + F9 — Plan semesters
- **As a** student **I want** to place courses into semesters **so that** I can see my path to graduation.
- **Done when:**
  - [ ] I can add a semester (including summer), search a course by code or title, add it, move it and remove it.
  - [ ] Each semester shows total credit hours; a warning appears above the school's normal maximum load.
  - [ ] On a 375px-wide phone screen I can do all of the above without horizontal scrolling of the page.

### F3 — Requirement tracking
- **As a** student **I want** to see which requirements are met, partial or missing **so that** I know what's left.
- **Done when:**
  - [ ] Each requirement group shows its status and which planned courses count toward it.
  - [ ] A course is not double-counted where the catalog forbids it.
  - [ ] For each of the 3 majors, the catalog's suggested plan evaluates as "all requirements met" (or matches the known gaps a person documented while reviewing that major).
  - [ ] Updates within 100 ms of a change.

### F4 — Prerequisite checks
- **As a** student **I want** a warning when I schedule a course before its prerequisites **so that** I don't plan something impossible.
- **Done when:**
  - [ ] Prereqs written as and/or combinations (including "or consent of instructor") are evaluated.
  - [ ] Concurrent-enrollment ("may be taken concurrently") rules are honored.
  - [ ] Each warning names the missing course(s).

### F5 — Start from the suggested plan
- **As a** student **I want** my plan pre-filled with the catalog's recommended layout **so that** I'm not starting from a blank page.
- **Done when:**
  - [ ] Picking a major offers "Start from suggested plan" (default) and "Start empty".
  - [ ] Placeholder slots ("Science elective", "Core: Humanities") show as fillable slots that list the courses eligible for them.

### F6 — Unlocks and graduation-delay warnings
- **As a** student **I want** to see what a course unlocks and whether moving it delays graduation **so that** I protect my critical path.
- **Done when:**
  - [ ] Tapping a course highlights its prereqs and the courses it unlocks across the plan.
  - [ ] Moving a course so that a downstream course can no longer fit before the planned graduation term shows a warning naming the chain.
  - [ ] Courses on the longest prereq chain are visibly marked.

### F7 — Saving and sync
- **As a** student **I want** my plan saved without signing up, and synced across devices if I sign in.
- **Done when:**
  - [ ] Reloading the page keeps the plan (browser storage).
  - [ ] Signing in with Google uploads the local plan; the same plan appears on a second device.
  - [ ] A user can only read and write their own plans (database access rules tested).

### F8 — Share and PDF
- **As a** student **I want** a link and a PDF of my plan **so that** I can bring it to my advisor.
- **Done when:**
  - [ ] "Share" creates a read-only link that opens without signing in.
  - [ ] "PDF" downloads a one- or two-page printable plan with requirement status and the disclaimer.

## 7. User flow
1. Land on the home page → pick school → major → catalog year.
2. Choose "Start from suggested plan" → the 8-semester grid fills in.
3. The requirement panel shows status; warnings appear inline on the courses they affect.
4. Edit: move, add or remove courses, fill elective slots; the unlocks view shows the impact of each change.
5. Optionally sign in to sync; share a link or download a PDF for an advisor.

## 8. Non-functional requirements
- **Performance:** first load under 2.5 s on 4G; rule evaluation under 100 ms; catalog data for one major under 300 KB.
- **Platforms / devices:** latest two versions of Chrome, Safari (including iOS) and Firefox; phone (≥375px), tablet and desktop.
- **Privacy / security:** no transcript or student ID data collected. Auth via Supabase; row-level security on plans. Share links use unguessable IDs.
- **Accessibility:** WCAG 2.1 AA; every drag action also works by keyboard and tap; status is never shown by color alone.
- **Cost limits:** run on free tiers (Vercel Hobby + Supabase Free) until there are real users.
- **Data integrity:** every course and requirement links back to its catalog source page and records when it was scraped.

## 9. Tech approach (summary)
- **Web:** Next.js (App Router) + TypeScript + Tailwind; hosted on Vercel. Final UI direction chosen in the original-ui step (Build C1).
- **Rule engine:** a TypeScript package that runs in the browser. Requirements are a tree (`allOf`, `nOf`, `creditsFrom`, `course`, `pattern` such as "any M 3xx/4xx"). Prereqs are and/or expressions. Fully unit-tested.
- **Data pipeline:** Python (uv, httpx, BeautifulSoup/selectolax) scrapers for each catalog → normalized JSON per school and catalog year → a person reviews and corrects flagged items in an overrides file → validated JSON committed to the repo and served as static files.
- **Accounts & plans:** Supabase (Postgres + Google sign-in); `plans` table with row-level security.
- **Data model sketch:** `School → CatalogYear → Course {code, title, credits, prereq, coreq}`, `Program {requirements: RuleTree, suggestedPlan}`, `Plan {userId?, programId, catalogYear, terms: [{term, courses[]}]}`.

## 10. Success metrics
| Metric | Target | How measured |
|--------|--------|--------------|
| Requirement accuracy | 0 known errors for the 3 majors at launch | Check against catalog and the official audit for 5 sample plans per major |
| Time to first plan | < 2 min median | Product analytics (privacy-friendly) |
| Early adoption | 50 students create a plan in the first month after launch | Plan count |
| Return use | 30% of plan creators come back within 30 days | Analytics |
| Cost to add a major | ≤ 1 working session after v1 | Track time spent on the next major |

## 11. Risks and assumptions
| Risk / assumption | Impact | Likelihood | Mitigation / how we test it early |
|-------------------|--------|------------|-----------------------------------|
| **Catalog requirement text can be turned into the rule format with modest review (riskiest)** | High | Medium | Phase 1 spike on UT CS before building anything else |
| UT and TAMU catalog page structures differ or change | Medium | Medium | Separate scraper adapter per catalog; snapshot tests on saved HTML |
| Students treat Plotted as an official audit | High | Medium | Persistent disclaimer; link to the official audit; catalog source links |
| Complex rules (double-counting limits, GPA rules, "approved by advisor" lists) | Medium | High | Model what we can; show the rest as manual-check items |
| Scraping terms / load on catalog sites | Low | Low | Catalogs are public; cache pages, rate-limit, respect robots.txt, scrape a few times a year |
| Cold start (no one knows about it) | Medium | Medium | Share links; student orgs and subreddits at both schools |

## 12. Open questions
- [x] TAMU Data Engineering: "Data Engineering - BS", 128 hours, catalog.tamu.edu/undergraduate/engineering/industrial-systems/data-engineering-bs/. TAMU publishes only a semester grid + footnotes (no requirement tables), so rules are derived from the grid (D19).
- [ ] Which catalog years to support at launch: UT 2026-28 and TAMU 2026-27 only, or also the previous editions for current students?
- [x] Core curriculum: modeled in full for both schools (D20).
- [x] Cross-listed courses count as each other (D21). Course-number changes between catalog years: still open, matters once a second catalog year is added.

## 13. Future add-ons (backlog)
| Idea | Why it's valuable | Size (S/M/L) | Suggested version |
|------|-------------------|--------------|-------------------|
| Auto-generate plan | Instant valid plan respecting prereqs and load limits | L | v2 |
| What-if major/minor comparison | See the cost of switching; uses the same engine | M | v2 |
| AP / transfer / completed credit entry | Real plans for real students | S | v1.1 |
| More UT and TAMU majors | Coverage = adoption | S each | v1.x |
| More schools (CourseLeaf/Acalog adapters) | Path to startup scale | M per catalog platform | v2+ |
| Semester offering data (fall/spring only) | Prevents impossible plans | M | v2 |
| Minors and certificates | Common student need | M | v2 |
| Advisor view / comments on shared plans | Retention and a B2B angle | M | v3 |
| Transcript / audit import | Removes manual entry | L | v3 |
| Grade distribution and professor data overlay | Helps choose between elective options | M | v3 |

## 14. Design

**Concept: "Line Diagram"** — the degree as a transit diagram (D58, replacing Riso Route / D26). Chosen from three live prototypes built with the design plugin (original-ui → prototype picker).

- **Feel targets:** in control; bold with one hero moment; whole degree at a glance; toy-like, physical drag where the plan reacts live.
- **Metaphor → function:** semesters are stations (columns); each requirement area is a numbered colored line (lane, total hours excluded, leftovers ride "E" Electives); every course is a stop on its line; several stops in one semester join into a station capsule; prerequisites are black track drawn at 0°/45° (Vignelli routing), dashed red when a prerequisite comes after the course that needs it. Placeholders are open, dashed rings.
- **Signature moment:** the split-flap departure board (ARRIVING · ON BOARD · STATUS) is the answer to "am I on track?". It renders static on first paint and riffles only the characters that change when the plan changes. While dragging a course, its prerequisite tracks follow the pointer live and turn dashed red if the drop would break the order.
- **Palette:** paper `#F6F5F1` / ink `#121212` (dark: `#0F1011` / `#ECEBE6`). Line colors `--line-1…6` + grey electives, each ≥3:1 on paper with an AA numeral color for its bullet. Status colors are separate: alert red (needs attention), go green (Met), focus yellow (now / primary action / changed flap characters).
- **Type:** Schibsted Grotesk for the wordmark and headings; system UI for interface text; JetBrains Mono for course codes, hours and the flap board. Same rem scale (size + leading + tracking per step).
- **Layout:** masthead (breadcrumb, actions) → board + answer sentence → service-status strip (one entry per line; hover lights its stops, click opens the requirements side sheet) → the diagram. Desktop uses a subgrid so every lane lines up across semesters; phones (<640px) turn it into a vertical strip map with each line running down the left gutter.
- **Motion:** 100 ms press; line re-routing 420 ms strong ease-out; flap riffle ~60 ms per flap; no overshoot. Reduced motion skips the riffle and transitions.
- **Undo over confirm (D54)** unchanged.
