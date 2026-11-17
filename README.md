# Plotted

Plan your degree semester by semester against your school's real catalog requirements.
Starting with UT Austin (Math BS, CS BS) and Texas A&M (Data Engineering BS).

> Not an official degree audit. Always confirm with your school's audit tool and advisor.

## Layout

| Path | What |
|------|------|
| `web/` | Next.js 16 app (App Router, TypeScript, Tailwind) |
| `packages/engine/` | Requirement + prerequisite engine (TypeScript, runs in the browser), data schema (zod) |
| `scraper/` | Python catalog scrapers (uv) → `data/` |
| `data/<school>/<catalog-year>/` | `courses.json`, `programs/*.json` (generated), `overrides/*.yaml` (hand-reviewed), `review.md` (review queue) |
| `docs/pm/` | PRD, roadmap, decisions, status |

## Run

Requires Node 24+ and [uv](https://docs.astral.sh/uv/).

```bash
npm install
npm run dev          # http://localhost:3000
npm test             # engine tests
npm run lint && npm run typecheck
```

Scraper:

```bash
npm run data                          # scrape UT catalog + rebuild programs (cached, 1 req/s)
cd scraper && uv run pytest && uv run ruff check .
```

Pages are cached in `scraper/.cache/` (git-ignored), so re-runs are fast and don't hit the catalog.

## How catalog data flows

1. The scraper parses CourseLeaf course pages (code, credits, level, core codes, prerequisite text → parsed expression).
2. It parses each program page: the Plan of Study grid becomes the suggested plan; requirement tables become rule trees.
3. Anything it can't express is listed in `data/.../review.md`. A person fixes those in `overrides/<program>.yaml` (replace a rule by id, map plan slots, add notes) and re-runs `npm run data` until the program's review list is empty.
