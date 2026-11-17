# Deploying Plotted (Vercel + Supabase)

**Production:** https://plotted-cyan.vercel.app — Vercel deploys every push to `main` (previews for other branches).

The app is a Next.js 16 project in `web/`, inside an npm-workspaces monorepo
(`packages/engine`, `data/`). Catalog data ships with the build: program pages are
prerendered, and `/api/courses` bundles `data/*/*/courses/*.json` (configured in
`web/next.config.ts`).

## 1. Put the code on GitHub

Create an empty **private** repository (e.g. `plotted`), then from the project folder:

```bash
git remote add origin git@github.com:<you>/plotted.git
```

```bash
git push -u origin main
```

CI (`.github/workflows/ci.yml`) runs lint, types, unit + sample-plan tests, data validation,
scraper tests, the production build, browser tests (accessibility + smoke), and the database
security tests against a throwaway Supabase on every push and pull request.

## 2. Create the Vercel project

1. <https://vercel.com/new> → import the GitHub repo.
2. **Root Directory:** `web` (leave "Include files outside the root directory" on — the
   engine and data live outside `web/`). Framework: Next.js (auto-detected). Install and
   build commands: defaults.
3. **Environment variables** (Production and Preview):
   - `NEXT_PUBLIC_SUPABASE_URL` = `https://<project-ref>.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` = the **publishable** key (never the secret key)
4. Deploy. Note the production URL (e.g. `https://plotted.vercel.app`, or your domain).

## 3. Allow sign-in from the production URL

- **Supabase → Authentication → URL Configuration:** set **Site URL** to the production URL,
  and add `https://<production-domain>/**` to **Redirect URLs** (keep `http://localhost:3000/**`
  for development). For Vercel preview deployments, also add
  `https://*-<your-vercel-team>.vercel.app/**`.
- **Google Cloud → Credentials → your OAuth client:** add the production URL to
  **Authorized JavaScript origins**. The redirect URI stays the Supabase callback.

## 4. Database migrations

Migrations live in `supabase/migrations/`. Apply new ones to the hosted project with:

```bash
npx supabase db push --remote
```

## 5. Smoke-check production

- Open the production URL on a phone and a laptop; pick a school and major.
- Sign in with Google; reload; the plan stays ("Synced to your account").
- Share a link and open it in a private window (read-only, no sign-in).
- Print / Save as PDF.
- Supabase → SQL editor: `select name, count(*) from events group by 1;` shows events
  (see `docs/pm/METRICS.md`).

## Updating catalog data

```bash
npm run data
```

```bash
npm run validate
```

Commit the changed `data/` files; the next deploy ships them.
