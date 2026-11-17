# Plotted v2 — PRD

_Version 1.0 · 2026-11-17 · Status: Draft · builds on [PRD.md](PRD.md) (v1, live at https://plotted-cyan.vercel.app)_

## 1. Vision
v1 plans a degree from a blank first semester. Real students arrive with AP and dual credit,
are partway through, and wonder what happens if they switch majors. v2 makes the plan start from
**where the student actually is** and answers **"what changes if I switch?"** — while making the
signature graduation-delay warnings trustworthy by knowing **when courses are actually offered**.

**One-liner:** Plotted v2 helps current UT Austin and Texas A&M students plan the rest of their
degree from their real starting point — credit, completed semesters, real course offerings —
unlike the official audit, which can't answer "what if".

## 2. Target users (additions to v1)
| Persona | Description | Key need |
|---|---|---|
| Credit-heavy Casey | Incoming freshman with 5 AP exams and dual credit | See which requirements are already done, plan the rest |
| Midway Morgan | Second-semester junior | Plan only the remaining semesters; trust the "graduation slips" warning |
| Switching Sam | CS student considering Math | What carries over, what's new, how many extra semesters |

## 3. Goals and non-goals
**Goals (v2):** credit before college; completed / in-progress / future terms; offering-aware warnings;
what-if switch cost; "fill my remaining semesters" — for the same 3 majors.

**Non-goals (v2):** IB and other exam credit (AP only), transcript import, new schools, new majors
(unless time remains), previous catalog editions, class times / sections.

## 4. Features (MoSCoW)
| # | Feature | Priority | Notes |
|---|---|---|---|
| F11 | Credit before college: AP exam + score → courses (official tables) | Must | Per school, per catalog edition |
| F12 | Transfer / dual credit via TCCNS equivalencies; any other course by code | Must | Texas community colleges |
| F13 | Real terms: plan start term; completed / in-progress / future semesters | Must | Delay math starts from today |
| F14 | Offering patterns from public HB 2504 class listings + "rarely offered then" warnings | Must | Spike first; unknown = no warning |
| F15 | Offering-aware graduation-delay analysis | Must | Extends v1 F6 |
| F16 | What-if switch cost vs. another major at the same school | Must | Carry-over, new requirements, +semesters |
| F17 | Fill my remaining semesters | Must | Respects prereqs, offerings, ~15-hr load; editable |
| F18 | More majors | Could | Only if time remains |

## 5. User stories and acceptance criteria
### F11 + F12 — Credit before college
- **As** Casey **I want** to enter my AP scores and dual-credit courses **so that** my plan starts with what I've already earned.
- **Done when:**
  - [ ] A "Credit before college" column precedes the first semester; credit counts toward requirements and satisfies prerequisites.
  - [ ] Picking an AP exam + score adds exactly the courses in the school's official table for the plan's catalog edition (checked against the source for ≥10 exams per school).
  - [ ] Entering a TCCNS course (e.g. HIST 1301) adds its equivalent at the plan's school; unknown codes explain why.
  - [ ] Any course can be added to the credit column by code.
  - [ ] Credit is saved, synced and shared like the rest of the plan.

### F13 — Where you are now
- **As** Morgan **I want** my past semesters marked completed and the current one in progress **so that** Plotted plans only what's left.
- **Done when:**
  - [ ] Each plan has a start term (e.g. Fall 2025); semesters show real names (Fall 2026) as well as Year N.
  - [ ] Semesters before the current term are "completed", the current is "in progress"; completed semesters can still be edited (to match reality) but are visually settled.
  - [ ] Delay analysis only reschedules future semesters.
  - [ ] v1 plans (no start term) open unchanged and can be given a start term.

### F14 + F15 — Offerings
- **As** Morgan **I want** to know when a course is usually offered **so that** I don't plan a fall-only course in spring.
- **Done when:**
  - [ ] Offering patterns exist for ≥80% of the courses named by the 3 majors' requirements, built from ≥4 past long semesters; spot-checked for 10 courses per school.
  - [ ] Each course shows "Usually: Fall only / Spring only / Fall & Spring / Irregular / Unknown" with the semesters seen.
  - [ ] Placing a course in a term it wasn't offered in recent years shows a warning; "Unknown" never warns.
  - [ ] Graduation-delay warnings account for offerings (a fall-only course missed in fall slips a full year).

### F16 — What-if
- **As** Sam **I want** to compare my plan against another major **so that** I know the cost of switching.
- **Done when:**
  - [ ] From any plan, choose another major at the same school; see side-by-side status.
  - [ ] Headline: courses that still count, requirements newly needed (hours), and the estimated finishing term.
  - [ ] "Switch to this major" copies the plan into that major (original kept).

### F17 — Fill my remaining semesters
- **As** any student **I want** Plotted to fill my open slots **so that** I get a complete, valid draft fast.
- **Done when:**
  - [ ] One action fills placeholders and missing requirements in future semesters only, never touching completed/in-progress terms or courses the student placed.
  - [ ] Result has no prerequisite or offering warnings when a valid arrangement exists within the planned semesters; otherwise explains what doesn't fit.
  - [ ] Respects a per-semester load (default 15, adjustable 12–18).
  - [ ] Every filled course is marked "suggested" until the student keeps or swaps it; one undo restores the previous plan.

## 6. Non-functional requirements
- Performance: v1 targets stay (LCP < 2.5 s on 4G; evaluation < 100 ms). Fill-remaining completes in < 1 s on a mid-range phone.
- Compatibility: existing saved / synced / shared v1 plans keep working (schema additions are optional).
- Accessibility: same WCAG 2.1 AA bar; new dialogs and columns covered by the axe suite.
- Data: every AP mapping, TCCNS equivalency and offering pattern links to its public source and snapshot date.

## 7. Tech approach (summary)
- **Data (scraper):** `data/<school>/<edition>/credit/ap.json`, `credit/tccns.json`, `offerings.json`
  (per course: counts per season over the semesters scraped, pattern, confidence, terms seen).
- **Engine:** credit term (index −1, counts as taken before term 0); real-term calendar from a start
  term; offering-aware earliest-feasible-term in `analyzeSchedule`; `compareProgram()` for what-if;
  `fillRemaining()` — greedy topological scheduler over unmet rules with offerings and load limits.
- **Schema:** optional `startTerm`, term `status`, `credit` items, `suggested` flag — all optional so v1 data parses unchanged.

## 8. Success metrics (additions)
| Metric | Target |
|---|---|
| Plans with credit entered | ≥ 40% of plans edited by beta students |
| What-if used | ≥ 20% of returning students |
| Fill-remaining kept | ≥ 50% of suggested courses kept |

## 9. Risks
| Risk | Impact | Likelihood | Mitigation |
|---|---|---|---|
| **HB 2504 class listings can't be scraped reliably (riskiest)** | High | Medium | Phase 8 spike on both schools; fallback: curated patterns for the ~100 courses the 3 majors name |
| TCCNS equivalency tables unavailable or messy | Medium | Medium | Spike in Phase 10; fallback: course-code entry only |
| AP tables change yearly | Low | High | Pin to catalog edition; source + date shown |
| Scope (4 features in ~5–6 weeks) | Medium | Medium | Ship after each phase; F17 last |
| Fill-remaining produces odd plans | Medium | Medium | "Suggested" marking, undo, sample-plan tests per major |

## 10. Future add-ons (backlog after v2)
IB / CLEP credit · transcript import · more majors · previous catalog editions · advisor view ·
grade-distribution overlay · new schools (CourseLeaf adapters).
