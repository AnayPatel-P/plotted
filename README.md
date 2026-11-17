# Plotted

Plan your degree semester by semester against your school's real catalog requirements.
Starting with UT Austin (Math BS, CS BS) and Texas A&M (Data Engineering BS).

> Not an official degree audit. Always confirm with your school's audit tool and advisor.

## Layout

| Path | What |
|------|------|
| `web/` | Next.js 16 app (App Router, TypeScript, Tailwind v4). Planner UI in `src/components/planner/`, design tokens in `src/app/globals.css`, course search at `/api/courses` |
| `packages/engine/` | Requirement + prerequisite engine (TypeScript, runs in the browser), data schema (zod) |
| `scraper/` | Python catalog scrapers (uv) → `data/` |
| `data/<school>/<catalog-year>/` | `courses/<SUBJECT>.json` + `courses/index.json`, `programs/*.json` (generated), `overrides/*.yaml` (hand-reviewed), `review.md` (review queue) |
| `supabase/` | Database migrations + local stack config (accounts and saved plans) |
| `docs/pm/` | PRD, roadmap, decisions, status |
| `docs/SETUP-AUTH.md` | How to set up Google sign-in + sync (optional) |
| `docs/DEPLOY.md` | Deploying to Vercel + Supabase |
| `web/e2e/` | Playwright tests: accessibility (axe) + smoke tests of the core flow |

## Run

Requires Node 24+ and [uv](https://docs.astral.sh/uv/).

```bash
npm install
npm run dev          # http://localhost:3000
npm test             # engine tests + hand-checked sample plans + web reducer tests
npm run validate     # schema + reference checks, evaluates every suggested plan
npm run e2e -w web   # browser tests (accessibility + smoke); uses the dev server
npm run lint && npm run typecheck
```

Accounts are optional. Without `web/.env.local` the app runs signed-out and saves plans in the browser. To develop sign-in and sync locally (needs Docker):

```bash
npm run db:start      # local Supabase (Postgres + Auth)
npm run test:rls      # row-level security tests against it
```

See [docs/SETUP-AUTH.md](docs/SETUP-AUTH.md) for the hosted project and Google sign-in.

Scraper:

```bash
npm run data                          # scrape every school + rebuild programs (cached, 1 req/s)
cd scraper && uv run plotted-scrape --school tamu   # one school
cd scraper && uv run pytest && uv run ruff check .  # parser + snapshot tests
```

Pages are cached in `scraper/.cache/` (git-ignored), so re-runs are fast and don't hit the catalog.

## How catalog data flows

1. The scraper parses CourseLeaf course pages (code, credits, level, core codes, prerequisite text → parsed expression).
2. It parses each program page: the Plan of Study grid becomes the suggested plan; requirement tables become rule trees.
3. Anything it can't express is listed in `data/.../review.md`. A person fixes those in `overrides/<program>.yaml` and re-runs `npm run data` until the program's review list is empty.
4. `npm run validate` and `npm test` check the result against hand-worked sample plans.
5. `offerings.json` (v2) records which recent semesters each course ran in — UT from the public HB 2504 "Syllabi & CVs" listing, Texas A&M from the Registrar's grade-distribution reports — as a pattern with a confidence level.

### Override file fields

| Field | Use |
|-------|-----|
| `areas` | Requirement areas in order. `from: <table>` uses a parsed table (`replace: {ruleId: rule}` swaps rules); `rule:` hand-writes one; `include: core.yaml` reuses a shared area. `exclusive: false` lets courses also count elsewhere (core, total hours). |
| `planSlots` | `{text in slot label: filter}` — which courses can fill a placeholder in the suggested plan |
| `planReplace` | `{planItemId: item}` — fix a catalog plan item (e.g. a duplicated course) |
| `planNotes` | Plan rows without hours that are intentionally ignored |
| `knownMissing` | Courses the program page names that aren't in the course catalog (kept as alternatives) |
| `notes` | Shown to students under "Not checked automatically" |

### Adding a program

1. Add `overrides/<id>.yaml` with `url`, `name`, `degree` and the areas (copy a similar program).
2. Add the id to the school's `programs` list in `scraper/src/plotted_scraper/cli.py`.
3. `npm run data`, work through `review.md`, then `npm run validate`.
4. Add sample plans for it in `packages/engine/scripts/samples.test.ts`.
